/**
 * Import-run queries — org-scoped reads for the import wizard, plus the
 * lookup tables the row validator resolves names against.
 */
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

import { db, schema } from "@/db";
import type { CustomFieldDef } from "@/lib/records/custom-fields";
import type { ImportLookups } from "./validate";

/** One record type's custom-field definitions, org-scoped. */
export async function listCustomFieldDefs(
  orgId: string,
  recordTypeId: string,
): Promise<CustomFieldDef[]> {
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
    )
    .orderBy(asc(schema.customFields.sortOrder), asc(schema.customFields.label));
}

const runProjection = {
  id: schema.importRuns.id,
  recordTypeId: schema.importRuns.recordTypeId,
  recordTypeName: schema.recordTypes.name,
  fileName: schema.importRuns.fileName,
  storageKey: schema.importRuns.storageKey,
  columnMapping: schema.importRuns.columnMapping,
  status: schema.importRuns.status,
  rowCount: schema.importRuns.rowCount,
  validCount: schema.importRuns.validCount,
  errorCount: schema.importRuns.errorCount,
  importedCount: schema.importRuns.importedCount,
  skipInvalid: schema.importRuns.skipInvalid,
  errors: schema.importRuns.errors,
  error: schema.importRuns.error,
  createdAt: schema.importRuns.createdAt,
  completedAt: schema.importRuns.completedAt,
  createdByName: schema.users.name,
  createdByEmail: schema.users.email,
};

/** The org's import history, newest first. */
export async function listImportRuns(orgId: string, limit = 25) {
  return db
    .select(runProjection)
    .from(schema.importRuns)
    .innerJoin(schema.recordTypes, eq(schema.importRuns.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.importRuns.createdById, schema.users.id))
    .where(eq(schema.importRuns.orgId, orgId))
    .orderBy(desc(schema.importRuns.createdAt))
    .limit(limit);
}

export type ImportRunListRow = Awaited<ReturnType<typeof listImportRuns>>[number];

/** One import run, scoped to the org (another org's run 404s upstream). */
export async function getImportRun(orgId: string, id: string) {
  const [row] = await db
    .select(runProjection)
    .from(schema.importRuns)
    .innerJoin(schema.recordTypes, eq(schema.importRuns.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.importRuns.createdById, schema.users.id))
    .where(and(eq(schema.importRuns.id, id), eq(schema.importRuns.orgId, orgId)));
  return row ?? null;
}

export type ImportRunDetail = NonNullable<Awaited<ReturnType<typeof getImportRun>>>;

/**
 * Build the validator's lookup tables for one record type: its statuses
 * (org-wide ones included), member emails, member/contact ids, and every
 * reference already taken in the org. Duplicate status names resolve to the
 * lowest sort order, matching the order pickers display them in.
 */
export async function buildImportLookups(
  orgId: string,
  recordTypeId: string,
): Promise<ImportLookups> {
  const [statuses, members, contacts, references] = await Promise.all([
    db
      .select({ id: schema.statuses.id, name: schema.statuses.name })
      .from(schema.statuses)
      .where(
        and(
          eq(schema.statuses.orgId, orgId),
          or(
            isNull(schema.statuses.recordTypeId),
            eq(schema.statuses.recordTypeId, recordTypeId),
          ),
        ),
      )
      .orderBy(asc(schema.statuses.sortOrder), asc(schema.statuses.name)),
    db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, orgId)),
    db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId)),
    db
      .select({ reference: schema.records.reference })
      .from(schema.records)
      .where(and(eq(schema.records.orgId, orgId), isNotNull(schema.records.reference))),
  ]);

  const statusIdByName = new Map<string, string>();
  for (const status of statuses) {
    const key = status.name.toLowerCase();
    if (!statusIdByName.has(key)) statusIdByName.set(key, status.id);
  }

  return {
    statusIdByName,
    userIdByEmail: new Map(members.map((m) => [m.email.toLowerCase(), m.id])),
    userIds: new Set(members.map((m) => m.id)),
    contactIds: new Set(contacts.map((c) => c.id)),
    existingReferences: new Set(
      references.map((r) => r.reference).filter((r): r is string => r !== null),
    ),
  };
}
