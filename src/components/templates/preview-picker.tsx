"use client";
/**
 * Single-record preview picker: choose a record from the (server-searched)
 * shortlist, then open the on-the-fly render in a new tab. Client component
 * only so the DOCX/PDF links can follow the selected record — the search
 * itself is a plain GET form handled by the server page.
 *
 * The preview endpoint answers 422 with a plain-text list of unmapped tags,
 * which the new tab surfaces as-is — worth reading rather than an error page.
 */
import { useState } from "react";

import { Select } from "@/components/ui/input";

const LINK_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--muted)]";

export function PreviewPicker({
  templateId,
  records,
}: {
  templateId: string;
  records: { id: string; label: string }[];
}) {
  const [recordId, setRecordId] = useState(records[0]?.id ?? "");

  if (records.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No records matched — adjust the search above.
      </p>
    );
  }

  const href = (mode: "docx" | "pdf") =>
    `/api/templates/${templateId}/preview?recordId=${recordId}&mode=${mode}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Record to preview"
        value={recordId}
        onChange={(e) => setRecordId(e.target.value)}
        className="w-full max-w-sm"
      >
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </Select>
      <a
        href={href("docx")}
        target="_blank"
        rel="noreferrer"
        className={LINK_CLASS}
      >
        Preview DOCX
      </a>
      <a
        href={href("pdf")}
        target="_blank"
        rel="noreferrer"
        className={LINK_CLASS}
      >
        Preview PDF
      </a>
    </div>
  );
}
