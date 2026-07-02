import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ConfigBanner } from "@/components/config-banner";
import { ContactFields, CONTACT_TYPE_LABELS } from "@/components/contact-fields";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createContact, deleteContact, toggleContactActive } from "@/lib/contacts/actions";
import { listContacts } from "@/lib/contacts/queries";

/** The org's contact book: the people and organizations records link to. */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [contacts, sp] = await Promise.all([listContacts(user.orgId), searchParams]);
  const canWrite = can(user.role, "record:write");

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="The workspace contact book — link contacts to records from a record’s Contacts tab."
      />

      <ConfigBanner ok={sp.ok} error={sp.error} />

      <Card className="mb-6 p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Organization</th>
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Phone</th>
                <th className="p-3 font-medium">Records</th>
                <th className="p-3 font-medium">Active</th>
                {canWrite ? <th className="p-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr>
                  <td className="p-3 text-[var(--muted-foreground)]" colSpan={8}>
                    No contacts yet{canWrite ? " — add the first one below." : "."}
                  </td>
                </tr>
              ) : (
                contacts.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">
                      {canWrite ? (
                        <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                          {c.displayName}
                        </Link>
                      ) : (
                        <span className="font-medium">{c.displayName}</span>
                      )}
                      {c.fullName && c.fullName !== c.displayName ? (
                        <div className="text-xs text-[var(--muted-foreground)]">{c.fullName}</div>
                      ) : null}
                    </td>
                    <td className="p-3">{CONTACT_TYPE_LABELS[c.type] ?? c.type}</td>
                    <td className="p-3">{c.organization ?? "—"}</td>
                    <td className="p-3 text-[var(--muted-foreground)]">{c.email ?? "—"}</td>
                    <td className="p-3 text-[var(--muted-foreground)]">{c.phone ?? "—"}</td>
                    <td className="p-3">{c.recordCount}</td>
                    <td className="p-3">
                      {canWrite ? (
                        <form action={toggleContactActive}>
                          <input type="hidden" name="id" value={c.id} />
                          <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                            {c.isActive ? "Active — deactivate" : "Inactive — activate"}
                          </Button>
                        </form>
                      ) : c.isActive ? (
                        "Yes"
                      ) : (
                        "No"
                      )}
                    </td>
                    {canWrite ? (
                      <td className="p-3 text-right">
                        {c.recordCount === 0 ? (
                          <form action={deleteContact}>
                            <input type="hidden" name="id" value={c.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              className="px-2 py-1 text-xs text-red-600"
                            >
                              Delete
                            </Button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {canWrite ? (
        <Card className="max-w-3xl">
          <CardTitle>Add a contact</CardTitle>
          <CardDescription className="mb-4">
            Contacts linked to records can be deactivated but not deleted.
          </CardDescription>
          <form action={createContact} className="flex flex-col gap-4">
            <ContactFields />
            <div>
              <Button type="submit">Add contact</Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Your role ({user.role}) can view contacts but not change them.
        </p>
      )}
    </>
  );
}
