"use client";
/**
 * Upload form for a CSV import. Client component only for useActionState:
 * validation problems (not a .csv, too big, malformed quoting) come back as
 * an inline error banner, matching the template-upload pattern.
 */
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { ImportUploadState } from "@/lib/import/actions";

const IDLE: ImportUploadState = { status: "idle" };

/** Mirrors MAX_IMPORT_BYTES in lib/import/actions.ts so oversized files
 *  never leave the browser (the server re-checks regardless). */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function ImportUploadForm({
  action,
  recordTypes,
}: {
  action: (state: ImportUploadState, formData: FormData) => Promise<ImportUploadState>;
  recordTypes: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const [fileError, setFileError] = useState<string | null>(null);
  const errorMessage = fileError ?? (state.status === "error" ? state.message : null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errorMessage ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {errorMessage}
        </p>
      ) : null}

      <Field label="CSV file (up to 5 MB, 5,000 rows)" htmlFor="import-file">
        <Input
          id="import-file"
          name="file"
          type="file"
          required
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            setFileError(
              f && f.size > MAX_IMPORT_BYTES ? "Import files must be 5 MB or smaller." : null,
            );
          }}
        />
      </Field>

      <Field label="Record type" htmlFor="import-record-type">
        <Select id="import-record-type" name="recordTypeId" required defaultValue="">
          <option value="" disabled>
            Pick the type these rows become…
          </option>
          {recordTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="-mt-2 text-xs text-[var(--muted-foreground)]">
        Imports are one record type per file — the type decides which custom
        fields the columns can map to. The first row must be column headers.
      </p>

      <div>
        <Button type="submit" disabled={isPending || fileError !== null}>
          {isPending ? "Uploading…" : "Upload and map columns"}
        </Button>
      </div>
    </form>
  );
}
