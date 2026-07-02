/**
 * Download a completed generation run's artifact (.docx / .pdf / .zip).
 *
 * Auth: session required; `template:read`. A run in another org returns 404
 * (no info leak); a run without an artifact (running/failed) also 404s.
 */
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getObject } from "@/lib/storage";
import {
  DOCX_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  ZIP_CONTENT_TYPE,
} from "@/lib/templates/engine";
import { getRun } from "@/lib/templates/queries";
import { contentDispositionAttachment, sanitizeFileName } from "@/lib/templates/resolve";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  docx: DOCX_CONTENT_TYPE,
  pdf: PDF_CONTENT_TYPE,
  zip: ZIP_CONTENT_TYPE,
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "template:read")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return new NextResponse("Not found", { status: 404 });

  const run = await getRun(user.orgId, id);
  if (!run || run.status !== "COMPLETED" || !run.resultStorageKey) {
    return new NextResponse("Not found", { status: 404 });
  }

  const extension = run.resultStorageKey.split(".").pop() ?? "zip";
  const bytes = new Uint8Array(await getObject(run.resultStorageKey));
  const filename = `${sanitizeFileName(run.templateName) || "generation"}-${run.id.slice(0, 8)}.${extension}`;
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Content-Disposition": contentDispositionAttachment(filename),
    },
  });
}
