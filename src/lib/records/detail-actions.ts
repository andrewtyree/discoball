"use server";
/**
 * Record-detail mutations: documents, contact links, and codes.
 *
 * Same authorization pattern as every Phase 1 mutation: session → RBAC
 * (record:write) → Zod-validate → verify referenced rows belong to the
 * caller's org → write in a transaction → audit entry. The panels are plain
 * server-component forms, so outcomes travel as query params on the record's
 * detail tab (?tab=X&ok=1 / ?tab=X&error=…) rather than action state.
 *
 * Every mutation audits onto the RECORD's timeline (entity "record",
 * entityId = the record id) with a namespaced action ("document_add",
 * "contact_link", "code_remove", …) so the Activity tab tells the whole
 * story of the record in one place.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { requireSessionUser, type SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";

type Tab = "documents" | "contacts" | "codes";

function back(recordId: string, tab: Tab, outcome: "ok" | string): never {
  const param = outcome === "ok" ? "ok=1" : `error=${outcome}`;
  redirect(`/records/${recordId}?tab=${tab}&${param}`);
}

/** Session + role gate + record-ownership check shared by every action here. */
async function requireWritableRecord(
  formData: FormData,
  tab: Tab,
): Promise<{ user: SessionUser; recordId: string }> {
  const user = await requireSessionUser();

  const idParse = z.string().uuid().safeParse(formData.get("recordId"));
  if (!idParse.success) redirect("/records");
  const recordId = idParse.data;

  if (!can(user.role, "record:write")) back(recordId, tab, "forbidden");

  const [record] = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(and(eq(schema.records.id, recordId), eq(schema.records.orgId, user.orgId)));
  if (!record) redirect("/records");

  return { user, recordId };
}

async function auditRecord(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  user: SessionUser,
  recordId: string,
  action: string,
  diff: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({
    orgId: user.orgId,
    userId: user.id,
    entity: "record",
    entityId: recordId,
    action,
    diff,
  });
}

function refresh(recordId: string) {
  revalidatePath(`/records/${recordId}`);
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const DOCUMENT_STATUSES = ["REQUESTED", "RECEIVED", "PRODUCED", "NOT_APPLICABLE"] as const;

const documentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  status: z.enum(DOCUMENT_STATUSES),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null),
  receivedDate: z.preprocess((v) => {
    if (typeof v !== "string" || v.trim() === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d; // undefined → invalid
  }, z.date().nullable()),
});

export async function addDocument(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "documents");

  const parsed = documentSchema.safeParse({
    title: formData.get("title") ?? "",
    status: formData.get("status") ?? "REQUESTED",
    notes: formData.get("notes") ?? "",
    receivedDate: formData.get("receivedDate") ?? "",
  });
  if (!parsed.success) back(recordId, "documents", "invalid");

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(schema.documents)
      .values({ orgId: user.orgId, recordId, ...parsed.data })
      .returning({ id: schema.documents.id });
    await auditRecord(tx, user, recordId, "document_add", {
      documentId: doc.id,
      title: parsed.data.title,
      status: parsed.data.status,
    });
  });

  refresh(recordId);
  back(recordId, "documents", "ok");
}

export async function updateDocumentStatus(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "documents");

  const parsed = z
    .object({ documentId: z.string().uuid(), status: z.enum(DOCUMENT_STATUSES) })
    .safeParse({
      documentId: formData.get("documentId"),
      status: formData.get("status"),
    });
  if (!parsed.success) back(recordId, "documents", "invalid");

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, parsed.data.documentId),
          eq(schema.documents.orgId, user.orgId),
          eq(schema.documents.recordId, recordId),
        ),
      );
    if (!doc || doc.status === parsed.data.status) return;

    await tx
      .update(schema.documents)
      .set({
        status: parsed.data.status,
        // First transition into RECEIVED stamps the date automatically.
        receivedDate:
          parsed.data.status === "RECEIVED" && !doc.receivedDate
            ? new Date()
            : doc.receivedDate,
      })
      .where(eq(schema.documents.id, doc.id));

    await auditRecord(tx, user, recordId, "document_update", {
      documentId: doc.id,
      title: doc.title,
      status: { from: doc.status, to: parsed.data.status },
    });
  });

  refresh(recordId);
  back(recordId, "documents", "ok");
}

export async function deleteDocument(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "documents");

  const idParse = z.string().uuid().safeParse(formData.get("documentId"));
  if (!idParse.success) back(recordId, "documents", "invalid");

  await db.transaction(async (tx) => {
    const [doc] = await tx
      .delete(schema.documents)
      .where(
        and(
          eq(schema.documents.id, idParse.data),
          eq(schema.documents.orgId, user.orgId),
          eq(schema.documents.recordId, recordId),
        ),
      )
      .returning({ id: schema.documents.id, title: schema.documents.title });
    if (!doc) return;
    await auditRecord(tx, user, recordId, "document_delete", {
      documentId: doc.id,
      title: doc.title,
    });
  });

  refresh(recordId);
  back(recordId, "documents", "ok");
}

/* -------------------------------------------------------------------------- */
/* Contact links                                                               */
/* -------------------------------------------------------------------------- */

export async function linkContact(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "contacts");

  const parsed = z
    .object({
      contactId: z.string().uuid(),
      role: z
        .string()
        .trim()
        .max(100)
        .transform((v) => v || null),
    })
    .safeParse({
      contactId: formData.get("contactId"),
      role: formData.get("role") ?? "",
    });
  if (!parsed.success) back(recordId, "contacts", "invalid");

  const [contact] = await db
    .select({ id: schema.contacts.id, displayName: schema.contacts.displayName })
    .from(schema.contacts)
    .where(
      and(eq(schema.contacts.id, parsed.data.contactId), eq(schema.contacts.orgId, user.orgId)),
    );
  if (!contact) back(recordId, "contacts", "invalid");

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.recordContacts)
      .values({ recordId, contactId: contact.id, role: parsed.data.role })
      .onConflictDoNothing()
      .returning({ recordId: schema.recordContacts.recordId });
    if (inserted.length === 0) return; // already linked — nothing to audit

    await auditRecord(tx, user, recordId, "contact_link", {
      contactId: contact.id,
      name: contact.displayName,
      role: parsed.data.role,
    });
  });

  refresh(recordId);
  back(recordId, "contacts", "ok");
}

export async function unlinkContact(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "contacts");

  const idParse = z.string().uuid().safeParse(formData.get("contactId"));
  if (!idParse.success) back(recordId, "contacts", "invalid");

  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.recordContacts)
      .where(
        and(
          eq(schema.recordContacts.recordId, recordId),
          eq(schema.recordContacts.contactId, idParse.data),
        ),
      )
      .returning({ contactId: schema.recordContacts.contactId });
    if (removed.length === 0) return;

    const [contact] = await tx
      .select({ displayName: schema.contacts.displayName })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, idParse.data));
    await auditRecord(tx, user, recordId, "contact_unlink", {
      contactId: idParse.data,
      name: contact?.displayName ?? null,
    });
  });

  refresh(recordId);
  back(recordId, "contacts", "ok");
}

/* -------------------------------------------------------------------------- */
/* Codes                                                                       */
/* -------------------------------------------------------------------------- */

export async function addRecordCode(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "codes");

  const idParse = z.string().uuid().safeParse(formData.get("codeId"));
  if (!idParse.success) back(recordId, "codes", "invalid");

  const [code] = await db
    .select({ id: schema.codes.id, code: schema.codes.code, shortLabel: schema.codes.shortLabel })
    .from(schema.codes)
    .where(
      and(
        eq(schema.codes.id, idParse.data),
        eq(schema.codes.orgId, user.orgId),
        eq(schema.codes.isActive, true),
      ),
    );
  if (!code) back(recordId, "codes", "invalid");

  const [existing] = await db
    .select({ id: schema.recordCodes.id })
    .from(schema.recordCodes)
    .where(
      and(eq(schema.recordCodes.recordId, recordId), eq(schema.recordCodes.codeId, code.id)),
    );
  if (existing) back(recordId, "codes", "duplicate");

  await db.transaction(async (tx) => {
    await tx.insert(schema.recordCodes).values({ recordId, codeId: code.id });
    await auditRecord(tx, user, recordId, "code_add", {
      codeId: code.id,
      code: code.code,
      label: code.shortLabel,
    });
  });

  refresh(recordId);
  back(recordId, "codes", "ok");
}

export async function removeRecordCode(formData: FormData): Promise<void> {
  const { user, recordId } = await requireWritableRecord(formData, "codes");

  const idParse = z.string().uuid().safeParse(formData.get("recordCodeId"));
  if (!idParse.success) back(recordId, "codes", "invalid");

  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(schema.recordCodes)
      .where(
        and(eq(schema.recordCodes.id, idParse.data), eq(schema.recordCodes.recordId, recordId)),
      )
      .returning({ codeId: schema.recordCodes.codeId, rawText: schema.recordCodes.rawText });
    if (!removed) return;

    let label: string | null = removed.rawText;
    if (removed.codeId) {
      const [code] = await tx
        .select({ code: schema.codes.code })
        .from(schema.codes)
        .where(eq(schema.codes.id, removed.codeId));
      label = code?.code ?? label;
    }
    await auditRecord(tx, user, recordId, "code_remove", { code: label });
  });

  refresh(recordId);
  back(recordId, "codes", "ok");
}
