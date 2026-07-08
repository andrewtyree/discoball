"use server";
/**
 * Batch generation — the Phase 3 headline: select records with the SAME
 * validated filter as the records list, merge each into an uploaded template,
 * and store one downloadable artifact, with a `generation_runs` row as the
 * permanent history of who generated what.
 *
 * Ordering matters (roadmap acceptance): mappings are validated FIRST, and a
 * template with unmapped placeholders produces a FAILED run naming the tags
 * verbatim — it never silently merges blanks. Per-record empty values do not
 * fail the run; they are recorded in `warnings` ("BLK-0007: subjectName
 * empty") so the user can spot thin documents.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import { z } from "zod";

import { db, schema } from "@/db";
import { recordAudit } from "@/lib/audit";
import { requireSessionUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  recordFilterFromSearchParams,
  recordFilterToSearchParams,
  type RecordFilter,
} from "@/lib/records/filters";
import { can } from "@/lib/rbac";
import { getObject, putObject } from "@/lib/storage";
import { renderDocx, toPdf } from "./engine";
import { validateMappings } from "./placeholders";
import {
  customFieldDefsByRecordType,
  GENERATION_RECORD_CAP,
  getRecordForGeneration,
  getTemplate,
  listRecordsForGeneration,
  type GenerationRecordRow,
} from "./queries";
import {
  buildRenderData,
  resolveOutputName,
  sanitizeFileName,
  uniqueFileName,
} from "./resolve";

type OutputMode = "DOCX" | "PDF" | "ZIP";

/** Outputs are buffered in memory until the artifact is assembled; bound the
 *  worst case (template-sized docx per record plus the zip copy) so a large
 *  template × a big batch can't OOM the shared server process. */
const MAX_RUN_OUTPUT_BYTES = 200 * 1024 * 1024; // 200 MB

/** Filter form fields forwarded into `recordFilterFromSearchParams`. */
const FILTER_KEYS = [
  "search",
  "type",
  "status",
  "assignee",
  "state",
  "dueFrom",
  "dueTo",
  "archived",
] as const;

function filterFromFormData(formData: FormData): RecordFilter {
  const raw: Record<string, string | undefined> = {};
  for (const key of FILTER_KEYS) {
    const v = formData.get(key);
    if (typeof v === "string") raw[key] = v;
  }
  return recordFilterFromSearchParams(raw);
}

/** Run failures are rendered verbatim in the run history, so never leak raw
 *  system errors (absolute fs paths etc.). Node system errors carry a string
 *  `code`; intentional user-facing throws don't. */
function runErrorMessage(err: unknown): string {
  if (err instanceof Error && !("code" in err)) return err.message;
  return "Generation failed — the template file could not be read. Try re-uploading the template.";
}

export async function runGeneration(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const templateIdParse = z.string().uuid().safeParse(formData.get("templateId"));
  if (!templateIdParse.success) redirect("/templates");
  const templateId = templateIdParse.data;

  if (!can(user.role, "generation:run")) {
    redirect(`/templates/${templateId}?error=forbidden`);
  }

  const modeParse = z.enum(["DOCX", "PDF", "ZIP"]).safeParse(formData.get("outputMode"));
  if (!modeParse.success) redirect(`/templates/${templateId}?error=invalid`);
  const outputMode: OutputMode = modeParse.data;

  const previewParse = z
    .string()
    .uuid()
    .optional()
    .safeParse(formData.get("previewRecordId") || undefined);
  // A malformed preview id must not silently degrade into a full batch run.
  if (!previewParse.success) redirect(`/templates/${templateId}?error=invalid`);
  const previewRecordId = previewParse.data;

  const template = await getTemplate(user.orgId, templateId);
  if (!template) redirect("/templates");
  if (!template.isActive) redirect(`/templates/${templateId}?error=inactive`);

  const filter = filterFromFormData(formData);
  const filterJson: Record<string, unknown> = Object.fromEntries(
    recordFilterToSearchParams(filter).entries(),
  );
  if (previewRecordId) filterJson.previewRecordId = previewRecordId;

  // ---- Mapping validation FIRST: an unmapped placeholder is reported, never
  // silently mis-filled. The run row exists so the failure is visible history.
  const validation = validateMappings(template.placeholders, template.fieldMappings);
  if (!validation.isComplete) {
    const tags = validation.unmapped.map((t) => `{${t}}`).join(", ");
    const [failed] = await db
      .insert(schema.generationRuns)
      .values({
        orgId: user.orgId,
        templateId,
        filter: filterJson,
        outputMode,
        status: "FAILED",
        error: `Template has unmapped placeholders: ${tags}. Map them before generating.`,
        completedAt: new Date(),
        createdById: user.id,
      })
      .returning({ id: schema.generationRuns.id });
    await auditRun(user.orgId, user.id, failed.id, templateId, outputMode, "FAILED", 0);
    revalidatePath(`/templates/${templateId}`);
    redirect(`/templates/${templateId}?run=${failed.id}`);
  }

  const [run] = await db
    .insert(schema.generationRuns)
    .values({
      orgId: user.orgId,
      templateId,
      filter: filterJson,
      outputMode,
      status: "RUNNING",
      createdById: user.id,
    })
    .returning({ id: schema.generationRuns.id });

  let finalStatus: "COMPLETED" | "FAILED" = "COMPLETED";
  let recordCount = 0;
  try {
    // Over-fetch by one so a filter matching exactly the cap isn't
    // misreported as capped — only a genuine 501st row triggers truncation.
    const fetched: GenerationRecordRow[] = previewRecordId
      ? await getRecordForGeneration(user.orgId, previewRecordId).then((r) => (r ? [r] : []))
      : await listRecordsForGeneration(user.orgId, filter, GENERATION_RECORD_CAP + 1);
    if (fetched.length === 0) {
      throw new Error(
        previewRecordId ? "Record not found." : "No records matched the filter.",
      );
    }
    const capped = !previewRecordId && fetched.length > GENERATION_RECORD_CAP;
    const records = capped ? fetched.slice(0, GENERATION_RECORD_CAP) : fetched;
    recordCount = records.length;

    const templateBytes = await getObject(template.storageKey);
    const defsByType = await customFieldDefsByRecordType(user.orgId);
    const warnings: string[] = [];
    if (capped) {
      warnings.push(
        `Run capped at ${GENERATION_RECORD_CAP} records; narrow the filter to cover the rest.`,
      );
    }

    // Every rendered document is roughly template-sized (embedded media pass
    // through the merge), so fail fast with a clear error instead of
    // buffering our way into an out-of-memory crash.
    const estimatedBytes = templateBytes.byteLength * records.length;
    if (estimatedBytes > MAX_RUN_OUTPUT_BYTES) {
      const mb = (n: number) => Math.ceil(n / (1024 * 1024));
      throw new Error(
        `This run would generate roughly ${mb(estimatedBytes)} MB of documents ` +
          `(${records.length} records × a ${mb(templateBytes.byteLength)} MB template), ` +
          `over the ${mb(MAX_RUN_OUTPUT_BYTES)} MB per-run limit. ` +
          `Narrow the filter or use a smaller template.`,
      );
    }

    const usedNames = new Set<string>();
    const outputs: { name: string; docx: Uint8Array; pdf?: Uint8Array }[] = [];
    for (const record of records) {
      const defs = defsByType.get(record.recordTypeId) ?? [];
      const label = record.reference ?? record.title;
      const { data, missing } = buildRenderData(record, defs, template.fieldMappings);
      for (const tag of missing) warnings.push(`${label}: ${tag} empty`);

      const rendered = await renderDocx(templateBytes, { data });
      for (const tag of rendered.missingTags) {
        if (!missing.includes(tag)) warnings.push(`${label}: {${tag}} had no value`);
      }

      const name = uniqueFileName(
        sanitizeFileName(resolveOutputName(template.outputNamePattern, record, defs)),
        `record-${record.id.slice(0, 8)}`,
        usedNames,
      );
      const needsPdf = outputMode === "PDF" || outputMode === "ZIP";
      outputs.push({
        name,
        docx: rendered.bytes,
        pdf: needsPdf ? await toPdf(rendered.bytes) : undefined,
      });
    }

    // ---- Assemble the artifact.
    let artifactBytes: Uint8Array;
    let extension: "docx" | "pdf" | "zip";
    if (outputs.length === 1 && outputMode === "DOCX") {
      artifactBytes = outputs[0].docx;
      extension = "docx";
    } else if (outputs.length === 1 && outputMode === "PDF") {
      artifactBytes = outputs[0].pdf as Uint8Array;
      extension = "pdf";
    } else {
      const zip = new PizZip();
      for (const out of outputs) {
        if (outputMode !== "PDF") zip.file(`${out.name}.docx`, out.docx);
        if (out.pdf) zip.file(`${out.name}.pdf`, out.pdf);
      }
      artifactBytes = zip.generate({ type: "uint8array", compression: "DEFLATE" });
      extension = "zip";
    }

    const resultStorageKey = `runs/${run.id}.${extension}`;
    await putObject(resultStorageKey, artifactBytes);

    await db
      .update(schema.generationRuns)
      .set({
        status: "COMPLETED",
        recordCount,
        resultStorageKey,
        warnings,
        completedAt: new Date(),
      })
      .where(eq(schema.generationRuns.id, run.id));
  } catch (err) {
    finalStatus = "FAILED";
    // The stored message is user-facing; keep the raw error in the log.
    logger.error("generation run failed", { runId: run.id, templateId, err });
    await db
      .update(schema.generationRuns)
      .set({
        status: "FAILED",
        recordCount,
        error: runErrorMessage(err).slice(0, 2000),
        completedAt: new Date(),
      })
      .where(eq(schema.generationRuns.id, run.id));
  }

  await auditRun(user.orgId, user.id, run.id, templateId, outputMode, finalStatus, recordCount);
  revalidatePath(`/templates/${templateId}`);
  redirect(`/templates/${templateId}?run=${run.id}`);
}

async function auditRun(
  orgId: string,
  userId: string,
  runId: string,
  templateId: string,
  outputMode: OutputMode,
  status: "COMPLETED" | "FAILED",
  recordCount: number,
): Promise<void> {
  await recordAudit({
    orgId,
    userId,
    entity: "generation_run",
    entityId: runId,
    action: "generation_run",
    diff: { templateId, outputMode, status, recordCount },
  });
}
