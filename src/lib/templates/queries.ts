/**
 * Template & generation-run queries — org-scoped reads for the templates
 * screens and the batch runner.
 *
 * Same discipline as src/lib/records/queries.ts: every query takes the
 * caller's `orgId` from the session and scopes rows to it.
 */
import { and, asc, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import type { CustomFieldDef } from "@/lib/records/custom-fields";
import { filterConditions } from "@/lib/records/queries";
import type { RecordFilter } from "@/lib/records/filters";
import { mappingSourcesFor, type GenerationRecord, type MappingSource } from "./resolve";

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

const templateListProjection = {
  id: schema.templates.id,
  name: schema.templates.name,
  description: schema.templates.description,
  recordTypeId: schema.templates.recordTypeId,
  recordTypeName: schema.recordTypes.name,
  storageKey: schema.templates.storageKey,
  placeholders: schema.templates.placeholders,
  fieldMappings: schema.templates.fieldMappings,
  outputNamePattern: schema.templates.outputNamePattern,
  isActive: schema.templates.isActive,
  updatedAt: schema.templates.updatedAt,
  createdByName: schema.users.name,
  createdByEmail: schema.users.email,
};

/** All templates in the org (active and inactive), alphabetical. */
export async function listTemplates(orgId: string) {
  return db
    .select(templateListProjection)
    .from(schema.templates)
    .leftJoin(schema.recordTypes, eq(schema.templates.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.templates.createdById, schema.users.id))
    .where(eq(schema.templates.orgId, orgId))
    .orderBy(asc(schema.templates.name));
}

export type TemplateListRow = Awaited<ReturnType<typeof listTemplates>>[number];

/** One template with its record-type name resolved, scoped to the org. */
export async function getTemplate(orgId: string, id: string) {
  const [row] = await db
    .select(templateListProjection)
    .from(schema.templates)
    .leftJoin(schema.recordTypes, eq(schema.templates.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.templates.createdById, schema.users.id))
    .where(and(eq(schema.templates.id, id), eq(schema.templates.orgId, orgId)));
  return row ?? null;
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof getTemplate>>>;

/**
 * The mapping-source catalog for one template's editor: fixed sources plus
 * `custom.<key>` entries — the chosen record type's custom fields, or every
 * custom field in the org when the template isn't restricted to a type.
 */
export async function listMappingSources(
  orgId: string,
  recordTypeId: string | null,
): Promise<MappingSource[]> {
  const defs = await db
    .select({ key: schema.customFields.key, label: schema.customFields.label })
    .from(schema.customFields)
    .where(
      recordTypeId
        ? and(
            eq(schema.customFields.orgId, orgId),
            eq(schema.customFields.recordTypeId, recordTypeId),
          )
        : eq(schema.customFields.orgId, orgId),
    )
    .orderBy(asc(schema.customFields.sortOrder), asc(schema.customFields.label));
  return mappingSourcesFor(defs);
}

/* -------------------------------------------------------------------------- */
/* Generation runs                                                             */
/* -------------------------------------------------------------------------- */

const runProjection = {
  id: schema.generationRuns.id,
  templateId: schema.generationRuns.templateId,
  templateName: schema.templates.name,
  filter: schema.generationRuns.filter,
  outputMode: schema.generationRuns.outputMode,
  status: schema.generationRuns.status,
  recordCount: schema.generationRuns.recordCount,
  resultStorageKey: schema.generationRuns.resultStorageKey,
  warnings: schema.generationRuns.warnings,
  error: schema.generationRuns.error,
  createdAt: schema.generationRuns.createdAt,
  completedAt: schema.generationRuns.completedAt,
  createdByName: schema.users.name,
  createdByEmail: schema.users.email,
};

/** Generation runs, newest first — all of the org's, or one template's. */
export async function listRuns(orgId: string, templateId?: string, limit = 50) {
  const conditions = [eq(schema.generationRuns.orgId, orgId)];
  if (templateId) conditions.push(eq(schema.generationRuns.templateId, templateId));
  return db
    .select(runProjection)
    .from(schema.generationRuns)
    .innerJoin(schema.templates, eq(schema.generationRuns.templateId, schema.templates.id))
    .leftJoin(schema.users, eq(schema.generationRuns.createdById, schema.users.id))
    .where(and(...conditions))
    .orderBy(desc(schema.generationRuns.createdAt))
    .limit(limit);
}

export type RunListRow = Awaited<ReturnType<typeof listRuns>>[number];

/** One run with its template name, scoped to the org. */
export async function getRun(orgId: string, id: string) {
  const [row] = await db
    .select(runProjection)
    .from(schema.generationRuns)
    .innerJoin(schema.templates, eq(schema.generationRuns.templateId, schema.templates.id))
    .leftJoin(schema.users, eq(schema.generationRuns.createdById, schema.users.id))
    .where(and(eq(schema.generationRuns.id, id), eq(schema.generationRuns.orgId, orgId)));
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Record selection for generation                                             */
/* -------------------------------------------------------------------------- */

/** Batch-size ceiling: a run merges at most this many records. */
export const GENERATION_RECORD_CAP = 500;

/** One record shaped for `buildRenderData` (see ./resolve.ts). */
export interface GenerationRecordRow extends GenerationRecord {
  id: string;
  recordTypeId: string;
}

const generationProjection = {
  id: schema.records.id,
  recordTypeId: schema.records.recordTypeId,
  title: schema.records.title,
  reference: schema.records.reference,
  subjectName: schema.records.subjectName,
  openedDate: schema.records.openedDate,
  dueDate: schema.records.dueDate,
  customValues: schema.records.customValues,
  statusName: schema.statuses.name,
  recordTypeName: schema.recordTypes.name,
  assigneeName: schema.users.name,
  assigneeEmail: schema.users.email,
  orgName: schema.organizations.name,
};

/**
 * Select the records a batch run will merge — the exact same org-scoped
 * filter semantics as the records list (shared `filterConditions`), but
 * unpaginated, joined with everything a template can reference, and capped.
 */
export async function listRecordsForGeneration(
  orgId: string,
  filter: RecordFilter,
  cap: number = GENERATION_RECORD_CAP,
): Promise<GenerationRecordRow[]> {
  return db
    .select(generationProjection)
    .from(schema.records)
    .leftJoin(schema.statuses, eq(schema.records.statusId, schema.statuses.id))
    .leftJoin(schema.recordTypes, eq(schema.records.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.records.assigneeId, schema.users.id))
    .innerJoin(schema.organizations, eq(schema.records.orgId, schema.organizations.id))
    .where(and(...filterConditions(orgId, filter)))
    .orderBy(asc(schema.records.reference), asc(schema.records.id))
    .limit(cap);
}

/** One record shaped for generation (preview / single-record runs). */
export async function getRecordForGeneration(
  orgId: string,
  recordId: string,
): Promise<GenerationRecordRow | null> {
  const [row] = await db
    .select(generationProjection)
    .from(schema.records)
    .leftJoin(schema.statuses, eq(schema.records.statusId, schema.statuses.id))
    .leftJoin(schema.recordTypes, eq(schema.records.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.records.assigneeId, schema.users.id))
    .innerJoin(schema.organizations, eq(schema.records.orgId, schema.organizations.id))
    .where(and(eq(schema.records.id, recordId), eq(schema.records.orgId, orgId)));
  return row ?? null;
}

/** Custom-field definitions grouped by record type — the runner resolves each
 *  record's `custom.<key>` sources against its own type's definitions. */
export async function customFieldDefsByRecordType(
  orgId: string,
): Promise<Map<string, CustomFieldDef[]>> {
  const defs = await db
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
    .where(eq(schema.customFields.orgId, orgId));
  const grouped = new Map<string, CustomFieldDef[]>();
  for (const def of defs) {
    const list = grouped.get(def.recordTypeId) ?? [];
    list.push(def);
    grouped.set(def.recordTypeId, list);
  }
  return grouped;
}
