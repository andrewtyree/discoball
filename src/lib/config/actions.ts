"use server";
/**
 * Configuration mutations — record types, statuses, and custom fields.
 *
 * These editors are what keep the domain in data instead of code. Same
 * authorization pattern as record mutations: session → RBAC (`config:write`)
 * → Zod-validate → org-scoped write in a transaction → audit entry. The pages
 * are plain server-component forms, so outcomes travel as query params
 * (?ok=1, ?error=forbidden|invalid|duplicate|in-use) instead of action state.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { requireSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";

function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Gate + audit boilerplate shared by every config action. */
async function requireConfigUser(backTo: string) {
  const user = await requireSessionUser();
  if (!can(user.role, "config:write")) redirect(`${backTo}?error=forbidden`);
  return user;
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  user: { orgId: string; id: string },
  entity: string,
  entityId: string,
  action: string,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({
    orgId: user.orgId,
    userId: user.id,
    entity,
    entityId,
    action,
    diff: diff ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Record types                                                                */
/* -------------------------------------------------------------------------- */

const RECORD_TYPES_PATH = "/settings/record-types";

const recordTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  referencePrefix: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v || null),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => v || null),
});

export async function createRecordType(formData: FormData): Promise<void> {
  const user = await requireConfigUser(RECORD_TYPES_PATH);

  const parsed = recordTypeSchema.safeParse({
    name: formData.get("name") ?? "",
    referencePrefix: formData.get("referencePrefix") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) redirect(`${RECORD_TYPES_PATH}?error=invalid`);

  const [{ existing }] = await db
    .select({ existing: count() })
    .from(schema.recordTypes)
    .where(eq(schema.recordTypes.orgId, user.orgId));

  let duplicate = false;
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.recordTypes)
        .values({ orgId: user.orgId, ...parsed.data, sortOrder: existing })
        .returning({ id: schema.recordTypes.id });
      await audit(tx, user, "record_type", row.id, "create", { name: parsed.data.name });
    });
  } catch (err) {
    if (isPgError(err, UNIQUE_VIOLATION)) duplicate = true;
    else throw err;
  }
  if (duplicate) redirect(`${RECORD_TYPES_PATH}?error=duplicate`);

  revalidatePath(RECORD_TYPES_PATH);
  redirect(`${RECORD_TYPES_PATH}?ok=1`);
}

export async function toggleRecordTypeActive(formData: FormData): Promise<void> {
  const user = await requireConfigUser(RECORD_TYPES_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${RECORD_TYPES_PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: schema.recordTypes.isActive })
      .from(schema.recordTypes)
      .where(and(eq(schema.recordTypes.id, id.data), eq(schema.recordTypes.orgId, user.orgId)));
    if (!current) return;

    await tx
      .update(schema.recordTypes)
      .set({ isActive: !current.isActive })
      .where(and(eq(schema.recordTypes.id, id.data), eq(schema.recordTypes.orgId, user.orgId)));
    await audit(tx, user, "record_type", id.data, current.isActive ? "deactivate" : "activate");
  });

  revalidatePath(RECORD_TYPES_PATH);
  redirect(RECORD_TYPES_PATH);
}

export async function deleteRecordType(formData: FormData): Promise<void> {
  const user = await requireConfigUser(RECORD_TYPES_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${RECORD_TYPES_PATH}?error=invalid`);

  let inUse = false;
  try {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.recordTypes)
        .where(and(eq(schema.recordTypes.id, id.data), eq(schema.recordTypes.orgId, user.orgId)))
        .returning({ name: schema.recordTypes.name });
      if (deleted.length > 0) {
        await audit(tx, user, "record_type", id.data, "delete", { name: deleted[0].name });
      }
    });
  } catch (err) {
    // Records still reference this type; deactivating is the supported path.
    if (isPgError(err, FOREIGN_KEY_VIOLATION)) inUse = true;
    else throw err;
  }
  if (inUse) redirect(`${RECORD_TYPES_PATH}?error=in-use`);

  revalidatePath(RECORD_TYPES_PATH);
  redirect(RECORD_TYPES_PATH);
}

/* -------------------------------------------------------------------------- */
/* Statuses                                                                    */
/* -------------------------------------------------------------------------- */

const STATUSES_PATH = "/settings/statuses";

const statusSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "CLOSED"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color"),
});

export async function createStatus(formData: FormData): Promise<void> {
  const user = await requireConfigUser(STATUSES_PATH);

  const parsed = statusSchema.safeParse({
    name: formData.get("name") ?? "",
    category: formData.get("category"),
    color: formData.get("color") ?? "#6366f1",
  });
  if (!parsed.success) redirect(`${STATUSES_PATH}?error=invalid`);

  // No DB unique constraint on status names — enforce per-org uniqueness here.
  const [dup] = await db
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(and(eq(schema.statuses.orgId, user.orgId), eq(schema.statuses.name, parsed.data.name)));
  if (dup) redirect(`${STATUSES_PATH}?error=duplicate`);

  const [{ existing }] = await db
    .select({ existing: count() })
    .from(schema.statuses)
    .where(eq(schema.statuses.orgId, user.orgId));

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.statuses)
      .values({
        orgId: user.orgId,
        ...parsed.data,
        isDefault: existing === 0,
        sortOrder: existing,
      })
      .returning({ id: schema.statuses.id });
    await audit(tx, user, "status", row.id, "create", { name: parsed.data.name });
  });

  revalidatePath(STATUSES_PATH);
  redirect(`${STATUSES_PATH}?ok=1`);
}

export async function setDefaultStatus(formData: FormData): Promise<void> {
  const user = await requireConfigUser(STATUSES_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${STATUSES_PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: schema.statuses.id, name: schema.statuses.name })
      .from(schema.statuses)
      .where(and(eq(schema.statuses.id, id.data), eq(schema.statuses.orgId, user.orgId)));
    if (!target) return;

    await tx
      .update(schema.statuses)
      .set({ isDefault: false })
      .where(eq(schema.statuses.orgId, user.orgId));
    await tx
      .update(schema.statuses)
      .set({ isDefault: true })
      .where(eq(schema.statuses.id, target.id));
    await audit(tx, user, "status", target.id, "set-default", { name: target.name });
  });

  revalidatePath(STATUSES_PATH);
  redirect(STATUSES_PATH);
}

export async function deleteStatus(formData: FormData): Promise<void> {
  const user = await requireConfigUser(STATUSES_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${STATUSES_PATH}?error=invalid`);

  let inUse = false;
  try {
    await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.statuses)
        .where(and(eq(schema.statuses.id, id.data), eq(schema.statuses.orgId, user.orgId)))
        .returning({ name: schema.statuses.name });
      if (deleted.length > 0) {
        await audit(tx, user, "status", id.data, "delete", { name: deleted[0].name });
      }
    });
  } catch (err) {
    if (isPgError(err, FOREIGN_KEY_VIOLATION)) inUse = true;
    else throw err;
  }
  if (inUse) redirect(`${STATUSES_PATH}?error=in-use`);

  revalidatePath(STATUSES_PATH);
  redirect(STATUSES_PATH);
}

/* -------------------------------------------------------------------------- */
/* Custom fields                                                               */
/* -------------------------------------------------------------------------- */

const FIELDS_PATH = "/settings/fields";

const FIELD_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
  "USER",
  "CONTACT",
] as const;

const customFieldSchema = z.object({
  recordTypeId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  key: z.string().trim().max(60),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean(),
  options: z.string().trim().max(2000),
});

/** Derive a stable machine key ("Court Room #2" → "court_room_2"). */
function keyify(label: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")
    .trim()
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^\d/.test(key) ? `f_${key}` : key;
}

export async function createCustomField(formData: FormData): Promise<void> {
  const user = await requireConfigUser(FIELDS_PATH);

  const parsed = customFieldSchema.safeParse({
    recordTypeId: formData.get("recordTypeId"),
    label: formData.get("label") ?? "",
    key: formData.get("key") ?? "",
    fieldType: formData.get("fieldType"),
    required: formData.get("required") === "1",
    options: formData.get("options") ?? "",
  });
  if (!parsed.success) redirect(`${FIELDS_PATH}?error=invalid`);
  const input = parsed.data;

  const key = keyify(input.key || input.label);
  if (!key) redirect(`${FIELDS_PATH}?error=invalid`);

  // Options only make sense for choice fields; store them trimmed & de-duped.
  const options =
    input.fieldType === "SELECT" || input.fieldType === "MULTI_SELECT"
      ? [...new Set(input.options.split(",").map((o) => o.trim()).filter(Boolean))]
      : [];

  const [type] = await db
    .select({ id: schema.recordTypes.id })
    .from(schema.recordTypes)
    .where(
      and(eq(schema.recordTypes.id, input.recordTypeId), eq(schema.recordTypes.orgId, user.orgId)),
    );
  if (!type) redirect(`${FIELDS_PATH}?error=invalid`);

  // The key is the JSON key inside records.customValues — no DB constraint, so
  // enforce per-type uniqueness here.
  const [dup] = await db
    .select({ id: schema.customFields.id })
    .from(schema.customFields)
    .where(
      and(
        eq(schema.customFields.recordTypeId, input.recordTypeId),
        eq(schema.customFields.key, key),
      ),
    );
  if (dup) redirect(`${FIELDS_PATH}?error=duplicate`);

  const [{ existing }] = await db
    .select({ existing: count() })
    .from(schema.customFields)
    .where(eq(schema.customFields.recordTypeId, input.recordTypeId));

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.customFields)
      .values({
        orgId: user.orgId,
        recordTypeId: input.recordTypeId,
        key,
        label: input.label,
        fieldType: input.fieldType,
        required: input.required,
        options,
        sortOrder: existing,
      })
      .returning({ id: schema.customFields.id });
    await audit(tx, user, "custom_field", row.id, "create", { key, label: input.label });
  });

  revalidatePath(FIELDS_PATH);
  redirect(`${FIELDS_PATH}?ok=1`);
}

export async function deleteCustomField(formData: FormData): Promise<void> {
  const user = await requireConfigUser(FIELDS_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${FIELDS_PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.customFields)
      .where(and(eq(schema.customFields.id, id.data), eq(schema.customFields.orgId, user.orgId)))
      .returning({ key: schema.customFields.key });
    if (deleted.length > 0) {
      await audit(tx, user, "custom_field", id.data, "delete", { key: deleted[0].key });
    }
  });

  revalidatePath(FIELDS_PATH);
  redirect(FIELDS_PATH);
}
