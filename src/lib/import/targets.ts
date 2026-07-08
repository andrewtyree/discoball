/**
 * Import targets — where a CSV column can land on a record.
 *
 * Pure functions (unit-tested in tests/import-targets.test.ts). A column
 * mapping is `Record<csv header, target path>`; target paths are the fixed
 * record fields plus `custom.<key>` for the chosen record type's custom
 * fields (same path vocabulary as template field mappings), with `""`
 * meaning "ignore this column".
 *
 * `guessColumnMapping` prefills the mapping editor: headers are matched
 * against target paths, labels, and the export header convention
 * (`cf_<key>`), so a file produced by the records export maps itself with
 * zero clicks — that's what makes export → edit → re-import a first-class
 * flow.
 */
import { CUSTOM_FIELD_PREFIX, type CustomFieldDef } from "@/lib/records/custom-fields";
import { CUSTOM_SOURCE_PREFIX } from "@/lib/templates/resolve";

export interface ImportTarget {
  /** Stored in import_runs.columnMapping values. */
  path: string;
  /** Human label for the mapping editor dropdown. */
  label: string;
  /** Exactly one column must map to a required target. */
  required?: boolean;
}

export const FIXED_IMPORT_TARGETS: ImportTarget[] = [
  { path: "title", label: "Title", required: true },
  { path: "reference", label: "Reference" },
  { path: "subjectName", label: "Subject name" },
  { path: "status", label: "Status (by name)" },
  { path: "assignee", label: "Assignee (by email)" },
  { path: "openedDate", label: "Opened date (yyyy-mm-dd)" },
  { path: "dueDate", label: "Due date (yyyy-mm-dd)" },
];

/** The full target catalog for one record type. */
export function importTargetsFor(
  customFieldDefs: Pick<CustomFieldDef, "key" | "label">[],
): ImportTarget[] {
  return [
    ...FIXED_IMPORT_TARGETS,
    ...customFieldDefs.map((def) => ({
      path: `${CUSTOM_SOURCE_PREFIX}${def.key}`,
      label: `${def.label} (custom field)`,
    })),
  ];
}

/** Lowercase and strip everything but letters and digits, so "Subject name",
 *  "subject_name", and "subjectName" all collide on purpose. */
function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Extra spellings people actually put in header rows. */
const FIXED_ALIASES: Record<string, string[]> = {
  title: ["name"],
  reference: ["ref", "referenceno", "refno"],
  subjectName: ["subject"],
  status: ["statusname"],
  assignee: ["assigneeemail", "assignedto", "owner"],
  openedDate: ["opened", "dateopened", "opendate"],
  dueDate: ["due", "deadline", "datedue"],
};

/** Every normalized spelling that identifies one target. */
function aliasesFor(target: ImportTarget): Set<string> {
  const aliases = new Set<string>();
  if (target.path.startsWith(CUSTOM_SOURCE_PREFIX)) {
    const key = target.path.slice(CUSTOM_SOURCE_PREFIX.length);
    aliases.add(norm(key));
    // The export header convention: cf_<key>.
    aliases.add(norm(`${CUSTOM_FIELD_PREFIX}${key}`));
    aliases.add(norm(target.label.replace(/\s*\(custom field\)$/, "")));
  } else {
    aliases.add(norm(target.path));
    aliases.add(norm(target.label.replace(/\s*\(.*\)$/, "")));
    for (const alias of FIXED_ALIASES[target.path] ?? []) aliases.add(alias);
  }
  aliases.delete("");
  return aliases;
}

/**
 * Auto-guess a column mapping from the header row. A header is mapped when
 * it matches exactly one target and that target isn't already claimed by an
 * earlier header; everything else maps to "" (ignored). Deterministic —
 * first header wins, catalog order breaks nothing.
 */
export function guessColumnMapping(
  headers: string[],
  targets: ImportTarget[],
): Record<string, string> {
  const byAlias = new Map<string, ImportTarget[]>();
  for (const target of targets) {
    for (const alias of aliasesFor(target)) {
      byAlias.set(alias, [...(byAlias.get(alias) ?? []), target]);
    }
  }

  const mapping: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const header of headers) {
    const candidates = byAlias.get(norm(header)) ?? [];
    const target = candidates.length === 1 ? candidates[0] : undefined;
    if (target && !claimed.has(target.path)) {
      mapping[header] = target.path;
      claimed.add(target.path);
    } else {
      mapping[header] = "";
    }
  }
  return mapping;
}

/**
 * Validate a submitted mapping against the catalog: every non-ignored path
 * must exist, no target may be claimed twice, and required targets (title)
 * must be mapped. Returns a user-facing problem or null.
 */
export function columnMappingProblem(
  mapping: Record<string, string>,
  targets: ImportTarget[],
): string | null {
  const known = new Map(targets.map((t) => [t.path, t]));
  const seen = new Map<string, string>();
  for (const [header, path] of Object.entries(mapping)) {
    if (path === "") continue;
    const target = known.get(path);
    if (!target) return `Unknown import target "${path}".`;
    const previous = seen.get(path);
    if (previous !== undefined) {
      return `Both “${previous}” and “${header}” are mapped to ${target.label} — a target can take only one column.`;
    }
    seen.set(path, header);
  }
  for (const target of targets) {
    if (target.required && !seen.has(target.path)) {
      return `Map a column to ${target.label} — it's required.`;
    }
  }
  return null;
}
