/**
 * Export the filtered records list as CSV or JSON.
 *
 * GET /api/records/export?format=csv|json&<records-list filter params>
 *
 * Auth: session required; `record:read` (viewers may export what they can
 * see). Filter params are the records page's own URL params, reparsed with
 * the same validated schema, so the download always matches the visible
 * list. Over-cap result sets return 413 rather than silently truncating —
 * a download link can't surface a warning header.
 */
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { serializeCsv } from "@/lib/csv";
import {
  buildExportColumns,
  exportRecordToJson,
  exportRowsToCsv,
  type ExportRecordRow,
} from "@/lib/export/columns";
import { rateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { can } from "@/lib/rbac";
import { recordFilterFromSearchParams } from "@/lib/records/filters";
import { EXPORT_RECORD_CAP, listRecordsForExport } from "@/lib/records/queries";
import { customFieldDefsByRecordType } from "@/lib/templates/queries";
import { contentDispositionAttachment } from "@/lib/templates/resolve";
import { ymd } from "@/lib/utils";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(user.role, "record:read")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const limited = rateLimit("export", user.id);
  if (!limited.ok) {
    return new NextResponse(rateLimitMessage(limited), {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) },
    });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") {
    return new NextResponse("Unsupported format — use csv or json", { status: 400 });
  }

  const raw: Record<string, string | string[]> = {};
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const filter = recordFilterFromSearchParams(raw);

  const rows = await listRecordsForExport(user.orgId, filter, EXPORT_RECORD_CAP + 1);
  if (rows.length > EXPORT_RECORD_CAP) {
    return new NextResponse(
      `Export matches more than ${EXPORT_RECORD_CAP.toLocaleString("en-US")} records — narrow the filter.`,
      { status: 413 },
    );
  }
  const exportRows: ExportRecordRow[] = rows;
  const stamp = ymd(new Date());

  if (format === "json") {
    const body = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        count: exportRows.length,
        records: exportRows.map(exportRecordToJson),
      },
      null,
      2,
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": contentDispositionAttachment(`records-${stamp}.json`),
      },
    });
  }

  const columns = buildExportColumns(await customFieldDefsByRecordType(user.orgId));
  const csv = serializeCsv(exportRowsToCsv(columns, exportRows));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(`records-${stamp}.csv`),
    },
  });
}
