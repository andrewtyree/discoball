import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ConfigBanner } from "@/components/config-banner";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import {
  createRecordType,
  deleteRecordType,
  toggleRecordTypeActive,
} from "@/lib/config/actions";
import { listRecordTypes } from "@/lib/config/queries";

/** Record-type editor: the kinds of things this workspace tracks. */
export default async function RecordTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [types, sp] = await Promise.all([listRecordTypes(user.orgId), searchParams]);
  const canConfig = can(user.role, "config:write");

  return (
    <>
      <PageHeader
        title="Record types"
        subtitle="Define the kinds of records your team tracks — cases, files, projects…"
      />
      <p className="mb-4 text-sm">
        <Link href="/settings" className="text-[var(--muted-foreground)] hover:underline">
          ← Back to settings
        </Link>
      </p>

      <ConfigBanner ok={sp.ok} error={sp.error} />

      <Card className="mb-6 p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Prefix</th>
              <th className="p-3 font-medium">Description</th>
              <th className="p-3 font-medium">Records</th>
              <th className="p-3 font-medium">Fields</th>
              <th className="p-3 font-medium">State</th>
              {canConfig ? <th className="p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {types.length === 0 ? (
              <tr>
                <td className="p-3 text-[var(--muted-foreground)]" colSpan={7}>
                  No record types yet — add the first one below.
                </td>
              </tr>
            ) : (
              types.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-medium">{t.name}</td>
                  <td className="p-3 font-mono text-xs">{t.referencePrefix ?? "—"}</td>
                  <td className="p-3 text-[var(--muted-foreground)]">{t.description ?? "—"}</td>
                  <td className="p-3">{t.recordCount}</td>
                  <td className="p-3">{t.fieldCount}</td>
                  <td className="p-3">
                    {t.isActive ? (
                      "Active"
                    ) : (
                      <span className="text-[var(--muted-foreground)]">Inactive</span>
                    )}
                  </td>
                  {canConfig ? (
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <form action={toggleRecordTypeActive}>
                          <input type="hidden" name="id" value={t.id} />
                          <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                            {t.isActive ? "Deactivate" : "Activate"}
                          </Button>
                        </form>
                        {t.recordCount === 0 ? (
                          <form action={deleteRecordType}>
                            <input type="hidden" name="id" value={t.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              className="px-2 py-1 text-xs text-red-600"
                            >
                              Delete
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {canConfig ? (
        <Card className="max-w-2xl">
          <CardTitle>Add a record type</CardTitle>
          <CardDescription className="mb-4">
            Deleting is only possible while no records use a type; otherwise deactivate it.
          </CardDescription>
          <form action={createRecordType} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name" htmlFor="rt-name">
                <Input id="rt-name" name="name" required maxLength={120} placeholder="e.g. Case" />
              </Field>
              <Field label="Reference prefix (optional)" htmlFor="rt-prefix">
                <Input id="rt-prefix" name="referencePrefix" maxLength={20} placeholder="e.g. CASE" />
              </Field>
              <Field label="Description (optional)" htmlFor="rt-desc" className="md:col-span-2">
                <Input id="rt-desc" name="description" maxLength={500} />
              </Field>
            </div>
            <div>
              <Button type="submit">Add record type</Button>
            </div>
          </form>
        </Card>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Your role ({user.role}) can view configuration but not change it.
        </p>
      )}
    </>
  );
}
