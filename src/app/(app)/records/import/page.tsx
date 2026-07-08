import Link from "next/link";
import { redirect } from "next/navigation";

import { ImportUploadForm } from "@/components/import/import-upload-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { uploadImportCsv } from "@/lib/import/actions";
import { listImportRuns, type ImportRunListRow } from "@/lib/import/queries";
import { can } from "@/lib/rbac";
import { getRecordFormOptions } from "@/lib/records/queries";
import { ymd } from "@/lib/utils";

const STATUS_LABELS: Record<ImportRunListRow["status"], string> = {
  UPLOADED: "Mapping",
  MAPPED: "Ready to import",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

/** CSV import — step 1 (upload) plus the org's import history. */
export default async function ImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  if (!can(user.role, "record:write")) {
    return (
      <>
        <PageHeader title="Import records" subtitle="Create records from a CSV file." />
        <Card className="mt-6 py-10 text-center">
          <CardTitle className="text-base">Importing needs editor access</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Your role ({user.role}) can browse and export records, but only
            editors and above can create them — including by import.
          </CardDescription>
        </Card>
      </>
    );
  }

  const [{ recordTypes }, runs] = await Promise.all([
    getRecordFormOptions(user.orgId),
    listImportRuns(user.orgId),
  ]);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Import records"
          subtitle="Upload a CSV, map its columns to fields, and create records in bulk."
        />
        <Link href="/records" className="text-sm underline">
          Back to records
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card>
          <CardTitle className="text-base">Upload a CSV</CardTitle>
          <CardDescription className="mb-4">
            Tip: the records list&rsquo;s “Export CSV” produces a file whose
            columns map back automatically — export, edit, re-import.
          </CardDescription>
          <ImportUploadForm action={uploadImportCsv} recordTypes={recordTypes} />
        </Card>

        <Card>
          <CardTitle className="text-base">Recent imports</CardTitle>
          {runs.length === 0 ? (
            <CardDescription>No imports yet.</CardDescription>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                    <th className="p-2">File</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Rows</th>
                    <th className="p-2">Imported</th>
                    <th className="p-2">When</th>
                    <th className="p-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-[var(--border)]/60">
                      <td className="p-2">
                        <Link href={`/records/import/${run.id}`} className="underline">
                          {run.fileName}
                        </Link>
                      </td>
                      <td className="p-2">{run.recordTypeName}</td>
                      <td className="p-2">{STATUS_LABELS[run.status]}</td>
                      <td className="p-2 font-mono text-xs">{run.rowCount}</td>
                      <td className="p-2 font-mono text-xs">
                        {run.status === "COMPLETED" ? run.importedCount : "—"}
                      </td>
                      <td className="p-2 font-mono text-xs">{ymd(run.createdAt)}</td>
                      <td className="p-2 text-xs">
                        {run.createdByName ?? run.createdByEmail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
