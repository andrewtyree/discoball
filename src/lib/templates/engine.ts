/**
 * Document generation engine.
 *
 * Server-side document generation: DiscoBall renders DOCX with `docxtemplater`
 * (so it works for many concurrent users, headless, with no desktop software)
 * and converts to PDF via the headless LibreOffice/Gotenberg service from
 * docker-compose (ADR-0007).
 *
 * See src/lib/templates/placeholders.ts for tag discovery / mapping validation
 * and src/lib/templates/resolve.ts for placeholder → data resolution.
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import { assertSafeInflatedSize } from "./zip-guard";

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_CONTENT_TYPE = "application/pdf";
export const ZIP_CONTENT_TYPE = "application/zip";

export interface RenderContext {
  /** Flat data object keyed by template placeholder (already mapped). */
  data: Record<string, unknown>;
}

export interface RenderResult {
  /** The merged .docx bytes. */
  bytes: Uint8Array;
  /** Template tags that had no value in the data (rendered as "" instead of
   *  failing) — surfaced to the user as warnings, never silently dropped. */
  missingTags: string[];
}

/** Human-readable message from a docxtemplater error (they nest sub-errors). */
export function describeTemplateError(err: unknown): string {
  const e = err as {
    message?: string;
    properties?: {
      explanation?: string;
      errors?: { properties?: { explanation?: string } }[];
    };
  };
  const subs = e?.properties?.errors;
  if (Array.isArray(subs) && subs.length > 0) {
    return subs
      .map((s) => s?.properties?.explanation ?? "template error")
      .join("; ");
  }
  return e?.properties?.explanation ?? e?.message ?? "invalid template";
}

/** Template buffers already verified against the decompression-bomb ceiling —
 *  keyed on the exact buffer so a 500-record batch pays the check once. */
const verifiedTemplates = new WeakSet<Uint8Array>();

/**
 * Render a single document from a template buffer and a mapped data context.
 * Missing values render as empty strings, but every tag that resolved to
 * null/undefined is reported back in `missingTags`.
 */
export async function renderDocx(
  templateBytes: Uint8Array,
  ctx: RenderContext,
): Promise<RenderResult> {
  const missing: string[] = [];
  let doc: Docxtemplater<PizZip>;
  try {
    const zip = new PizZip(templateBytes);
    // Decompression-bomb gate: never let Docxtemplater inflate an archive
    // whose uncompressed size is uncapped (upload checks compressed size only).
    if (!verifiedTemplates.has(templateBytes)) {
      assertSafeInflatedSize(zip);
      verifiedTemplates.add(templateBytes);
    }
    doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Errors are rethrown with a readable message below; don't also dump
      // docxtemplater's verbose JSON to the server log.
      errorLogging: false,
      nullGetter(part) {
        // Simple placeholders have no module; loop/raw parts handle their own
        // empty states.
        if (!part.module) missing.push(part.value);
        return "";
      },
    });
    doc.render(ctx.data);
  } catch (err) {
    throw new Error(`Template rendering failed: ${describeTemplateError(err)}`);
  }
  const bytes = doc
    .getZip()
    .generate({ type: "uint8array", compression: "DEFLATE" }) as Uint8Array;
  return { bytes, missingTags: [...new Set(missing)] };
}

const PDF_SERVICE_HINT = "PDF render service unavailable (docker compose up -d pdf)";

/**
 * Convert a DOCX buffer to PDF via the Gotenberg service at PDF_RENDER_URL
 * (Gotenberg 8: POST multipart to /forms/libreoffice/convert).
 */
export async function toPdf(docxBytes: Uint8Array): Promise<Uint8Array> {
  const base = (process.env.PDF_RENDER_URL ?? "http://localhost:3001").replace(/\/+$/, "");

  const form = new FormData();
  form.append(
    "files",
    new Blob([docxBytes as BlobPart], { type: DOCX_CONTENT_TYPE }),
    "document.docx",
  );

  let res: Response;
  try {
    res = await fetch(`${base}/forms/libreoffice/convert`, {
      method: "POST",
      body: form,
      // A hung (rather than refused) service must fail the run, not strand it
      // in RUNNING; LibreOffice conversions are seconds, not minutes.
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(PDF_SERVICE_HINT);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `${PDF_SERVICE_HINT} — HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
