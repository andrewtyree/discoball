/**
 * Placeholder → data resolution for document generation.
 *
 * Pure functions only (unit-tested without a database, tests/resolve.test.ts).
 * A template's `fieldMappings` binds each placeholder to a *source path* —
 * a fixed record column ("title", "status.name"…), the special "today", or a
 * custom field ("custom.<key>"). `buildRenderData` resolves every mapped
 * placeholder for one record into the flat data object docxtemplater renders,
 * and reports which placeholders resolved empty so a batch run can warn
 * "BLK-0007: subjectName empty" instead of silently merging blanks.
 */
import type { CustomFieldDef } from "@/lib/records/custom-fields";

/* -------------------------------------------------------------------------- */
/* Mapping-source catalog (consumed by the UI mapping editor)                  */
/* -------------------------------------------------------------------------- */

export interface MappingSource {
  /** Stable path stored in templates.fieldMappings values. */
  path: string;
  /** Human label for the mapping editor dropdown. */
  label: string;
}

/** Prefix for custom-field source paths ("custom.<key>"). */
export const CUSTOM_SOURCE_PREFIX = "custom.";

/** The fixed, always-available data sources. */
export const MAPPING_SOURCES: MappingSource[] = [
  { path: "title", label: "Title" },
  { path: "reference", label: "Reference" },
  { path: "subjectName", label: "Subject name" },
  { path: "dueDate", label: "Due date" },
  { path: "openedDate", label: "Opened date" },
  { path: "status.name", label: "Status" },
  { path: "recordType.name", label: "Record type" },
  { path: "assignee.name", label: "Assignee name" },
  { path: "assignee.email", label: "Assignee email" },
  { path: "org.name", label: "Organization name" },
  { path: "today", label: "Today's date" },
];

/** Source path for one custom-field key. */
export function customSourcePath(key: string): string {
  return `${CUSTOM_SOURCE_PREFIX}${key}`;
}

/** The full catalog for one record type: fixed sources + its custom fields. */
export function mappingSourcesFor(
  customFieldDefs: Pick<CustomFieldDef, "key" | "label">[],
): MappingSource[] {
  return [
    ...MAPPING_SOURCES,
    ...customFieldDefs.map((def) => ({
      path: customSourcePath(def.key),
      label: `${def.label} (custom field)`,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Value formatting                                                            */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Human-readable date for merged documents, e.g. "12 Mar 2026" (UTC, the
 *  same calendar day `ymd()` renders elsewhere in the app). */
export function formatHumanDate(value: Date | string | null | undefined): string {
  if (value == null || value === "") return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Format a stored custom value for a document (dates human-readable,
 *  booleans Yes/No, multi-selects comma-joined). */
function formatCustomForDocument(
  fieldType: CustomFieldDef["fieldType"] | undefined,
  value: unknown,
): string {
  if (value === undefined || value === null || value === "") return "";
  if (fieldType === "DATE") return formatHumanDate(String(value));
  if (fieldType === "BOOLEAN" || typeof value === "boolean") {
    return value === true ? "Yes" : "No";
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/** One record with its joined display names — everything a template can pull
 *  from. Shape matches `listRecordsForGeneration` in ./queries.ts. */
export interface GenerationRecord {
  title: string;
  reference: string | null;
  subjectName: string | null;
  openedDate: Date | string | null;
  dueDate: Date | string | null;
  statusName: string | null;
  recordTypeName: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  orgName: string | null;
  customValues: Record<string, unknown>;
}

/** Resolve one source path against a record. Returns "" when empty/unknown. */
export function resolveSourceValue(
  record: GenerationRecord,
  customFieldDefs: Pick<CustomFieldDef, "key" | "fieldType">[],
  sourcePath: string,
  today: Date = new Date(),
): string {
  if (sourcePath.startsWith(CUSTOM_SOURCE_PREFIX)) {
    const key = sourcePath.slice(CUSTOM_SOURCE_PREFIX.length);
    const def = customFieldDefs.find((d) => d.key === key);
    return formatCustomForDocument(def?.fieldType, record.customValues?.[key]);
  }
  switch (sourcePath) {
    case "title":
      return record.title ?? "";
    case "reference":
      return record.reference ?? "";
    case "subjectName":
      return record.subjectName ?? "";
    case "dueDate":
      return formatHumanDate(record.dueDate);
    case "openedDate":
      return formatHumanDate(record.openedDate);
    case "status.name":
      return record.statusName ?? "";
    case "recordType.name":
      return record.recordTypeName ?? "";
    case "assignee.name":
      return record.assigneeName ?? "";
    case "assignee.email":
      return record.assigneeEmail ?? "";
    case "org.name":
      return record.orgName ?? "";
    case "today":
      return formatHumanDate(today);
    default:
      return "";
  }
}

export interface RenderData {
  /** Flat placeholder → string data, ready for docxtemplater. */
  data: Record<string, string>;
  /** Placeholders whose resolved value came back empty/null. */
  missing: string[];
}

/**
 * Resolve every mapped placeholder for one record.
 * Placeholders that resolve empty still appear in `data` (as "") so the
 * merge never fails — but they are listed in `missing` for run warnings.
 */
export function buildRenderData(
  record: GenerationRecord,
  customFieldDefs: Pick<CustomFieldDef, "key" | "fieldType">[],
  fieldMappings: Record<string, string>,
  today: Date = new Date(),
): RenderData {
  const data: Record<string, string> = {};
  const missing: string[] = [];
  for (const [placeholder, sourcePath] of Object.entries(fieldMappings)) {
    const value = resolveSourceValue(record, customFieldDefs, sourcePath, today);
    data[placeholder] = value;
    if (value === "") missing.push(placeholder);
  }
  return { data, missing };
}

/* -------------------------------------------------------------------------- */
/* Output filenames                                                            */
/* -------------------------------------------------------------------------- */

export const DEFAULT_OUTPUT_NAME_PATTERN = "{reference}";

/**
 * Resolve an output filename pattern like "{reference}_{subjectName}" for one
 * record. Tokens are source paths (same vocabulary as field mappings).
 * Returns the raw name — pass through `sanitizeFileName` before use.
 */
export function resolveOutputName(
  pattern: string | null | undefined,
  record: GenerationRecord,
  customFieldDefs: Pick<CustomFieldDef, "key" | "fieldType">[],
  today: Date = new Date(),
): string {
  const p = pattern?.trim() ? pattern : DEFAULT_OUTPUT_NAME_PATTERN;
  return p.replace(/\{([^{}]+)\}/g, (_m, token: string) =>
    resolveSourceValue(record, customFieldDefs, token.trim(), today),
  );
}

/** Make a name safe as a filesystem filename (no extension handling). */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 120)
    .trim();
  return cleaned;
}

/**
 * Dedupe an output filename against the names already emitted in a batch:
 * "Report", "Report" → "Report", "Report-2"; and a later record whose base is
 * literally "Report-2" becomes "Report-2-2" instead of silently overwriting
 * the earlier zip entry. Every returned name is registered in `used`, and the
 * comparison is case-insensitive so extraction on Windows/macOS can't clash.
 */
export function uniqueFileName(
  base: string,
  fallback: string,
  used: Set<string>,
): string {
  const name = base !== "" ? base : fallback;
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) {
    candidate = `${name}-${n}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Content-Disposition value for a download. Header values are ByteStrings —
 * undici throws on any char > U+00FF, so a template named "Contract — 2026"
 * or a CJK record subject would otherwise 500 the download. Send an
 * ASCII-only quoted fallback plus the real name RFC 5987-encoded in
 * `filename*` so nothing crashes and fidelity is kept.
 */
export function contentDispositionAttachment(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
