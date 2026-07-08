/**
 * Export column model — the pure core of CSV/JSON record export.
 *
 * The CSV column set is the fixed record columns plus the union of every
 * custom field in the org as `cf_<key>` columns (blank where a record's type
 * doesn't have the field). Headers use the raw key, not the label, so the
 * import auto-mapper can reverse them deterministically: export a filtered
 * set, edit it, re-import it, and every column maps itself.
 *
 * Value formatting mirrors what the import wizard parses:
 *   DATE → "yyyy-mm-dd"        MULTI_SELECT → "a; b; c"
 *   BOOLEAN → "true"/"false"   NUMBER → decimal string
 *   USER / CONTACT → uuid      everything else → the string itself
 */
import { CUSTOM_FIELD_PREFIX, type CustomFieldDef } from "@/lib/records/custom-fields";
import { ymd } from "@/lib/utils";

/** Separator for MULTI_SELECT values in a CSV cell (import splits on ";"). */
export const MULTI_SELECT_SEPARATOR = "; ";

/** One record shaped for export — matches `listRecordsForExport`. */
export interface ExportRecordRow {
  id: string;
  recordTypeId: string;
  typeName: string | null;
  reference: string | null;
  title: string;
  subjectName: string | null;
  statusName: string | null;
  assigneeEmail: string | null;
  openedDate: Date | null;
  dueDate: Date | null;
  isArchived: boolean;
  customValues: Record<string, unknown>;
}

export interface ExportColumn {
  header: string;
  value(row: ExportRecordRow): string;
}

/** Format one stored custom value the way the import wizard parses it. */
export function formatCustomExportValue(
  fieldType: CustomFieldDef["fieldType"] | undefined,
  value: unknown,
): string {
  if (value === undefined || value === null || value === "") {
    // An absent BOOLEAN is stored as absent only on pre-Phase-1 rows; treat
    // as false so the column is never ambiguous.
    return fieldType === "BOOLEAN" ? "false" : "";
  }
  if (fieldType === "BOOLEAN" || typeof value === "boolean") {
    return value === true ? "true" : "false";
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join(MULTI_SELECT_SEPARATOR);
  return String(value);
}

export const FIXED_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "recordType", value: (r) => r.typeName ?? "" },
  { header: "reference", value: (r) => r.reference ?? "" },
  { header: "title", value: (r) => r.title },
  { header: "subjectName", value: (r) => r.subjectName ?? "" },
  { header: "status", value: (r) => r.statusName ?? "" },
  { header: "assignee", value: (r) => r.assigneeEmail ?? "" },
  { header: "openedDate", value: (r) => ymd(r.openedDate) },
  { header: "dueDate", value: (r) => ymd(r.dueDate) },
  { header: "archived", value: (r) => (r.isArchived ? "true" : "false") },
];

/**
 * Fixed columns plus one `cf_<key>` column per distinct custom-field key in
 * the org. A key defined on several record types (same key string) becomes a
 * single column; the cell formats through the definition belonging to the
 * row's own record type, so e.g. a DATE on Matters and a TEXT on Projects
 * both render correctly. Custom columns are sorted by key for a stable
 * header order regardless of query order.
 */
export function buildExportColumns(
  defsByType: Map<string, CustomFieldDef[]>,
): ExportColumn[] {
  const keys = new Set<string>();
  for (const defs of defsByType.values()) {
    for (const def of defs) keys.add(def.key);
  }

  const customColumns = [...keys].sort().map((key): ExportColumn => ({
    header: `${CUSTOM_FIELD_PREFIX}${key}`,
    value: (row) => {
      const def = defsByType.get(row.recordTypeId)?.find((d) => d.key === key);
      if (!def) return "";
      return formatCustomExportValue(def.fieldType, row.customValues?.[key]);
    },
  }));

  return [...FIXED_EXPORT_COLUMNS, ...customColumns];
}

/** Render header + data rows, ready for `serializeCsv`. */
export function exportRowsToCsv(
  columns: ExportColumn[],
  rows: ExportRecordRow[],
): string[][] {
  return [columns.map((c) => c.header), ...rows.map((row) => columns.map((c) => c.value(row)))];
}

/** One record as a natural JSON object (JSON consumers want structure, not
 *  flattened `cf_` columns — round-tripping is CSV's job). */
export function exportRecordToJson(row: ExportRecordRow): Record<string, unknown> {
  return {
    id: row.id,
    recordType: row.typeName,
    reference: row.reference,
    title: row.title,
    subjectName: row.subjectName,
    status: row.statusName,
    assignee: row.assigneeEmail,
    openedDate: row.openedDate ? ymd(row.openedDate) : null,
    dueDate: row.dueDate ? ymd(row.dueDate) : null,
    archived: row.isArchived,
    customValues: row.customValues ?? {},
  };
}
