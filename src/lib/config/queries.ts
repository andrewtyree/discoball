/**
 * Configuration reads for the settings screens — org-scoped, with usage counts
 * so the UI can explain why a row in use can't be deleted.
 */
import { asc, count, eq } from "drizzle-orm";

import { db, schema } from "@/db";

export async function listRecordTypes(orgId: string) {
  const [types, recordCounts, fieldCounts] = await Promise.all([
    db
      .select()
      .from(schema.recordTypes)
      .where(eq(schema.recordTypes.orgId, orgId))
      .orderBy(asc(schema.recordTypes.sortOrder), asc(schema.recordTypes.name)),
    db
      .select({ recordTypeId: schema.records.recordTypeId, n: count() })
      .from(schema.records)
      .where(eq(schema.records.orgId, orgId))
      .groupBy(schema.records.recordTypeId),
    db
      .select({ recordTypeId: schema.customFields.recordTypeId, n: count() })
      .from(schema.customFields)
      .where(eq(schema.customFields.orgId, orgId))
      .groupBy(schema.customFields.recordTypeId),
  ]);

  const records = new Map(recordCounts.map((r) => [r.recordTypeId, r.n]));
  const fields = new Map(fieldCounts.map((f) => [f.recordTypeId, f.n]));
  return types.map((t) => ({
    ...t,
    recordCount: records.get(t.id) ?? 0,
    fieldCount: fields.get(t.id) ?? 0,
  }));
}

export async function listStatuses(orgId: string) {
  const [statuses, usage] = await Promise.all([
    db
      .select()
      .from(schema.statuses)
      .where(eq(schema.statuses.orgId, orgId))
      .orderBy(asc(schema.statuses.sortOrder), asc(schema.statuses.name)),
    db
      .select({ statusId: schema.records.statusId, n: count() })
      .from(schema.records)
      .where(eq(schema.records.orgId, orgId))
      .groupBy(schema.records.statusId),
  ]);

  const counts = new Map(usage.map((u) => [u.statusId, u.n]));
  return statuses.map((s) => ({ ...s, recordCount: counts.get(s.id) ?? 0 }));
}

export async function listCustomFields(orgId: string) {
  return db
    .select({
      id: schema.customFields.id,
      key: schema.customFields.key,
      label: schema.customFields.label,
      fieldType: schema.customFields.fieldType,
      options: schema.customFields.options,
      required: schema.customFields.required,
      recordTypeId: schema.customFields.recordTypeId,
      recordTypeName: schema.recordTypes.name,
    })
    .from(schema.customFields)
    .innerJoin(schema.recordTypes, eq(schema.customFields.recordTypeId, schema.recordTypes.id))
    .where(eq(schema.customFields.orgId, orgId))
    .orderBy(
      asc(schema.recordTypes.sortOrder),
      asc(schema.recordTypes.name),
      asc(schema.customFields.sortOrder),
      asc(schema.customFields.label),
    );
}
