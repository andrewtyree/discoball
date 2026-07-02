/**
 * Preview: render ONE record through a template on the fly — no run row.
 *
 *   GET /api/templates/<id>/preview?recordId=<uuid>&mode=docx|pdf
 *
 * Auth: session required; `generation:run` (a preview is a one-record
 * generation). Wrong-org template or record → 404, no info leak. An
 * incomplete mapping → 422 with a plain-text body naming the unmapped tags,
 * mirroring the batch runner's "reported, not silently mis-filled" rule.
 */
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getObject } from "@/lib/storage";
import {
  DOCX_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  renderDocx,
  toPdf,
} from "@/lib/templates/engine";
import { validateMappings } from "@/lib/templates/placeholders";
import {
  customFieldDefsByRecordType,
  getRecordForGeneration,
  getTemplate,
} from "@/lib/templates/queries";
import {
  buildRenderData,
  contentDispositionAttachment,
  resolveOutputName,
  sanitizeFileName,
} from "@/lib/templates/resolve";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "generation:run")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const recordId = url.searchParams.get("recordId") ?? "";
  const mode = (url.searchParams.get("mode") ?? "docx").toLowerCase();
  if (!UUID_RE.test(id) || !UUID_RE.test(recordId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (mode !== "docx" && mode !== "pdf") {
    return new NextResponse("mode must be docx or pdf", { status: 400 });
  }

  const [template, record] = await Promise.all([
    getTemplate(user.orgId, id),
    getRecordForGeneration(user.orgId, recordId),
  ]);
  if (!template || !record) return new NextResponse("Not found", { status: 404 });

  // Inactive templates can't generate documents — the same gate the batch
  // runner enforces (runner.ts), so a bookmarked preview URL can't bypass it.
  if (!template.isActive) {
    return new NextResponse("Template is inactive", { status: 409 });
  }

  const validation = validateMappings(template.placeholders, template.fieldMappings);
  if (!validation.isComplete) {
    const tags = validation.unmapped.map((t) => `{${t}}`).join(", ");
    return new NextResponse(`Template has unmapped placeholders: ${tags}`, {
      status: 422,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const defs = (await customFieldDefsByRecordType(user.orgId)).get(record.recordTypeId) ?? [];
  const { data } = buildRenderData(record, defs, template.fieldMappings);
  const templateBytes = await getObject(template.storageKey);
  let rendered: Awaited<ReturnType<typeof renderDocx>>;
  try {
    rendered = await renderDocx(templateBytes, { data });
  } catch (err) {
    // A template defect (e.g. malformed tags that survived upload via the
    // regex fallback) — report it like the unmapped-placeholder case instead
    // of surfacing a raw 500; the batch runner stores the same message.
    const message = err instanceof Error ? err.message : "Template rendering failed.";
    return new NextResponse(message, {
      status: 422,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const baseName =
    sanitizeFileName(resolveOutputName(template.outputNamePattern, record, defs)) ||
    `record-${record.id.slice(0, 8)}`;

  let bytes: Uint8Array = rendered.bytes;
  let contentType = DOCX_CONTENT_TYPE;
  if (mode === "pdf") {
    try {
      bytes = await toPdf(rendered.bytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF conversion failed";
      return new NextResponse(message, { status: 503 });
    }
    contentType = PDF_CONTENT_TYPE;
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDispositionAttachment(`${baseName}.${mode}`),
    },
  });
}
