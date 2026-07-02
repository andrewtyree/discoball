/**
 * Documents tab — the tracked documents/deliverables on one record, with
 * status transitions and an add form. Server-rendered forms posting to the
 * detail actions; RBAC re-checked server-side.
 */
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  addDocument,
  deleteDocument,
  updateDocumentStatus,
} from "@/lib/records/detail-actions";
import type { listRecordDocuments } from "@/lib/records/queries";
import { cn, ymd } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: "Requested",
  RECEIVED: "Received",
  PRODUCED: "Produced",
  NOT_APPLICABLE: "N/A",
};

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: "bg-amber-500/15 text-amber-700",
  RECEIVED: "bg-green-600/15 text-green-700",
  PRODUCED: "bg-blue-600/15 text-blue-700",
  NOT_APPLICABLE: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

export function DocumentsPanel({
  recordId,
  documents,
  canWrite,
}: {
  recordId: string;
  documents: Awaited<ReturnType<typeof listRecordDocuments>>;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0">
        {documents.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted-foreground)]">
            No documents tracked on this record yet.
            {canWrite ? " Add the first one below." : ""}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                <tr>
                  <th className="p-3 font-medium">Title</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Received</th>
                  <th className="p-3 font-medium">Notes</th>
                  {canWrite ? <th className="p-3 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3 font-medium">{doc.title}</td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                          STATUS_STYLES[doc.status],
                        )}
                      >
                        {STATUS_LABELS[doc.status]}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      {doc.receivedDate ? ymd(doc.receivedDate) : "—"}
                    </td>
                    <td className="max-w-64 p-3 text-[var(--muted-foreground)]">
                      {doc.notes ?? "—"}
                    </td>
                    {canWrite ? (
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <form action={updateDocumentStatus} className="flex items-center gap-1.5">
                            <input type="hidden" name="recordId" value={recordId} />
                            <input type="hidden" name="documentId" value={doc.id} />
                            <Select
                              name="status"
                              defaultValue={doc.status}
                              aria-label={`Status of ${doc.title}`}
                              className="py-1 text-xs"
                            >
                              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </Select>
                            <Button type="submit" variant="outline" className="px-2 py-1 text-xs">
                              Set
                            </Button>
                          </form>
                          <form action={deleteDocument}>
                            <input type="hidden" name="recordId" value={recordId} />
                            <input type="hidden" name="documentId" value={doc.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              className="px-2 py-1"
                              aria-label={`Delete document “${doc.title}”`}
                              title={`Delete document “${doc.title}”`}
                            >
                              <Trash2 size={14} aria-hidden />
                            </Button>
                          </form>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canWrite ? (
        <Card>
          <CardTitle>Add a document</CardTitle>
          <CardDescription className="mb-4">
            Track a requested, received, or produced document on this record.
          </CardDescription>
          <form action={addDocument} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="recordId" value={recordId} />
            <Field label="Title" htmlFor="doc-title" className="md:col-span-2">
              <Input id="doc-title" name="title" required maxLength={300} />
            </Field>
            <Field label="Status" htmlFor="doc-status">
              <Select id="doc-status" name="status" defaultValue="REQUESTED">
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Received date (optional)" htmlFor="doc-received">
              <Input id="doc-received" name="receivedDate" type="date" />
            </Field>
            <Field label="Notes (optional)" htmlFor="doc-notes" className="md:col-span-2">
              <Textarea id="doc-notes" name="notes" maxLength={2000} className="min-h-16" />
            </Field>
            <div>
              <Button type="submit">Add document</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
