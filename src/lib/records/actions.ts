"use server";
/**
 * Record mutations — the Phase 1 authorization pattern in one place.
 *
 * Every action: resolve the session user → RBAC `assertCan` → Zod-validate the
 * input → verify referenced rows belong to the caller's org → write inside a
 * transaction → append an audit entry. Updates are optimistic-concurrency
 * guarded: the UPDATE only matches while `version` is still what the form
 * loaded, and a stale write returns a conflict for the UI to resolve.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { diffFields } from "@/lib/audit";
import { requireSessionUser, type SessionUser } from "@/lib/auth";
import { isStaleWrite } from "@/lib/records/concurrency";
import {
  CUSTOM_FIELD_PREFIX,
  formatCustomValue,
  parseCustomValues,
  snapshotCustomValues,
  type CustomFieldDef,
} from "@/lib/records/custom-fields";
import { assertCan } from "@/lib/rbac";
import { ymd } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Form state (returned to useActionState in the record form)                  */
/* -------------------------------------------------------------------------- */

/**
 * The user's submitted values, echoed back verbatim on error/conflict. React
 * resets uncontrolled form fields to their defaultValue after an action
 * completes, so the form re-renders these as the defaults — otherwise the
 * user's in-progress edits would be silently discarded on a failed save.
 * Custom multi-select fields echo as arrays; everything else as strings.
 */
export type RecordFormEcho = Record<string, string | string[]>;

export type RecordFormState =
  | { status: "idle" }
  | { status: "error"; message: string; values?: RecordFormEcho }
  | {
      status: "conflict";
      message: string;
      /** The version now in the database; resubmitting against it overwrites. */
      freshVersion: number;
      /** The other writer's values, for side-by-side comparison in the banner. */
      theirs: { label: string; value: string }[];
      values: RecordFormEcho;
    };

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

/** `<input type="date">` posts "" or "yyyy-mm-dd"; both must survive Zod. */
const optionalDate = z.preprocess((v) => {
  if (typeof v !== "string" || v.trim() === "") return null;
  return new Date(v);
}, z.date({ invalid_type_error: "Invalid date" }).nullable());

const recordInputSchema = z.object({
  title: z.string({ required_error: "Title is required" }).trim().min(1, "Title is required").max(300),
  reference: z.preprocess(emptyToNull, z.string().trim().max(100).nullable()),
  subjectName: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  recordTypeId: z.string().uuid("Pick a record type"),
  statusId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  assigneeId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  openedDate: optionalDate,
  dueDate: optionalDate,
});

type RecordInput = z.infer<typeof recordInputSchema>;

const ECHO_FIELDS = [
  "title",
  "reference",
  "subjectName",
  "recordTypeId",
  "statusId",
  "assigneeId",
  "openedDate",
  "dueDate",
] as const;

/** What the user typed, form-shaped, for re-rendering after a failed save. */
function echoValues(formData: FormData): RecordFormEcho {
  const echo: RecordFormEcho = {};
  for (const field of ECHO_FIELDS) {
    const v = formData.get(field);
    if (typeof v === "string") echo[field] = v;
  }
  for (const key of new Set(formData.keys())) {
    if (!key.startsWith(CUSTOM_FIELD_PREFIX)) continue;
    const all = formData.getAll(key).filter((v): v is string => typeof v === "string");
    echo[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return echo;
}

/** One record type's field definitions, org-scoped. */
async function customFieldDefs(orgId: string, recordTypeId: string): Promise<CustomFieldDef[]> {
  return db
    .select({
      id: schema.customFields.id,
      key: schema.customFields.key,
      label: schema.customFields.label,
      fieldType: schema.customFields.fieldType,
      options: schema.customFields.options,
      required: schema.customFields.required,
      recordTypeId: schema.customFields.recordTypeId,
    })
    .from(schema.customFields)
    .where(
      and(
        eq(schema.customFields.orgId, orgId),
        eq(schema.customFields.recordTypeId, recordTypeId),
      ),
    );
}

/** USER/CONTACT custom values reference rows; make sure they're in the org. */
async function validateCustomRefs(
  orgId: string,
  defs: CustomFieldDef[],
  values: Record<string, unknown>,
): Promise<string | null> {
  for (const def of defs) {
    const value = values[def.key];
    if (typeof value !== "string" || value === "") continue;

    if (def.fieldType === "USER") {
      const [member] = await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.userId, value), eq(schema.memberships.orgId, orgId)),
        );
      if (!member) return `${def.label}: that user is not a member of this organization.`;
    } else if (def.fieldType === "CONTACT") {
      const [contact] = await db
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.id, value), eq(schema.contacts.orgId, orgId)));
      if (!contact) return `${def.label}: unknown contact.`;
    }
  }
  return null;
}

function parseRecordInput(formData: FormData): RecordInput | { error: string } {
  const parsed = recordInputSchema.safeParse({
    title: formData.get("title"),
    reference: formData.get("reference"),
    subjectName: formData.get("subjectName"),
    recordTypeId: formData.get("recordTypeId"),
    statusId: formData.get("statusId"),
    assigneeId: formData.get("assigneeId"),
    openedDate: formData.get("openedDate"),
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  return parsed.data;
}

/**
 * A client can post any UUIDs it likes; make sure the record type, status, and
 * assignee it references actually belong to the caller's organization.
 */
async function validateOrgRefs(orgId: string, input: RecordInput): Promise<string | null> {
  const [type] = await db
    .select({ id: schema.recordTypes.id })
    .from(schema.recordTypes)
    .where(and(eq(schema.recordTypes.id, input.recordTypeId), eq(schema.recordTypes.orgId, orgId)));
  if (!type) return "Unknown record type.";

  if (input.statusId) {
    const [status] = await db
      .select({ id: schema.statuses.id })
      .from(schema.statuses)
      .where(and(eq(schema.statuses.id, input.statusId), eq(schema.statuses.orgId, orgId)));
    if (!status) return "Unknown status.";
  }

  if (input.assigneeId) {
    const [member] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, input.assigneeId),
          eq(schema.memberships.orgId, orgId),
        ),
      );
    if (!member) return "The assignee is not a member of this organization.";
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function checkRole(user: SessionUser, permission: Parameters<typeof assertCan>[1]): string | null {
  try {
    assertCan(user.role, permission);
    return null;
  } catch {
    return `Your role (${user.role}) doesn't have permission to do this.`;
  }
}

/** The editable fields, as stored in audit diffs (dates as yyyy-mm-dd). */
function snapshot(rec: {
  title: string;
  reference: string | null;
  subjectName: string | null;
  recordTypeId: string;
  statusId: string | null;
  assigneeId: string | null;
  openedDate: Date | null;
  dueDate: Date | null;
}): Record<string, unknown> {
  return {
    title: rec.title,
    reference: rec.reference,
    subjectName: rec.subjectName,
    recordTypeId: rec.recordTypeId,
    statusId: rec.statusId,
    assigneeId: rec.assigneeId,
    openedDate: rec.openedDate ? ymd(rec.openedDate) : null,
    dueDate: rec.dueDate ? ymd(rec.dueDate) : null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
  );
}

const DUPLICATE_REFERENCE_MESSAGE =
  "That reference is already used by another record in this workspace.";

const CONFLICT_MESSAGE =
  "Someone else saved changes to this record while you were editing. " +
  "Their values are shown below — save again to overwrite them, or reload to discard yours.";

/** Resolve the other writer's row into labeled display values for the banner. */
async function conflictSnapshot(orgId: string, id: string) {
  const fresh = await db.query.records.findFirst({
    where: and(eq(schema.records.id, id), eq(schema.records.orgId, orgId)),
    with: { recordType: true, status: true, assignee: true },
  });
  if (!fresh) return null;

  const theirs = [
    { label: "Title", value: fresh.title },
    { label: "Reference", value: fresh.reference ?? "—" },
    { label: "Subject", value: fresh.subjectName ?? "—" },
    { label: "Type", value: fresh.recordType?.name ?? "—" },
    { label: "Status", value: fresh.status?.name ?? "—" },
    { label: "Assignee", value: fresh.assignee?.name ?? fresh.assignee?.email ?? "—" },
    { label: "Opened", value: fresh.openedDate ? ymd(fresh.openedDate) : "—" },
    { label: "Due", value: fresh.dueDate ? ymd(fresh.dueDate) : "—" },
  ];

  // Custom fields of the fresh row's type, with USER/CONTACT ids resolved to
  // names so the banner is readable.
  const defs = await customFieldDefs(orgId, fresh.recordTypeId);
  if (defs.length > 0) {
    const refIds = defs
      .filter((d) => d.fieldType === "USER" || d.fieldType === "CONTACT")
      .map((d) => fresh.customValues[d.key])
      .filter((v): v is string => typeof v === "string" && v !== "");
    const names = new Map<string, string>();
    if (refIds.length > 0) {
      const [userRows, contactRows] = await Promise.all([
        db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, refIds)),
        db
          .select({ id: schema.contacts.id, displayName: schema.contacts.displayName })
          .from(schema.contacts)
          .where(inArray(schema.contacts.id, refIds)),
      ]);
      for (const u of userRows) names.set(u.id, u.name ?? u.email);
      for (const c of contactRows) names.set(c.id, c.displayName);
    }
    for (const def of defs) {
      theirs.push({
        label: def.label,
        value: formatCustomValue(def, fresh.customValues[def.key], (rid) => names.get(rid)),
      });
    }
  }

  return { freshVersion: fresh.version, theirs };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export async function createRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const echo = echoValues(formData);
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "record:write");
  if (forbidden) return { status: "error", message: forbidden, values: echo };

  const input = parseRecordInput(formData);
  if ("error" in input) return { status: "error", message: input.error, values: echo };

  const refError = await validateOrgRefs(user.orgId, input);
  if (refError) return { status: "error", message: refError, values: echo };

  const defs = await customFieldDefs(user.orgId, input.recordTypeId);
  const custom = parseCustomValues(defs, formData);
  if (!custom.ok) return { status: "error", message: custom.error, values: echo };
  const customRefError = await validateCustomRefs(user.orgId, defs, custom.values);
  if (customRefError) return { status: "error", message: customRefError, values: echo };

  let createdId: string;
  try {
    createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.records)
        .values({
          orgId: user.orgId,
          ...input,
          customValues: custom.values,
          createdById: user.id,
          updatedById: user.id,
        })
        .returning({ id: schema.records.id });

      await tx.insert(schema.auditLog).values({
        orgId: user.orgId,
        userId: user.id,
        entity: "record",
        entityId: created.id,
        action: "create",
        diff: diffFields({}, { ...snapshot(input), ...snapshotCustomValues(custom.values) }),
      });

      return created.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: "error", message: DUPLICATE_REFERENCE_MESSAGE, values: echo };
    }
    throw err;
  }

  revalidatePath("/records");
  redirect(`/records/${createdId}?saved=1`);
}

export async function updateRecord(
  _prev: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const echo = echoValues(formData);
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "record:write");
  if (forbidden) return { status: "error", message: forbidden, values: echo };

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  const versionParse = z.coerce.number().int().positive().safeParse(formData.get("expectedVersion"));
  if (!idParse.success || !versionParse.success) {
    return { status: "error", message: "Invalid form submission.", values: echo };
  }
  const id = idParse.data;
  const expectedVersion = versionParse.data;

  const input = parseRecordInput(formData);
  if ("error" in input) return { status: "error", message: input.error, values: echo };

  const refError = await validateOrgRefs(user.orgId, input);
  if (refError) return { status: "error", message: refError, values: echo };

  const defs = await customFieldDefs(user.orgId, input.recordTypeId);
  const custom = parseCustomValues(defs, formData);
  if (!custom.ok) return { status: "error", message: custom.error, values: echo };
  const customRefError = await validateCustomRefs(user.orgId, defs, custom.values);
  if (customRefError) return { status: "error", message: customRefError, values: echo };

  const before = await db.query.records.findFirst({
    where: and(eq(schema.records.id, id), eq(schema.records.orgId, user.orgId)),
  });
  if (!before) return { status: "error", message: "Record not found.", values: echo };

  if (isStaleWrite(before.version, expectedVersion)) {
    const conflict = await conflictSnapshot(user.orgId, id);
    if (!conflict) return { status: "error", message: "Record not found.", values: echo };
    return { status: "conflict", message: CONFLICT_MESSAGE, values: echo, ...conflict };
  }

  try {
    const updated = await db.transaction(async (tx) => {
      // The version guard in the WHERE clause is what makes this write safe
      // under concurrency: a stale form matches zero rows instead of clobbering.
      const rows = await tx
        .update(schema.records)
        .set({
          ...input,
          customValues: custom.values,
          version: sql`${schema.records.version} + 1`,
          updatedById: user.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.records.id, id),
            eq(schema.records.orgId, user.orgId),
            eq(schema.records.version, expectedVersion),
          ),
        )
        .returning({ id: schema.records.id });
      if (rows.length === 0) return false;

      const diff = diffFields(
        { ...snapshot(before), ...snapshotCustomValues(before.customValues) },
        { ...snapshot(input), ...snapshotCustomValues(custom.values) },
      );
      await tx.insert(schema.auditLog).values({
        orgId: user.orgId,
        userId: user.id,
        entity: "record",
        entityId: id,
        action: "update",
        diff,
      });
      return true;
    });

    if (!updated) {
      // Raced between our read and the guarded UPDATE — same conflict, later.
      const conflict = await conflictSnapshot(user.orgId, id);
      if (!conflict) return { status: "error", message: "Record not found.", values: echo };
      return { status: "conflict", message: CONFLICT_MESSAGE, values: echo, ...conflict };
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { status: "error", message: DUPLICATE_REFERENCE_MESSAGE, values: echo };
    }
    throw err;
  }

  revalidatePath("/records");
  revalidatePath(`/records/${id}`);
  redirect(`/records/${id}?saved=1`);
}

async function setArchived(formData: FormData, archived: boolean): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/records");
  const id = idParse.data;

  if (checkRole(user, "record:delete")) {
    redirect(`/records/${id}?error=forbidden`);
  }

  const reasonRaw = formData.get("reason");
  const reason =
    archived && typeof reasonRaw === "string" && reasonRaw.trim() !== ""
      ? reasonRaw.trim().slice(0, 500)
      : null;

  await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.records)
      .set({
        isArchived: archived,
        archivedReason: reason,
        version: sql`${schema.records.version} + 1`,
        updatedById: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.records.id, id), eq(schema.records.orgId, user.orgId)))
      .returning({ id: schema.records.id });
    if (rows.length === 0) return;

    await tx.insert(schema.auditLog).values({
      orgId: user.orgId,
      userId: user.id,
      entity: "record",
      entityId: id,
      action: archived ? "archive" : "unarchive",
      diff: reason ? { reason } : null,
    });
  });

  revalidatePath("/records");
  revalidatePath(`/records/${id}`);
  redirect(`/records/${id}`);
}

/** Soft-delete: archive with an optional reason (requires record:delete). */
export async function archiveRecord(formData: FormData): Promise<void> {
  await setArchived(formData, true);
}

/** Restore an archived record (requires record:delete). */
export async function unarchiveRecord(formData: FormData): Promise<void> {
  await setArchived(formData, false);
}
