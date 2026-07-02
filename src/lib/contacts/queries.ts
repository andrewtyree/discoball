/**
 * Contact-book reads — org-scoped, with linked-record counts so the UI can
 * explain why a contact in use can't be deleted.
 */
import { asc, count, eq } from "drizzle-orm";

import { db, schema } from "@/db";

export async function listContacts(orgId: string) {
  const [contacts, usage] = await Promise.all([
    db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId))
      .orderBy(asc(schema.contacts.displayName)),
    db
      .select({ contactId: schema.recordContacts.contactId, n: count() })
      .from(schema.recordContacts)
      .innerJoin(schema.contacts, eq(schema.recordContacts.contactId, schema.contacts.id))
      .where(eq(schema.contacts.orgId, orgId))
      .groupBy(schema.recordContacts.contactId),
  ]);

  const counts = new Map(usage.map((u) => [u.contactId, u.n]));
  return contacts.map((c) => ({ ...c, recordCount: counts.get(c.id) ?? 0 }));
}

export async function getContact(orgId: string, id: string) {
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.id, id))
    .limit(1);
  return contact && contact.orgId === orgId ? contact : null;
}
