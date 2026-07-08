/**
 * CSV row validation — the pure core of the import wizard.
 *
 * Every data row is checked against the mapped targets: fixed-field rules
 * mirror the record form's Zod schema (same length caps, same yyyy-mm-dd
 * dates), names resolve through org lookups (status by name, assignee by
 * email), reference collisions are caught against both the database and the
 * file itself, and custom-field cells run through the SAME
 * `parseCustomValues` validator the record form uses — via a per-row
 * FormValueSource adapter — so an import can never store a value the form
 * couldn't.
 *
 * Row numbers in errors are 1-based FILE rows (the header is row 1), so
 * "row 12" means the same thing here as in a spreadsheet.
 */
import {
  CUSTOM_FIELD_PREFIX,
  parseCustomValues,
  type CustomFieldDef,
  type FormValueSource,
} from "@/lib/records/custom-fields";
import { CUSTOM_SOURCE_PREFIX } from "@/lib/templates/resolve";

/** One import commits at most this many data rows. */
export const IMPORT_ROW_CAP = 5000;

/** Row errors stored on the run are capped at this many entries. */
export const IMPORT_ERROR_DISPLAY_CAP = 200;

/** MULTI_SELECT cells hold options separated by ";" ("a; b; c"). */
export const MULTI_SELECT_SPLIT = ";";

export interface ImportRowError {
  /** 1-based file row (header = row 1). */
  row: number;
  column?: string;
  message: string;
}

/** Org lookups the validator resolves names against (built by queries.ts). */
export interface ImportLookups {
  /** Lowercased status name → id (chosen record type's statuses). */
  statusIdByName: Map<string, string>;
  /** Lowercased member email → user id. */
  userIdByEmail: Map<string, string>;
  /** Org member user ids (USER custom fields). */
  userIds: Set<string>;
  /** Org contact ids (CONTACT custom fields). */
  contactIds: Set<string>;
  /** References already taken in the org (exact case — so is the index). */
  existingReferences: Set<string>;
}

/** A validated row, ready to insert (dates stay yyyy-mm-dd until insert). */
export interface ImportRecordValues {
  title: string;
  reference: string | null;
  subjectName: string | null;
  statusId: string | null;
  assigneeId: string | null;
  openedDate: string | null;
  dueDate: string | null;
  customValues: Record<string, unknown>;
}

export interface ValidatedImportRow {
  row: number;
  values: ImportRecordValues | null;
  errors: ImportRowError[];
}

export interface ValidatedImport {
  rows: ValidatedImportRow[];
  validCount: number;
  /** Number of invalid ROWS (what "skip N invalid rows" skips). */
  errorCount: number;
  /** All error entries, flattened in row order (cap before storing). */
  errors: ImportRowError[];
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 300;
const REFERENCE_MAX = 100;
const SUBJECT_MAX = 300;

const TRUE_WORDS = new Set(["true", "yes", "1", "y"]);
const FALSE_WORDS = new Set(["false", "no", "0", "n", ""]);

/** Present a CSV row to `parseCustomValues` as if it were a submitted form. */
function rowFormSource(cellFor: (path: string) => string): FormValueSource {
  return {
    get(name) {
      const value = cellFor(pathForControl(name));
      return value === "" ? null : value;
    },
    getAll(name) {
      return cellFor(pathForControl(name))
        .split(MULTI_SELECT_SPLIT)
        .map((v) => v.trim())
        .filter((v) => v !== "");
    },
  };
}

/** cf_<key> control name → custom.<key> target path. */
function pathForControl(name: string): string {
  const key = name.startsWith(CUSTOM_FIELD_PREFIX)
    ? name.slice(CUSTOM_FIELD_PREFIX.length)
    : name;
  return `${CUSTOM_SOURCE_PREFIX}${key}`;
}

/**
 * Validate every data row against the mapping. All errors on a row are
 * collected (not first-only) so the preview shows the user the whole story
 * in one pass.
 */
export function validateImportRows(
  headers: string[],
  dataRows: string[][],
  mapping: Record<string, string>,
  defs: CustomFieldDef[],
  lookups: ImportLookups,
): ValidatedImport {
  // Column index per target path, from the submitted mapping.
  const columnForPath = new Map<string, { header: string; index: number }>();
  headers.forEach((header, index) => {
    const path = mapping[header];
    if (path) columnForPath.set(path, { header, index });
  });

  const seenReferences = new Map<string, number>();
  const rows: ValidatedImportRow[] = [];
  const allErrors: ImportRowError[] = [];
  let validCount = 0;

  dataRows.forEach((cells, i) => {
    const rowNo = i + 2; // header is file row 1
    const errors: ImportRowError[] = [];
    const cellFor = (path: string): string => {
      const col = columnForPath.get(path);
      return col ? (cells[col.index] ?? "").trim() : "";
    };
    const fail = (path: string, message: string) => {
      errors.push({ row: rowNo, column: columnForPath.get(path)?.header, message });
    };

    // Fixed fields — same rules as the record form's Zod schema.
    const title = cellFor("title");
    if (title === "") fail("title", "Title is required.");
    else if (title.length > TITLE_MAX) fail("title", `Title must be at most ${TITLE_MAX} characters.`);

    const reference = cellFor("reference");
    if (reference.length > REFERENCE_MAX) {
      fail("reference", `Reference must be at most ${REFERENCE_MAX} characters.`);
    } else if (reference !== "") {
      if (lookups.existingReferences.has(reference)) {
        fail("reference", `Reference “${reference}” already exists in this workspace.`);
      }
      const firstRow = seenReferences.get(reference);
      if (firstRow !== undefined) {
        fail("reference", `Reference “${reference}” is repeated in the file (first used on row ${firstRow}).`);
      } else {
        seenReferences.set(reference, rowNo);
      }
    }

    const subjectName = cellFor("subjectName");
    if (subjectName.length > SUBJECT_MAX) {
      fail("subjectName", `Subject name must be at most ${SUBJECT_MAX} characters.`);
    }

    let statusId: string | null = null;
    const statusName = cellFor("status");
    if (statusName !== "") {
      statusId = lookups.statusIdByName.get(statusName.toLowerCase()) ?? null;
      if (!statusId) fail("status", `Unknown status “${statusName}”.`);
    }

    let assigneeId: string | null = null;
    const assigneeEmail = cellFor("assignee");
    if (assigneeEmail !== "") {
      assigneeId = lookups.userIdByEmail.get(assigneeEmail.toLowerCase()) ?? null;
      if (!assigneeId) fail("assignee", `No organization member with email “${assigneeEmail}”.`);
    }

    const dates: Record<"openedDate" | "dueDate", string | null> = {
      openedDate: null,
      dueDate: null,
    };
    for (const path of ["openedDate", "dueDate"] as const) {
      const text = cellFor(path);
      if (text === "") continue;
      if (!YMD_RE.test(text) || Number.isNaN(new Date(text).getTime())) {
        fail(path, `${path === "dueDate" ? "Due date" : "Opened date"} must be a valid yyyy-mm-dd date.`);
      } else {
        dates[path] = text;
      }
    }

    // Custom fields — one def at a time so errors carry the right column.
    const source = rowFormSource(cellFor);
    const customValues: Record<string, unknown> = {};
    for (const def of defs) {
      const path = `${CUSTOM_SOURCE_PREFIX}${def.key}`;
      if (def.fieldType === "BOOLEAN") {
        // parseCustomValues has checkbox semantics (present = true); a CSV
        // cell needs word semantics, and junk must be an error, not false.
        const text = cellFor(path).toLowerCase();
        if (!TRUE_WORDS.has(text) && !FALSE_WORDS.has(text)) {
          fail(path, `${def.label} must be true or false.`);
          continue;
        }
        customValues[def.key] = TRUE_WORDS.has(text);
        continue;
      }
      const parsed = parseCustomValues([def], source);
      if (!parsed.ok) {
        fail(path, parsed.error);
        continue;
      }
      if (def.key in parsed.values) {
        const value = parsed.values[def.key];
        if (def.fieldType === "USER" && typeof value === "string" && !lookups.userIds.has(value)) {
          fail(path, `${def.label}: that user is not a member of this organization.`);
          continue;
        }
        if (def.fieldType === "CONTACT" && typeof value === "string" && !lookups.contactIds.has(value)) {
          fail(path, `${def.label}: unknown contact.`);
          continue;
        }
        customValues[def.key] = value;
      }
    }

    allErrors.push(...errors);
    if (errors.length > 0) {
      rows.push({ row: rowNo, values: null, errors });
      return;
    }
    validCount += 1;
    rows.push({
      row: rowNo,
      errors,
      values: {
        title,
        reference: reference === "" ? null : reference,
        subjectName: subjectName === "" ? null : subjectName,
        statusId,
        assigneeId,
        openedDate: dates.openedDate,
        dueDate: dates.dueDate,
        customValues,
      },
    });
  });

  return {
    rows,
    validCount,
    errorCount: rows.length - validCount,
    errors: allErrors,
  };
}

