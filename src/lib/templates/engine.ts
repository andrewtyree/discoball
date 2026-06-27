/**
 * Document generation engine — SCAFFOLD STUB.
 *
 * Server-side document generation: DiscoBall renders DOCX with `docxtemplater`
 * (so it works for many concurrent users, headless, with no desktop software)
 * and optionally converts to PDF via a headless LibreOffice/Gotenberg service.
 *
 * Phase 3 implements:
 *   - renderDocx(): merge one record's data into a template buffer
 *   - renderBatch(): loop a filtered record set, zip the results, record a run
 *   - toPdf(): POST the DOCX to PDF_RENDER_URL for conversion
 *
 * See src/lib/templates/placeholders.ts for the (already-implemented) tag
 * discovery and mapping validation this engine relies on.
 */

export interface RenderContext {
  /** Flat data object keyed by template placeholder (already mapped). */
  data: Record<string, unknown>;
}

export interface RenderResult {
  filename: string;
  /** The produced file bytes (DOCX or PDF). */
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Render a single document from a template buffer and a mapped data context.
 *
 * TODO(Phase 3): implement with PizZip + Docxtemplater:
 *   const zip = new PizZip(templateBytes);
 *   const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
 *   doc.render(ctx.data);
 *   return doc.getZip().generate({ type: "uint8array" });
 */
export async function renderDocx(
  _templateBytes: Uint8Array,
  _ctx: RenderContext,
): Promise<RenderResult> {
  throw new Error("renderDocx is not implemented yet (ROADMAP.md Phase 3).");
}

/**
 * Convert a DOCX buffer to PDF via the configured render service.
 * Returns the DOCX unchanged when PDF_RENDER_URL is not set (DOCX-only mode).
 */
export async function toPdf(_docxBytes: Uint8Array): Promise<Uint8Array> {
  throw new Error("toPdf is not implemented yet (ROADMAP.md Phase 3).");
}
