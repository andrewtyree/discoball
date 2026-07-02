/**
 * Contacts tab — the people/organizations linked to one record, each with an
 * optional role on the record (counterparty, witness, …). Links to existing
 * org contacts; the contact book itself is managed at /contacts.
 */
import Link from "next/link";
import { Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { linkContact, unlinkContact } from "@/lib/records/detail-actions";
import type { listRecordContacts } from "@/lib/records/queries";

const TYPE_LABELS: Record<string, string> = {
  COUNTERPARTY: "Counterparty",
  WITNESS: "Witness",
  COLLABORATOR: "Collaborator",
  VENDOR: "Vendor",
  OTHER: "Other",
};

export function ContactsPanel({
  recordId,
  linked,
  available,
  canWrite,
}: {
  recordId: string;
  linked: Awaited<ReturnType<typeof listRecordContacts>>;
  available: { id: string; displayName: string }[];
  canWrite: boolean;
}) {
  const linkedIds = new Set(linked.map((c) => c.contactId));
  const linkable = available.filter((c) => !linkedIds.has(c.id));

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0">
        {linked.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted-foreground)]">
            No contacts linked to this record yet.
            {canWrite ? " Link one below." : ""}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                <tr>
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Type</th>
                  <th className="p-3 font-medium">Role on record</th>
                  <th className="p-3 font-medium">Email</th>
                  <th className="p-3 font-medium">Phone</th>
                  {canWrite ? <th className="p-3 font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {linked.map((c) => (
                  <tr key={c.contactId} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">
                      <span className="font-medium">{c.displayName}</span>
                      {c.organization ? (
                        <div className="text-xs text-[var(--muted-foreground)]">
                          {c.organization}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-3">{TYPE_LABELS[c.type] ?? c.type}</td>
                    <td className="p-3">{c.role ?? "—"}</td>
                    <td className="p-3 text-[var(--muted-foreground)]">{c.email ?? "—"}</td>
                    <td className="p-3 text-[var(--muted-foreground)]">{c.phone ?? "—"}</td>
                    {canWrite ? (
                      <td className="p-3">
                        <form action={unlinkContact}>
                          <input type="hidden" name="recordId" value={recordId} />
                          <input type="hidden" name="contactId" value={c.contactId} />
                          <Button
                            type="submit"
                            variant="ghost"
                            className="px-2 py-1"
                            aria-label={`Unlink ${c.displayName}`}
                            title={`Unlink ${c.displayName}`}
                          >
                            <Unlink size={14} aria-hidden />
                          </Button>
                        </form>
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
          <CardTitle>Link a contact</CardTitle>
          <CardDescription className="mb-4">
            Attach an existing contact with an optional role on this record.
            Manage the contact book itself in{" "}
            <Link href="/contacts" className="underline">
              Contacts
            </Link>
            .
          </CardDescription>
          {linkable.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              Every contact in the workspace is already linked to this record.
            </p>
          ) : (
            <form action={linkContact} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="recordId" value={recordId} />
              <Field label="Contact" htmlFor="link-contact">
                <Select id="link-contact" name="contactId" required defaultValue="">
                  <option value="" disabled>
                    Select a contact…
                  </option>
                  {linkable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Role on record (optional)" htmlFor="link-role">
                <Input
                  id="link-role"
                  name="role"
                  maxLength={100}
                  placeholder="e.g. opposing party"
                  className="w-56"
                />
              </Field>
              <Button type="submit">Link contact</Button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
