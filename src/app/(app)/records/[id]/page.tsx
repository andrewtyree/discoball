import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PageHeader } from "@/components/phase-notice";
import { RecordForm } from "@/components/record-form";
import { ActivityPanel } from "@/components/record-detail/activity-panel";
import { CodesPanel } from "@/components/record-detail/codes-panel";
import { ContactsPanel } from "@/components/record-detail/contacts-panel";
import { DocumentsPanel } from "@/components/record-detail/documents-panel";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { archiveRecord, unarchiveRecord, updateRecord } from "@/lib/records/actions";
import {
  getRecordDetail,
  getRecordFormOptions,
  listAvailableCodes,
  listRecordActivity,
  listRecordCodes,
  listRecordContacts,
  listRecordDocuments,
} from "@/lib/records/queries";
import { cn, ymd } from "@/lib/utils";

const TABS = ["overview", "documents", "contacts", "codes", "activity"] as const;
type Tab = (typeof TABS)[number];

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That change wasn’t valid — check the fields and try again.",
  duplicate: "That item is already on this record.",
};

/** Record detail: tabbed working surface — overview (edit form), documents,
 *  contacts, codes, and the full audit timeline. */
export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; saved?: string; ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const record = await getRecordDetail(user.orgId, id);
  if (!record) notFound();

  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "overview";

  const [options, documents, contacts, codes, availableCodes, activity] = await Promise.all([
    getRecordFormOptions(user.orgId),
    listRecordDocuments(user.orgId, id),
    listRecordContacts(user.orgId, id),
    listRecordCodes(user.orgId, id),
    listAvailableCodes(user.orgId),
    listRecordActivity(user.orgId, id, 200),
  ]);

  const canWrite = can(user.role, "record:write");
  const canDelete = can(user.role, "record:delete");

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents", count: documents.length },
    { key: "contacts", label: "Contacts", count: contacts.length },
    { key: "codes", label: "Codes", count: codes.length },
    { key: "activity", label: "Activity" },
  ];

  return (
    <>
      <PageHeader
        title={record.title}
        subtitle={[record.reference, record.recordType?.name].filter(Boolean).join(" · ") || undefined}
      />

      {sp.saved || sp.ok ? (
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
      ) : sp.error && ERROR_MESSAGES[sp.error] ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {ERROR_MESSAGES[sp.error]}
        </p>
      ) : null}
      {record.isArchived ? (
        <p className="mb-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
          This record is archived
          {record.archivedReason ? <> — “{record.archivedReason}”</> : null}.
        </p>
      ) : null}

      <nav aria-label="Record sections" className="mb-6 border-b border-[var(--border)]">
        <ul className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={t.key === "overview" ? `/records/${id}` : `/records/${id}?tab=${t.key}`}
                aria-current={tab === t.key ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                  tab === t.key
                    ? "border-[var(--primary)] font-medium"
                    : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                {t.label}
                {t.count !== undefined ? (
                  <span className="rounded-full bg-[var(--muted)] px-1.5 text-xs tabular-nums">
                    {t.count}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
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

          <div className="flex flex-col gap-6">
            <Card>
              <CardTitle className="mb-3">At a glance</CardTitle>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-[var(--muted-foreground)]">Status</dt>
                <dd>
                  {record.status ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: record.status.color }}
                      />
                      {record.status.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Assignee</dt>
                <dd>{record.assignee?.name ?? record.assignee?.email ?? "Unassigned"}</dd>
                <dt className="text-[var(--muted-foreground)]">Due</dt>
                <dd className="font-mono text-xs leading-5">
                  {record.dueDate ? ymd(record.dueDate) : "—"}
                </dd>
                <dt className="text-[var(--muted-foreground)]">Version</dt>
                <dd className="tabular-nums">{record.version}</dd>
                <dt className="text-[var(--muted-foreground)]">Updated</dt>
                <dd className="font-mono text-xs leading-5">{ymd(record.updatedAt)}</dd>
                <dt className="text-[var(--muted-foreground)]">Created</dt>
                <dd className="font-mono text-xs leading-5">{ymd(record.createdAt)}</dd>
              </dl>
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
        </div>
      ) : tab === "documents" ? (
        <DocumentsPanel recordId={id} documents={documents} canWrite={canWrite} />
      ) : tab === "contacts" ? (
        <ContactsPanel
          recordId={id}
          linked={contacts}
          available={options.contacts}
          canWrite={canWrite}
        />
      ) : tab === "codes" ? (
        <CodesPanel
          recordId={id}
          applied={codes}
          available={availableCodes}
          canWrite={canWrite}
        />
      ) : (
        <ActivityPanel activity={activity} version={record.version} />
      )}
    </>
  );
}
