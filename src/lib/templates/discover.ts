/**
 * Placeholder discovery from an uploaded .docx buffer.
 *
 * Word splits text into runs unpredictably (spell-check marks, formatting),
 * so `{subjectName}` in the document XML can arrive as `{sub` + `jectName}`
 * across two runs — a plain regex over the XML misses it. Docxtemplater's
 * lexer reassembles runs during compile, so the primary path attaches its
 * InspectModule and reads the compiled tag tree; nested loop contents are
 * flattened so the result matches the semantics of
 * `discoverPlaceholders()` in ./placeholders.ts (loop name + inner tags,
 * deduped, in document order).
 *
 * If InspectModule fails for any reason we fall back to stripping XML from
 * word/document.xml (+ headers/footers) and running the pure regex discovery.
 */
import { createRequire } from "node:module";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import { discoverPlaceholders } from "./placeholders";
import { assertSafeInflatedSize, InflatedSizeError } from "./zip-guard";

// inspect-module.js is CommonJS with no ESM export map entry; docxtemplater
// itself is listed in `serverExternalPackages`, so this resolves at runtime.
const nodeRequire = createRequire(import.meta.url);

type InspectModuleInstance = {
  getAllTags(): Record<string, unknown>;
} & Record<string, unknown>;

/** A user-facing "that's not a usable template" error (bad zip, not a docx). */
export class InvalidTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTemplateError";
  }
}

/** Flatten the nested tag tree from InspectModule#getAllTags — loop tags nest
 *  their inner tags, but our placeholder list is flat (see placeholders.ts). */
function flattenTags(
  tags: Record<string, unknown>,
  out: string[] = [],
  seen = new Set<string>(),
): string[] {
  for (const [key, value] of Object.entries(tags)) {
    const name = key.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenTags(value as Record<string, unknown>, out, seen);
    }
  }
  return out;
}

/** Fallback: strip XML tags and run the pure regex discovery over the
 *  document body plus any headers/footers. Cannot see run-split tags. */
function fallbackDiscover(zip: PizZip): string[] {
  try {
    const parts = Object.keys(zip.files).filter(
      (name) =>
        name === "word/document.xml" || /^word\/(?:header|footer)\d*\.xml$/.test(name),
    );
    const text = parts
      .map((name) => zip.file(name)?.asText() ?? "")
      .join("\n")
      .replace(/<[^>]+>/g, "");
    return discoverPlaceholders(text);
  } catch {
    // Even the raw document text is unreadable — reject the upload with a
    // friendly message instead of letting the throw escape as a 500.
    throw new InvalidTemplateError(
      "That .docx couldn't be read — re-save it in Word and upload it again.",
    );
  }
}

/**
 * Extract the placeholder tags from an uploaded .docx buffer.
 * Throws InvalidTemplateError when the buffer is not a .docx at all.
 */
export function discoverTemplatePlaceholders(bytes: Uint8Array): string[] {
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new InvalidTemplateError(
      "That file doesn't look like a .docx — it isn't a readable Word archive.",
    );
  }
  if (!zip.file("word/document.xml")) {
    throw new InvalidTemplateError(
      "That file doesn't look like a .docx — it has no Word document inside.",
    );
  }

  // Decompression-bomb gate: the upload cap limits compressed size only, so
  // verify the inflated size BEFORE anything (Docxtemplater's constructor,
  // the regex fallback) inflates the archive in memory.
  try {
    assertSafeInflatedSize(zip);
  } catch (err) {
    if (err instanceof InflatedSizeError) {
      throw new InvalidTemplateError(
        "That .docx expands to an unreasonable size when unpacked — it can't be used as a template.",
      );
    }
    throw err;
  }

  try {
    const inspectFactory = nodeRequire(
      "docxtemplater/js/inspect-module.js",
    ) as () => InspectModuleInstance;
    const inspect = inspectFactory();
    // The constructor compiles the template with the module attached.
    new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      modules: [inspect as unknown as Docxtemplater.DXT.Module],
    });
    return flattenTags(inspect.getAllTags());
  } catch {
    // Compile failed (malformed tags) or the module misbehaved — degrade to
    // the regex pass so upload still works; rendering will surface details.
    return fallbackDiscover(zip);
  }
}
