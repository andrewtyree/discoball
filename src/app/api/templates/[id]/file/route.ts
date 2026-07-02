/**
 * Download a template's original .docx.
 *
 * Auth: session required; `template:read`. A template in another org returns
 * 404 (indistinguishable from "doesn't exist" — no information leak).
 */
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { getTemplate } from "@/lib/templates/queries";
import { DOCX_CONTENT_TYPE } from "@/lib/templates/engine";
import { contentDispositionAttachment, sanitizeFileName } from "@/lib/templates/resolve";
import { getObject } from "@/lib/storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const template = await getTemplate(user.orgId, id);
  if (!template) return new NextResponse("Not found", { status: 404 });

  const bytes = new Uint8Array(await getObject(template.storageKey));
  const filename = sanitizeFileName(template.name) || "template";
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": DOCX_CONTENT_TYPE,
      "Content-Disposition": contentDispositionAttachment(`${filename}.docx`),
    },
  });
}
