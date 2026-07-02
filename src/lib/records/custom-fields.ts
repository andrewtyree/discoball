/**
 * Custom-field values — the pure core of "the domain lives in data".
 *
 * A record type's user-defined fields (see `custom_fields`) are rendered
 * dynamically on record forms and stored in `records.customValues` keyed by
 * `custom_fields.key`. This module parses and validates a submitted form
 * against the field definitions — pure functions, unit-tested without a
 * database (tests/custom-fields.test.ts).
 *
 * Form controls are named `cf_<key>` to keep them clear of the fixed fields.
 *
 * Stored value shapes by field type:
 *   TEXT / LONG_TEXT → string          SELECT       → string (one of options)
 *   NUMBER           → number          MULTI_SELECT → string[]
 *   DATE             → "yyyy-mm-dd"    USER/CONTACT → uuid string
 *   BOOLEAN          → boolean
 * Empty inputs are omitted entirely (except BOOLEAN, which is always present).
 */

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  fieldType:
    | "TEXT"
    | "LONG_TEXT"
    | "NUMBER"
    | "DATE"
    | "BOOLEAN"
    | "SELECT"
    | "MULTI_SELECT"
    | "USER"
    | "CONTACT";
  options: string[];
  required: boolean;
  recordTypeId: string;
}

/** The prefix that keeps custom-field form controls clear of fixed fields. */
export const CUSTOM_FIELD_PREFIX = "cf_";

export function customFieldName(key: string): string {
  return `${CUSTOM_FIELD_PREFIX}${key}`;
}

const TEXT_MAX = 500;
const LONG_TEXT_MAX = 10_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The subset of FormData the parser needs (FormData itself satisfies it). */
export interface FormValueSource {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export type ParsedCustomValues =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse a submitted form against one record type's field definitions.
 * Returns the JSONB-ready `customValues` object, or the first validation
 * error, phrased with the field's human label.
 */
export function parseCustomValues(
  defs: CustomFieldDef[],
  form: FormValueSource,
): ParsedCustomValues {
  const values: Record<string, unknown> = {};

  for (const def of defs) {
    const name = customFieldName(def.key);

    if (def.fieldType === "MULTI_SELECT") {
      const raw = form.getAll(name).filter((v): v is string => typeof v === "string");
      const invalid = raw.find((v) => !def.options.includes(v));
      if (invalid !== undefined) {
        return { ok: false, error: `“${invalid}” is not an option for ${def.label}.` };
      }
      if (raw.length > 0) values[def.key] = raw;
      else if (def.required) return { ok: false, error: `${def.label} is required.` };
      continue;
    }

    if (def.fieldType === "BOOLEAN") {
      // A checkbox posts a value only when checked; absence means false.
      values[def.key] = form.get(name) !== null;
      continue;
    }

    const raw = form.get(name);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (def.required) return { ok: false, error: `${def.label} is required.` };
      continue;
    }

    switch (def.fieldType) {
      case "TEXT":
        if (text.length > TEXT_MAX) {
          return { ok: false, error: `${def.label} must be at most ${TEXT_MAX} characters.` };
        }
        values[def.key] = text;
        break;
      case "LONG_TEXT":
        if (text.length > LONG_TEXT_MAX) {
          return {
            ok: false,
            error: `${def.label} must be at most ${LONG_TEXT_MAX} characters.`,
          };
        }
        values[def.key] = text;
        break;
      case "NUMBER": {
        const n = Number(text);
        if (!Number.isFinite(n)) {
          return { ok: false, error: `${def.label} must be a number.` };
        }
        values[def.key] = n;
        break;
      }
      case "DATE":
        if (!YMD_RE.test(text) || Number.isNaN(new Date(text).getTime())) {
          return { ok: false, error: `${def.label} must be a valid date.` };
        }
        values[def.key] = text;
        break;
      case "SELECT":
        if (!def.options.includes(text)) {
          return { ok: false, error: `“${text}” is not an option for ${def.label}.` };
        }
        values[def.key] = text;
        break;
      case "USER":
      case "CONTACT":
        if (!UUID_RE.test(text)) {
          return { ok: false, error: `${def.label} has an invalid selection.` };
        }
        values[def.key] = text;
        break;
    }
  }

  return { ok: true, values };
}

/**
 * Flatten custom values into an audit/diff snapshot alongside fixed fields,
 * namespaced as `custom.<key>` so a diff reads naturally in the timeline.
 */
export function snapshotCustomValues(
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored ?? {})) {
    out[`custom.${key}`] = value;
  }
  return out;
}

/** Human-readable rendering of one stored value (conflict banner, detail). */
export function formatCustomValue(
  def: Pick<CustomFieldDef, "fieldType">,
  value: unknown,
  /** Optional uuid → display-name resolver for USER/CONTACT fields. */
  resolveName?: (id: string) => string | undefined,
): string {
  if (value === undefined || value === null || value === "") return "—";
  switch (def.fieldType) {
    case "BOOLEAN":
      return value === true ? "Yes" : "No";
    case "MULTI_SELECT":
      return Array.isArray(value) && value.length > 0 ? value.join(", ") : "—";
    case "USER":
    case "CONTACT":
      return resolveName?.(String(value)) ?? String(value);
    default:
      return String(value);
  }
}
