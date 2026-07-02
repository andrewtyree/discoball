"use server";
/**
 * Template mutations — upload, mapping edits, delete, activate/deactivate.
 *
 * Same authorization pattern as every mutation: session → RBAC
 * (`template:write`) → Zod-validate → verify referenced rows belong to the
 * caller's org → write → audit entry.
 *
 * Upload and mapping edits return a form state (for useActionState) so
 * validation problems ("that's not a .docx") come back as messages instead of
 * redirects; delete/toggle are plain form actions that round-trip via query
 * params like the record-detail panels.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { diffFields, recordAudit } from "@/lib/audit";
import { requireSessionUser, type SessionUser } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { deleteObject, putObject } from "@/lib/storage";
import { discoverTemplatePlaceholders, InvalidTemplateError } from "./discover";
import { listMappingSources } from "./queries";
import { customSourcePath, MAPPING_SOURCES } from "./resolve";

export type TemplateFormState =
  | { status: "idle" }
  | { status: "error"; message: string };

// 10 MB. The serverActions bodySizeLimit sits ABOVE this (see next.config.mjs)
// so multipart overhead never trips the transport limit first — this friendly
// check is the one users see.
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

/** Form field prefix for mapping entries: `map_<placeholder>` → source path. */
const MAPPING_FIELD_PREFIX = "map_";

function checkRole(user: SessionUser, permission: Parameters<typeof assertCan>[1]): string | null {
  try {
    assertCan(user.role, permission);
    return null;
  } catch {
    return `Your role (${user.role}) doesn't have permission to do this.`;
  }
}

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

/** Postgres foreign_key_violation — same shape as isUniqueViolation in
 *  records/actions.ts. */
function isForeignKeyViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23503"
  );
}

const templateMetaSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()),
  recordTypeId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
});

/** A non-null recordTypeId must belong to the caller's org. */
async function validateRecordType(orgId: string, recordTypeId: string | null): Promise<string | null> {
  if (!recordTypeId) return null;
  const [type] = await db
    .select({ id: schema.recordTypes.id })
    .from(schema.recordTypes)
    .where(and(eq(schema.recordTypes.id, recordTypeId), eq(schema.recordTypes.orgId, orgId)));
  return type ? null : "Unknown record type.";
}

/* -------------------------------------------------------------------------- */
/* Upload                                                                      */
/* -------------------------------------------------------------------------- */

export async function uploadTemplate(
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "template:write");
  if (forbidden) return { status: "error", message: forbidden };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a .docx template file to upload." };
  }
  if (!file.name.toLowerCase().endsWith(".docx")) {
    return { status: "error", message: "Templates must be .docx files." };
  }
  if (file.size > MAX_TEMPLATE_BYTES) {
    return { status: "error", message: "Template files must be 10 MB or smaller." };
  }

  const meta = templateMetaSchema.safeParse({
    // Blank name falls back to the uploaded file's base name.
    name:
      (typeof formData.get("name") === "string" && (formData.get("name") as string).trim()) ||
      file.name.replace(/\.docx$/i, ""),
    description: formData.get("description"),
    recordTypeId: formData.get("recordTypeId"),
  });
  if (!meta.success) {
    return { status: "error", message: meta.error.issues[0]?.message ?? "Invalid input" };
  }

  const typeError = await validateRecordType(user.orgId, meta.data.recordTypeId);
  if (typeError) return { status: "error", message: typeError };

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Magic check: every .docx is a zip and starts with "PK\x03\x04".
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return { status: "error", message: "That file isn't a valid .docx (wrong file signature)." };
  }

  let placeholders: string[];
  try {
    placeholders = discoverTemplatePlaceholders(bytes);
  } catch (err) {
    if (err instanceof InvalidTemplateError) {
      return { status: "error", message: err.message };
    }
    throw err;
  }

  // Prefill mappings where a placeholder name IS a known source path or a
  // custom-field key of the chosen record type.
  const knownSources = new Set(
    (await listMappingSources(user.orgId, meta.data.recordTypeId)).map((s) => s.path),
  );
  const fieldMappings: Record<string, string> = {};
  for (const tag of placeholders) {
    if (knownSources.has(tag)) fieldMappings[tag] = tag;
    else if (knownSources.has(customSourcePath(tag))) fieldMappings[tag] = customSourcePath(tag);
  }

  const storageKey = `templates/${crypto.randomUUID()}.docx`;
  await putObject(storageKey, bytes);

  // Row + audit entry commit atomically (the convention for every mutation).
  let createdId: string;
  try {
    createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.templates)
        .values({
          orgId: user.orgId,
          name: meta.data.name,
          description: meta.data.description,
          recordTypeId: meta.data.recordTypeId,
          storageKey,
          placeholders,
          fieldMappings,
          createdById: user.id,
        })
        .returning({ id: schema.templates.id });
      await recordAudit(
        {
          orgId: user.orgId,
          userId: user.id,
          entity: "template",
          entityId: created.id,
          action: "template_upload",
          diff: {
            name: meta.data.name,
            fileName: file.name,
            size: file.size,
            placeholders,
            prefilledMappings: fieldMappings,
          },
        },
        tx,
      );
      return created.id;
    });
  } catch (err) {
    await deleteObject(storageKey); // don't strand the uploaded file
    throw err;
  }

  revalidatePath("/templates");
  redirect(`/templates/${createdId}`);
}

/* -------------------------------------------------------------------------- */
/* Mapping / metadata edits                                                    */
/* -------------------------------------------------------------------------- */

export async function updateTemplateMappings(
  _prev: TemplateFormState,
  formData: FormData,
): Promise<TemplateFormState> {
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "template:write");
  if (forbidden) return { status: "error", message: forbidden };

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) return { status: "error", message: "Invalid form submission." };
  const id = idParse.data;

  const [before] = await db
    .select()
    .from(schema.templates)
    .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));
  if (!before) return { status: "error", message: "Template not found." };

  const meta = templateMetaSchema.safeParse({
    name: formData.get("name") ?? before.name,
    description: formData.get("description") ?? before.description ?? "",
    recordTypeId: formData.get("recordTypeId") ?? before.recordTypeId ?? "",
  });
  if (!meta.success) {
    return { status: "error", message: meta.error.issues[0]?.message ?? "Invalid input" };
  }
  const typeError = await validateRecordType(user.orgId, meta.data.recordTypeId);
  if (typeError) return { status: "error", message: typeError };

  const patternRaw = formData.get("outputNamePattern");
  const outputNamePattern =
    typeof patternRaw === "string" && patternRaw.trim() !== ""
      ? patternRaw.trim().slice(0, 200)
      : null;

  // Mapping entries: one form control per placeholder, named `map_<tag>`,
  // whose value is a source path ("" = leave unmapped). Only sources from the
  // catalog (fixed paths + the org's custom.<key> paths) are accepted.
  const validSources = new Set([
    ...MAPPING_SOURCES.map((s) => s.path),
    ...(await listMappingSources(user.orgId, meta.data.recordTypeId)).map((s) => s.path),
    // A template not restricted to a type may reference any org custom field.
    ...(meta.data.recordTypeId ? (await listMappingSources(user.orgId, null)).map((s) => s.path) : []),
  ]);

  const fieldMappings: Record<string, string> = {};
  for (const placeholder of before.placeholders) {
    const raw = formData.get(`${MAPPING_FIELD_PREFIX}${placeholder}`);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const source = raw.trim();
    if (!validSources.has(source)) {
      return { status: "error", message: `Unknown data source “${source}” for {${placeholder}}.` };
    }
    fieldMappings[placeholder] = source;
  }

  const after = {
    name: meta.data.name,
    description: meta.data.description,
    recordTypeId: meta.data.recordTypeId,
    outputNamePattern,
    fieldMappings,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(schema.templates)
      .set({ ...after, updatedAt: new Date() })
      .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));

    await recordAudit(
      {
        orgId: user.orgId,
        userId: user.id,
        entity: "template",
        entityId: id,
        action: "template_update",
        diff: diffFields(
          {
            name: before.name,
            description: before.description,
            recordTypeId: before.recordTypeId,
            outputNamePattern: before.outputNamePattern,
            fieldMappings: before.fieldMappings,
          },
          after,
        ),
      },
      tx,
    );
  });

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  redirect(`/templates/${id}?saved=1`);
}

/* -------------------------------------------------------------------------- */
/* Delete / activate                                                           */
/* -------------------------------------------------------------------------- */

export async function deleteTemplate(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/templates");
  const id = idParse.data;

  if (checkRole(user, "template:write")) redirect(`/templates/${id}?error=forbidden`);

  const [template] = await db
    .select()
    .from(schema.templates)
    .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));
  if (!template) redirect("/templates");

  // Generation runs reference the template (history/audit); block deletion
  // instead of cascading history away — deactivate hides it from use.
  const [{ runCount }] = await db
    .select({ runCount: count() })
    .from(schema.generationRuns)
    .where(eq(schema.generationRuns.templateId, id));
  if (runCount > 0) redirect(`/templates/${id}?error=has_runs`);

  // The hard delete and its audit entry commit atomically; the file is
  // removed AFTER the commit, best-effort — a stranded file under STORAGE_DIR
  // is recoverable, a permanent delete with no audit trail is not.
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.templates)
        .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));
      await recordAudit(
        {
          orgId: user.orgId,
          userId: user.id,
          entity: "template",
          entityId: id,
          action: "template_delete",
          diff: { name: template.name },
        },
        tx,
      );
    });
  } catch (err) {
    // A generation run inserted its FK reference between the count above and
    // the delete — same outcome as the pre-check, minus the race.
    if (isForeignKeyViolation(err)) redirect(`/templates/${id}?error=has_runs`);
    throw err;
  }

  try {
    await deleteObject(template.storageKey);
  } catch (err) {
    console.error(`Template ${id} deleted but its file ${template.storageKey} was not:`, err);
  }

  revalidatePath("/templates");
  redirect("/templates?deleted=1");
}

export async function toggleTemplateActive(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect("/templates");
  const id = idParse.data;

  if (checkRole(user, "template:write")) redirect(`/templates/${id}?error=forbidden`);

  const [template] = await db
    .select({ id: schema.templates.id, isActive: schema.templates.isActive })
    .from(schema.templates)
    .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));
  if (!template) redirect("/templates");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.templates)
      .set({ isActive: !template.isActive, updatedAt: new Date() })
      .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, user.orgId)));

    await recordAudit(
      {
        orgId: user.orgId,
        userId: user.id,
        entity: "template",
        entityId: id,
        action: "template_toggle",
        diff: { isActive: { from: template.isActive, to: !template.isActive } },
      },
      tx,
    );
  });

  revalidatePath("/templates");
  revalidatePath(`/templates/${id}`);
  redirect(`/templates/${id}`);
}
