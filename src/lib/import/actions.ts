"use server";
/**
 * Import wizard mutations — upload, column mapping, commit.
 *
 * Same authorization pattern as every mutation: session → RBAC
 * (`record:write`) → validate → verify referenced rows belong to the
 * caller's org → write → audit. The wizard's inter-step state lives on the
 * `import_runs` row (status: UPLOADED → MAPPED → RUNNING → COMPLETED/FAILED)
 * with the raw CSV in object storage, so a refresh never loses progress.
 *
 * Commit is double-submit-proof: it starts with a guarded status flip
 * (MAPPED → RUNNING) that matches zero rows for a second click or a second
 * tab — the moral twin of the version-guarded record UPDATE. It also
 * re-validates every row first: statuses may have been renamed or references
 * taken since the mapping step, and stale validation must never insert.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { diffFields, recordAudit } from "@/lib/audit";
import { requireSessionUser, type SessionUser } from "@/lib/auth";
import { parseCsv, CsvParseError } from "@/lib/csv";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { snapshotCustomValues, type CustomFieldDef } from "@/lib/records/custom-fields";
import { assertCan } from "@/lib/rbac";
import { deleteObject, getObject, putObject } from "@/lib/storage";
import { emitRecordEvent } from "@/lib/webhooks/dispatch";
import { buildImportLookups, getImportRun, listCustomFieldDefs } from "./queries";
import { columnMappingProblem, guessColumnMapping, importTargetsFor } from "./targets";
import {
  IMPORT_ERROR_DISPLAY_CAP,
  IMPORT_ROW_CAP,
  validateImportRows,
  type ImportRecordValues,
} from "./validate";

export type ImportUploadState =
  | { status: "idle" }
  | { status: "error"; message: string };

/** 5 MB — comfortably under the 12 MB serverActions bodySizeLimit. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** Records (and their audit rows) are inserted in chunks of this many. */
const INSERT_CHUNK = 500;

const importLog = logger.child({ module: "import" });

function checkRole(user: SessionUser, permission: Parameters<typeof assertCan>[1]): string | null {
  try {
    assertCan(user.role, permission);
    return null;
  } catch {
    return `Your role (${user.role}) doesn't have permission to do this.`;
  }
}

/** Read and parse the run's stored CSV. Returns null when unreadable. */
async function readRunCsv(storageKey: string): Promise<string[][] | null> {
  try {
    const bytes = await getObject(storageKey);
    return parseCsv(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Step 1 — upload                                                             */
/* -------------------------------------------------------------------------- */

export async function uploadImportCsv(
  _prev: ImportUploadState,
  formData: FormData,
): Promise<ImportUploadState> {
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "record:write");
  if (forbidden) return { status: "error", message: forbidden };

  const typeParse = z.string().uuid().safeParse(formData.get("recordTypeId"));
  if (!typeParse.success) return { status: "error", message: "Pick a record type." };
  const recordTypeId = typeParse.data;

  const [type] = await db
    .select({ id: schema.recordTypes.id })
    .from(schema.recordTypes)
    .where(
      and(eq(schema.recordTypes.id, recordTypeId), eq(schema.recordTypes.orgId, user.orgId)),
    );
  if (!type) return { status: "error", message: "Unknown record type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a CSV file to upload." };
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return { status: "error", message: "Import files must be 5 MB or smaller." };
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { status: "error", message: "That doesn't look like a .csv file." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let rows: string[][];
  try {
    rows = parseCsv(new TextDecoder().decode(bytes));
  } catch (err) {
    if (err instanceof CsvParseError) {
      return { status: "error", message: `The file isn't valid CSV: ${err.message}` };
    }
    throw err;
  }

  if (rows.length < 2) {
    return {
      status: "error",
      message: "The file needs a header row and at least one data row.",
    };
  }
  const headers = rows[0];
  const dataRows = rows.slice(1);
  if (dataRows.length > IMPORT_ROW_CAP) {
    return {
      status: "error",
      message: `That's ${dataRows.length.toLocaleString("en-US")} rows — imports are capped at ${IMPORT_ROW_CAP.toLocaleString("en-US")}. Split the file and import in parts.`,
    };
  }
  const emptyIndex = headers.findIndex((h) => h.trim() === "");
  if (emptyIndex !== -1) {
    return { status: "error", message: `Column ${emptyIndex + 1} has an empty header.` };
  }
  const dupe = headers.find((h, i) => headers.indexOf(h) !== i);
  if (dupe !== undefined) {
    return {
      status: "error",
      message: `The header “${dupe}” appears twice — column names must be unique.`,
    };
  }

  const defs = await listCustomFieldDefs(user.orgId, recordTypeId);
  const columnMapping = guessColumnMapping(headers, importTargetsFor(defs));

  const storageKey = `imports/${crypto.randomUUID()}.csv`;
  await putObject(storageKey, bytes);

  let runId: string;
  try {
    const [run] = await db
      .insert(schema.importRuns)
      .values({
        orgId: user.orgId,
        recordTypeId,
        fileName: file.name.slice(0, 200),
        storageKey,
        columnMapping,
        rowCount: dataRows.length,
        createdById: user.id,
      })
      .returning({ id: schema.importRuns.id });
    runId = run.id;
  } catch (err) {
    await deleteObject(storageKey).catch(() => {});
    throw err;
  }

  redirect(`/records/import/${runId}`);
}

/* -------------------------------------------------------------------------- */
/* Step 2 — mapping + validation                                               */
/* -------------------------------------------------------------------------- */

export async function saveImportMapping(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/records/import");
  const id = idParse.data;
  const back = `/records/import/${id}`;

  if (checkRole(user, "record:write")) redirect(`${back}?error=forbidden`);

  const run = await getImportRun(user.orgId, id);
  if (!run) redirect("/records/import");
  if (run.status !== "UPLOADED" && run.status !== "MAPPED") {
    redirect(`${back}?error=not_editable`);
  }

  const rows = await readRunCsv(run.storageKey);
  if (!rows || rows.length < 1) redirect(`${back}?error=unreadable`);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  const mapping: Record<string, string> = {};
  headers.forEach((header, index) => {
    const value = formData.get(`col_${index}`);
    mapping[header] = typeof value === "string" ? value : "";
  });

  const defs = await listCustomFieldDefs(user.orgId, run.recordTypeId);
  const problem = columnMappingProblem(mapping, importTargetsFor(defs));
  if (problem) {
    redirect(`${back}?error=mapping&detail=${encodeURIComponent(problem)}`);
  }

  const lookups = await buildImportLookups(user.orgId, run.recordTypeId);
  const validated = validateImportRows(headers, dataRows, mapping, defs, lookups);

  await db
    .update(schema.importRuns)
    .set({
      columnMapping: mapping,
      status: "MAPPED",
      validCount: validated.validCount,
      errorCount: validated.errorCount,
      errors: validated.errors.slice(0, IMPORT_ERROR_DISPLAY_CAP),
    })
    .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, user.orgId)));

  redirect(`${back}?mapped=1`);
}

/** "Back to mapping" from the validation summary. */
export async function backToImportMapping(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/records/import");
  const id = idParse.data;

  if (checkRole(user, "record:write")) redirect(`/records/import/${id}?error=forbidden`);

  await db
    .update(schema.importRuns)
    .set({ status: "UPLOADED" })
    .where(
      and(
        eq(schema.importRuns.id, id),
        eq(schema.importRuns.orgId, user.orgId),
        eq(schema.importRuns.status, "MAPPED"),
      ),
    );

  redirect(`/records/import/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Step 3 — commit                                                             */
/* -------------------------------------------------------------------------- */

export async function commitImport(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/records/import");
  const id = idParse.data;
  const back = `/records/import/${id}`;
  const skipInvalid = formData.get("skipInvalid") === "on";

  if (checkRole(user, "record:write")) redirect(`${back}?error=forbidden`);

  const limited = rateLimit("importCommit", user.id);
  if (!limited.ok) redirect(`${back}?error=rate_limited`);

  // Double-submit guard: only one commit wins the MAPPED → RUNNING flip.
  const claimed = await db
    .update(schema.importRuns)
    .set({ status: "RUNNING", skipInvalid })
    .where(
      and(
        eq(schema.importRuns.id, id),
        eq(schema.importRuns.orgId, user.orgId),
        eq(schema.importRuns.status, "MAPPED"),
      ),
    )
    .returning({
      recordTypeId: schema.importRuns.recordTypeId,
      storageKey: schema.importRuns.storageKey,
      columnMapping: schema.importRuns.columnMapping,
      fileName: schema.importRuns.fileName,
    });
  if (claimed.length === 0) redirect(`${back}?error=not_ready`);
  const run = claimed[0];

  const fail = async (message: string): Promise<never> => {
    await db
      .update(schema.importRuns)
      .set({ status: "FAILED", error: message, completedAt: new Date() })
      .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, user.orgId)));
    redirect(`${back}?error=failed`);
  };

  const rows = await readRunCsv(run.storageKey);
  if (!rows || rows.length < 1) return fail("The uploaded file could no longer be read.");
  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Re-validate: statuses may have been renamed and references taken since
  // the MAPPED pass — stale validation must never insert.
  const defs = await listCustomFieldDefs(user.orgId, run.recordTypeId);
  const lookups = await buildImportLookups(user.orgId, run.recordTypeId);
  const validated = validateImportRows(headers, dataRows, run.columnMapping, defs, lookups);

  if (validated.errorCount > 0 && !skipInvalid) {
    await db
      .update(schema.importRuns)
      .set({
        status: "MAPPED",
        validCount: validated.validCount,
        errorCount: validated.errorCount,
        errors: validated.errors.slice(0, IMPORT_ERROR_DISPLAY_CAP),
      })
      .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, user.orgId)));
    redirect(`${back}?error=has_errors`);
  }

  const values = validated.rows
    .map((r) => r.values)
    .filter((v): v is ImportRecordValues => v !== null);

  const insertedIds: string[] = [];
  try {
    await db.transaction(async (tx) => {
      for (let offset = 0; offset < values.length; offset += INSERT_CHUNK) {
        const chunk = values.slice(offset, offset + INSERT_CHUNK);
        const inserted = await tx
          .insert(schema.records)
          .values(
            chunk.map((v) => ({
              orgId: user.orgId,
              recordTypeId: run.recordTypeId,
              title: v.title,
              reference: v.reference,
              subjectName: v.subjectName,
              statusId: v.statusId,
              assigneeId: v.assigneeId,
              openedDate: v.openedDate ? new Date(v.openedDate) : null,
              dueDate: v.dueDate ? new Date(v.dueDate) : null,
              customValues: v.customValues,
              createdById: user.id,
              updatedById: user.id,
            })),
          )
          .returning({ id: schema.records.id });
        insertedIds.push(...inserted.map((r) => r.id));

        // Per-record `create` audit entries — imported records must have a
        // real activity timeline, exactly like form-created ones.
        await tx.insert(schema.auditLog).values(
          inserted.map((row, i) => ({
            orgId: user.orgId,
            userId: user.id,
            entity: "record",
            entityId: row.id,
            action: "create",
            diff: diffFields({}, importSnapshot(chunk[i], run.recordTypeId)),
          })),
        );
      }

      await recordAudit(
        {
          orgId: user.orgId,
          userId: user.id,
          entity: "import_run",
          entityId: id,
          action: "import",
          diff: {
            fileName: run.fileName,
            imported: values.length,
            skippedInvalid: validated.errorCount,
          },
        },
        tx,
      );

      await tx
        .update(schema.importRuns)
        .set({
          status: "COMPLETED",
          validCount: validated.validCount,
          errorCount: validated.errorCount,
          errors: validated.errors.slice(0, IMPORT_ERROR_DISPLAY_CAP),
          importedCount: values.length,
          completedAt: new Date(),
        })
        .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, user.orgId)));
    });
  } catch (err) {
    importLog.error("import commit failed", { importRunId: id, err });
    const message = isUniqueViolation(err)
      ? "A reference was taken by another writer while the import was running — nothing was imported. Re-check and try again."
      : "The import failed part-way and was rolled back — nothing was imported.";
    return fail(message);
  }

  importLog.info("import completed", {
    importRunId: id,
    imported: values.length,
    skipped: validated.errorCount,
  });

  // ONE batch event, not N record.created posts — a 5,000-row import must
  // not turn into 5,000 outbound requests. Subscribers fetch details.
  const importedPayload = {
    importRunId: id,
    recordTypeId: run.recordTypeId,
    fileName: run.fileName,
    recordCount: insertedIds.length,
    recordIds: insertedIds.slice(0, 100),
    truncated: insertedIds.length > 100,
    actor: user.email,
  };
  after(() => emitRecordEvent(user.orgId, "record.imported", importedPayload));

  revalidatePath("/records");
  redirect(`${back}?done=1`);
}

/** Audit-diff snapshot for one imported row (same shape as record create). */
function importSnapshot(v: ImportRecordValues, recordTypeId: string): Record<string, unknown> {
  return {
    title: v.title,
    reference: v.reference,
    subjectName: v.subjectName,
    recordTypeId,
    statusId: v.statusId,
    assigneeId: v.assigneeId,
    openedDate: v.openedDate,
    dueDate: v.dueDate,
    ...snapshotCustomValues(v.customValues),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
