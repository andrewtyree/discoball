import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import {
  backToImportMapping,
  commitImport,
  saveImportMapping,
} from "@/lib/import/actions";
import { getImportRun, listCustomFieldDefs, type ImportRunDetail } from "@/lib/import/queries";
import { importTargetsFor, type ImportTarget } from "@/lib/import/targets";
import { can } from "@/lib/rbac";
import { getObject } from "@/lib/storage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PREVIEW_ROWS = 10;
const ERRORS_SHOWN = 50;

const BANNER_ERRORS: Record<string, string> = {
  forbidden: "Your role doesn't have permission to import records.",
  mapping: "The column mapping isn't valid.",
  unreadable: "The uploaded file could no longer be read — start a new import.",
  not_editable: "This import has already run; its mapping can't be changed.",
  not_ready: "This import isn't ready to commit (it may already be running).",
  has_errors:
    "The file still has invalid rows. Fix them (or tick “skip invalid rows”) and try again.",
  failed: "The import failed — details below.",
};

function Banner({ error, detail, ok }: { error?: string; detail?: string; ok?: string }) {
  if (error) {
    const base = BANNER_ERRORS[error] ?? "Something went wrong. Please try again.";
    return (
      <p
        role="alert"
        className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
      >
        {error === "mapping" && detail ? `${base} ${detail}` : base}
      </p>
    );
  }
  if (ok) {
    return (
      <p
        role="status"
        className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
      >
        {ok}
      </p>
    );
  }
  return null;
}

async function readCsvRows(storageKey: string): Promise<string[][] | null> {
  try {
    return parseCsv(new TextDecoder().decode(await getObject(storageKey)));
  } catch {
    return null;
  }
}

/** The wizard after upload: mapping editor, validation summary, or result —
 *  one page, rendered by run status, so a refresh always lands right. */
export default async function ImportRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const run = await getImportRun(user.orgId, id);
  if (!run) notFound();

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = first(sp.error);
  const detail = first(sp.detail);
  const ok = first(sp.done)
    ? `Imported ${run.importedCount} record${run.importedCount === 1 ? "" : "s"}.`
    : first(sp.mapped)
      ? "Mapping saved and rows validated."
      : undefined;

  const canWrite = can(user.role, "record:write");

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title={`Import: ${run.fileName}`}
          subtitle={`${run.rowCount} data row${run.rowCount === 1 ? "" : "s"} → new ${run.recordTypeName} records.`}
        />
        <Link href="/records/import" className="text-sm underline">
          All imports
        </Link>
      </div>

      <Banner error={error} detail={detail} ok={ok} />

      {run.status === "UPLOADED" ? (
        <MappingStep run={run} canWrite={canWrite} orgId={user.orgId} />
      ) : run.status === "MAPPED" ? (
        <ValidationStep run={run} canWrite={canWrite} />
      ) : run.status === "RUNNING" ? (
        <Card className="py-10 text-center">
          <CardTitle className="text-base">Import is running…</CardTitle>
          <CardDescription>Refresh this page for the result.</CardDescription>
        </Card>
      ) : run.status === "COMPLETED" ? (
        <Card className="py-10 text-center">
          <CardTitle className="text-base">
            Imported {run.importedCount} of {run.rowCount} rows
          </CardTitle>
          <CardDescription className="mx-auto max-w-md">
            {run.errorCount > 0
              ? `${run.errorCount} invalid row${run.errorCount === 1 ? "" : "s"} were skipped (listed below).`
              : "Every row imported cleanly."}{" "}
            <Link href="/records" className="underline">
              See them in the records list.
            </Link>
          </CardDescription>
          {run.errorCount > 0 ? <ErrorsTable run={run} /> : null}
        </Card>
      ) : (
        <Card className="py-10 text-center">
          <CardTitle className="text-base text-red-600">Import failed</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            {run.error ?? "Something went wrong."}{" "}
            <Link href="/records/import" className="underline">
              Start a new import.
            </Link>
          </CardDescription>
        </Card>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Step: column mapping                                                        */
/* -------------------------------------------------------------------------- */

async function MappingStep({
  run,
  canWrite,
  orgId,
}: {
  run: ImportRunDetail;
  canWrite: boolean;
  orgId: string;
}) {
  const rows = await readCsvRows(run.storageKey);
  if (!rows || rows.length < 1) {
    return (
      <Card className="py-10 text-center">
        <CardTitle className="text-base text-red-600">File unreadable</CardTitle>
        <CardDescription>
          The uploaded CSV could no longer be read —{" "}
          <Link href="/records/import" className="underline">
            start a new import
          </Link>
          .
        </CardDescription>
      </Card>
    );
  }
  const headers = rows[0];
  const sample = rows[1] ?? [];
  const preview = rows.slice(1, 1 + PREVIEW_ROWS);
  const defs = await listCustomFieldDefs(orgId, run.recordTypeId);
  const targets = importTargetsFor(defs);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle className="text-base">Map columns to fields</CardTitle>
        <CardDescription className="mb-4">
          Each CSV column can fill one field of the new records; leave a
          column on “Ignore” to skip it. Exactly one column must provide the
          Title.
        </CardDescription>

        <form action={saveImportMapping} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={run.id} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                  <th className="p-2">CSV column</th>
                  <th className="p-2">First row</th>
                  <th className="p-2">Imports into</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header, index) => (
                  <tr key={header} className="border-b border-[var(--border)]/60">
                    <td className="p-2 font-mono text-xs">{header}</td>
                    <td className="max-w-56 truncate p-2 text-xs text-[var(--muted-foreground)]">
                      {sample[index] ?? ""}
                    </td>
                    <td className="p-2">
                      <Select
                        name={`col_${index}`}
                        defaultValue={run.columnMapping[header] ?? ""}
                        className="w-full max-w-72 py-1.5"
                        disabled={!canWrite}
                      >
                        <option value="">Ignore</option>
                        {targets.map((t: ImportTarget) => (
                          <option key={t.path} value={t.path}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canWrite ? (
            <div>
              <Button type="submit">Validate rows</Button>
            </div>
          ) : null}
        </form>
      </Card>

      <Card>
        <CardTitle className="text-base">File preview</CardTitle>
        <CardDescription className="mb-3">
          First {preview.length} of {run.rowCount} data rows.
        </CardDescription>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                {headers.map((h) => (
                  <th key={h} className="p-2 font-mono">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-[var(--border)]/60">
                  {headers.map((_, j) => (
                    <td key={j} className="max-w-56 truncate p-2 text-xs">
                      {row[j] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Step: validation summary + commit                                           */
/* -------------------------------------------------------------------------- */

function ValidationStep({ run, canWrite }: { run: ImportRunDetail; canWrite: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardTitle className="text-base">
          {run.validCount} of {run.rowCount} rows are ready to import
        </CardTitle>
        <CardDescription className="mb-4">
          {run.errorCount > 0
            ? `${run.errorCount} row${run.errorCount === 1 ? " has" : "s have"} problems — fix the file and re-upload, adjust the mapping, or skip them.`
            : "Every row validated cleanly."}
        </CardDescription>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-4">
            <form action={commitImport} className="flex flex-wrap items-center gap-4">
              <input type="hidden" name="id" value={run.id} />
              {run.errorCount > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="skipInvalid" />
                  Skip the {run.errorCount} invalid row
                  {run.errorCount === 1 ? "" : "s"} and import the rest
                </label>
              ) : null}
              <Button type="submit" disabled={run.validCount === 0}>
                Import {run.validCount} record{run.validCount === 1 ? "" : "s"}
              </Button>
            </form>
            <form action={backToImportMapping}>
              <input type="hidden" name="id" value={run.id} />
              <Button type="submit" variant="outline">
                Back to mapping
              </Button>
            </form>
          </div>
        ) : null}
      </Card>

      {run.errorCount > 0 ? <ErrorsTable run={run} /> : null}
    </div>
  );
}

function ErrorsTable({ run }: { run: ImportRunDetail }) {
  const shown = run.errors.slice(0, ERRORS_SHOWN);
  return (
    <Card>
      <CardTitle className="text-base">Row problems</CardTitle>
      <CardDescription className="mb-3">
        Row numbers count the header as row 1, like a spreadsheet.
        {run.errors.length > shown.length || run.errorCount > run.errors.length
          ? ` Showing the first ${shown.length}.`
          : ""}
      </CardDescription>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="w-16 p-2">Row</th>
              <th className="w-40 p-2">Column</th>
              <th className="p-2">Problem</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr key={i} className="border-b border-[var(--border)]/60">
                <td className="p-2 font-mono text-xs">{e.row}</td>
                <td className="p-2 font-mono text-xs">{e.column ?? "—"}</td>
                <td className="p-2 text-xs">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
