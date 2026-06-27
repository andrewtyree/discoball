/**
 * Template placeholder discovery.
 *
 * Instead of a developer maintaining a hardcoded merge-field map in code, a
 * user uploads a `.docx` whose merge fields are written as `{placeholder}` tags
 * (docxtemplater syntax), and we discover them automatically so the UI can
 * prompt the user to bind each to a data field — no code change to add a
 * template.
 *
 * Pure functions only — fully unit-tested (see tests/placeholders.test.ts).
 */

/** Section markers we should not treat as data placeholders. */
const SECTION_PREFIXES = ["#", "/", "^", ">", "@", "!"];

/**
 * Extract the unique, ordered list of data placeholders from raw template text.
 * Loop/condition markers (`{#items}`, `{/items}`, `{^empty}`) are ignored.
 *
 * @example discoverPlaceholders("Dear {subjectName}, re {reference}.")
 *          // => ["subjectName", "reference"]
 */
export function discoverPlaceholders(templateText: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(templateText)) !== null) {
    let tag = match[1].trim();
    if (!tag) continue;
    if (SECTION_PREFIXES.includes(tag[0])) tag = tag.slice(1).trim();
    if (!tag) continue;
    // Strip docxtemplater formatters/filters, e.g. {date | format}.
    tag = tag.split("|")[0].trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    found.push(tag);
  }
  return found;
}

export interface MappingValidation {
  /** Placeholders present in the template but not bound to any data field. */
  unmapped: string[];
  /** Mapped placeholders that are not actually present in the template. */
  unused: string[];
  /** True when every template placeholder has a binding. */
  isComplete: boolean;
}

/**
 * Compare a template's discovered placeholders against a proposed
 * placeholder→field mapping. Surfaces gaps to the user *before* a batch run,
 * rather than silently producing blank fields at generation time.
 */
export function validateMappings(
  placeholders: string[],
  fieldMappings: Record<string, string>,
): MappingValidation {
  const mappedKeys = new Set(Object.keys(fieldMappings));
  const placeholderSet = new Set(placeholders);

  const unmapped = placeholders.filter((p) => !mappedKeys.has(p));
  const unused = [...mappedKeys].filter((k) => !placeholderSet.has(k));

  return { unmapped, unused, isComplete: unmapped.length === 0 };
}
