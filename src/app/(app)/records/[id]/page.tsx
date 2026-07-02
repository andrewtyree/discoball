import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";
import { RecordForm } from "@/components/record-form";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { archiveRecord, unarchiveRecord, updateRecord } from "@/lib/records/actions";
import {
  getRecordDetail,
  getRecordFormOptions,
  listRecordActivity,
} from "@/lib/records/queries";
import { ymd } from "@/lib/utils";

/** Deterministic server-rendered timestamp (no locale surprises). */
function fmtAt(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Record detail: edit with optimistic concurrency, archive/restore, and the
 *  record's recent audit activity. Documents/contacts/codes tabs are Phase 2. */
export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const record = await getRecordDetail(user.orgId, id);
  if (!record) notFound();

  const [options, activity] = await Promise.all([
    getRecordFormOptions(user.orgId),
    listRecordActivity(user.orgId, id),
  ]);

  const sp = await searchParams;
  const canWrite = can(user.role, "record:write");
  const canDelete = can(user.role, "record:delete");

  return (
    <>
      <PageHeader
        title={record.title}
        subtitle={[record.reference, record.recordType?.name].filter(Boolean).join(" · ") || undefined}
      />

      {sp.saved ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
        >
          Saved.
        </p>
      ) : null}
      {sp.error === "forbidden" ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          Your role ({user.role}) doesn’t have permission to do that.
        </p>
      ) : null}
      {record.isArchived ? (
        <p className="mb-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
          This record is archived
          {record.archivedReason ? <> — “{record.archivedReason}”</> : null}.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle className="mb-4">Details</CardTitle>
            <RecordForm
              action={updateRecord}
              options={options}
              readOnly={!canWrite}
              submitLabel="Save changes"
              record={{
                id: record.id,
                version: record.version,
                title: record.title,
                reference: record.reference ?? "",
                subjectName: record.subjectName ?? "",
                recordTypeId: record.recordTypeId,
                statusId: record.statusId ?? "",
                assigneeId: record.assigneeId ?? "",
                openedDate: ymd(record.openedDate),
                dueDate: ymd(record.dueDate),
                customValues: record.customValues,
              }}
            />
          </Card>

          {canDelete ? (
            <Card>
              {record.isArchived ? (
                <>
                  <CardTitle>Restore</CardTitle>
                  <CardDescription className="mb-3">
                    Bring this record back into active lists and searches.
                  </CardDescription>
                  <form action={unarchiveRecord}>
                    <input type="hidden" name="id" value={record.id} />
                    <Button type="submit" variant="outline">
                      Restore record
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <CardTitle>Archive</CardTitle>
                  <CardDescription className="mb-3">
                    Soft-delete: hidden from lists by default, restorable any time.
                  </CardDescription>
                  <form action={archiveRecord} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={record.id} />
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="archive-reason">Reason (optional)</Label>
                      <Input
                        id="archive-reason"
                        name="reason"
                        maxLength={500}
                        placeholder="e.g. duplicate, resolved off-system"
                        className="w-72"
                      />
                    </div>
                    <Button type="submit" variant="outline">
                      Archive record
                    </Button>
                  </form>
                </>
              )}
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle className="mb-1">Recent activity</CardTitle>
            <CardDescription className="mb-3">
              From the append-only audit log. Version {record.version}.
            </CardDescription>
            {activity.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">No activity recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="border-l-2 border-[var(--border)] pl-3">
                    <div>
                      <span className="font-medium">{a.userName ?? a.userEmail ?? "System"}</span>{" "}
                      <span className="text-[var(--muted-foreground)]">{a.action}d this record</span>
                    </div>
                    {a.diff && Object.keys(a.diff).length > 0 ? (
                      <div className="text-xs text-[var(--muted-foreground)]">
                        {a.action === "archive"
                          ? String((a.diff as { reason?: unknown }).reason ?? "")
                          : `changed: ${Object.keys(a.diff).join(", ")}`}
                      </div>
                    ) : null}
                    <div className="text-xs text-[var(--muted-foreground)]">{fmtAt(a.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <PhaseNotice phase="Record detail — Phase 2">
            Custom-field editing, documents, contacts, codes, and the full audit
            timeline land with the Phase 2 detail tabs.
          </PhaseNotice>
        </div>
      </div>
    </>
  );
}
