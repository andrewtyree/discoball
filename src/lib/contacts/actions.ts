"use server";
/**
 * Contact-book mutations. Contacts are domain data (not configuration), so
 * they're gated on record:write like records themselves. Same pattern as
 * everywhere: session → RBAC → Zod → org-scoped write in a transaction →
 * audit entry; outcomes travel as query params.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { requireSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";

const CONTACTS_PATH = "/contacts";

const CONTACT_TYPES = ["COUNTERPARTY", "WITNESS", "COLLABORATOR", "VENDOR", "OTHER"] as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const contactSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  type: z.enum(CONTACT_TYPES),
  fullName: optional(300),
  organization: optional(300),
  email: z
    .string()
    .trim()
    .max(320)
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Invalid email"),
  phone: optional(50),
  addressLine1: optional(300),
  addressLine2: optional(300),
  notes: optional(2000),
});

function parseContact(formData: FormData) {
  return contactSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    type: formData.get("type") ?? "OTHER",
    fullName: formData.get("fullName") ?? "",
    organization: formData.get("organization") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    addressLine1: formData.get("addressLine1") ?? "",
    addressLine2: formData.get("addressLine2") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

async function requireContactWriter(backTo: string) {
  const user = await requireSessionUser();
  if (!can(user.role, "record:write")) redirect(`${backTo}?error=forbidden`);
  return user;
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  user: { orgId: string; id: string },
  contactId: string,
  action: string,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({
    orgId: user.orgId,
    userId: user.id,
    entity: "contact",
    entityId: contactId,
    action,
    diff: diff ?? null,
  });
}

export async function createContact(formData: FormData): Promise<void> {
  const user = await requireContactWriter(CONTACTS_PATH);

  const parsed = parseContact(formData);
  if (!parsed.success) redirect(`${CONTACTS_PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.contacts)
      .values({ orgId: user.orgId, ...parsed.data })
      .returning({ id: schema.contacts.id });
    await audit(tx, user, row.id, "create", { name: parsed.data.displayName });
  });

  revalidatePath(CONTACTS_PATH);
  redirect(`${CONTACTS_PATH}?ok=1`);
}

export async function updateContact(formData: FormData): Promise<void> {
  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect(CONTACTS_PATH);
  const detailPath = `${CONTACTS_PATH}/${idParse.data}`;

  const user = await requireContactWriter(detailPath);

  const parsed = parseContact(formData);
  if (!parsed.success) redirect(`${detailPath}?error=invalid`);

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, idParse.data), eq(schema.contacts.orgId, user.orgId)));
    if (!before) return;

    await tx
      .update(schema.contacts)
      .set(parsed.data)
      .where(eq(schema.contacts.id, before.id));

    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
      if (before[key] !== parsed.data[key]) {
        changed[key] = { from: before[key], to: parsed.data[key] };
      }
    }
    await audit(tx, user, before.id, "update", changed);
  });

  revalidatePath(CONTACTS_PATH);
  revalidatePath(detailPath);
  redirect(`${detailPath}?ok=1`);
}

export async function toggleContactActive(formData: FormData): Promise<void> {
  const user = await requireContactWriter(CONTACTS_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${CONTACTS_PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ isActive: schema.contacts.isActive, displayName: schema.contacts.displayName })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.id, id.data), eq(schema.contacts.orgId, user.orgId)));
    if (!current) return;

    await tx
      .update(schema.contacts)
      .set({ isActive: !current.isActive })
      .where(eq(schema.contacts.id, id.data));
    await audit(tx, user, id.data, current.isActive ? "deactivate" : "activate", {
      name: current.displayName,
    });
  });

  revalidatePath(CONTACTS_PATH);
  redirect(CONTACTS_PATH);
}

export async function deleteContact(formData: FormData): Promise<void> {
  const user = await requireContactWriter(CONTACTS_PATH);

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) redirect(`${CONTACTS_PATH}?error=invalid`);

  const [{ inUse }] = await db
    .select({ inUse: count() })
    .from(schema.recordContacts)
    .where(eq(schema.recordContacts.contactId, id.data));
  if (inUse > 0) redirect(`${CONTACTS_PATH}?error=in-use`);

  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.contacts)
      .where(and(eq(schema.contacts.id, id.data), eq(schema.contacts.orgId, user.orgId)))
      .returning({ displayName: schema.contacts.displayName });
    if (deleted.length > 0) {
      await audit(tx, user, id.data, "delete", { name: deleted[0].displayName });
    }
  });

  revalidatePath(CONTACTS_PATH);
  redirect(CONTACTS_PATH);
}
