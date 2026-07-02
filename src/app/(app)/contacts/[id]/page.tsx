import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ConfigBanner } from "@/components/config-banner";
import { ContactFields } from "@/components/contact-fields";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { updateContact } from "@/lib/contacts/actions";
import { getContact } from "@/lib/contacts/queries";

/** Edit one contact. */
export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  if (!can(user.role, "record:write")) redirect("/contacts");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const contact = await getContact(user.orgId, id);
  if (!contact) notFound();

  const sp = await searchParams;

  return (
    <>
      <PageHeader title={contact.displayName} subtitle="Contact" />
      <p className="mb-4 text-sm">
        <Link href="/contacts" className="text-[var(--muted-foreground)] hover:underline">
          ← Back to contacts
        </Link>
      </p>

      <ConfigBanner ok={sp.ok} error={sp.error} />

      <Card className="max-w-3xl">
        <CardTitle className="mb-4">Details</CardTitle>
        <form action={updateContact} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={contact.id} />
          <ContactFields contact={contact} />
          <div>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
