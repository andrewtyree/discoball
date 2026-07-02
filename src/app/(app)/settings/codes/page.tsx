import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { ConfigBanner } from "@/components/config-banner";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createCode, deleteCode, toggleCodeActive } from "@/lib/config/actions";
import { listCodes } from "@/lib/config/queries";

/** Codes editor: the org's controlled vocabulary for labeling records. */
export default async function CodesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [codes, sp] = await Promise.all([listCodes(user.orgId), searchParams]);
  const canConfig = can(user.role, "config:write");

  return (
    <>
      <PageHeader
        title="Codes"
        subtitle="A controlled vocabulary for labeling records — apply them on a record’s Codes tab."
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
              <th className="p-3 font-medium">Code</th>
              <th className="p-3 font-medium">Label</th>
              <th className="p-3 font-medium">Group</th>
              <th className="p-3 font-medium">Description</th>
              <th className="p-3 font-medium">Records</th>
              <th className="p-3 font-medium">Active</th>
              {canConfig ? <th className="p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 ? (
              <tr>
                <td className="p-3 text-[var(--muted-foreground)]" colSpan={7}>
                  No codes yet — add the first one below.
                </td>
              </tr>
            ) : (
              codes.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-mono text-xs">{c.code}</td>
                  <td className="p-3 font-medium">{c.shortLabel}</td>
                  <td className="p-3">{c.groupName ?? "—"}</td>
                  <td className="max-w-64 p-3 text-[var(--muted-foreground)]">
                    {c.description ?? "—"}
                  </td>
                  <td className="p-3">{c.recordCount}</td>
                  <td className="p-3">
                    {canConfig ? (
                      <form action={toggleCodeActive}>
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
                  {canConfig ? (
                    <td className="p-3 text-right">
                      {c.recordCount === 0 ? (
                        <form action={deleteCode}>
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
      </Card>

      {canConfig ? (
        <Card className="max-w-2xl">
          <CardTitle>Add a code</CardTitle>
          <CardDescription className="mb-4">
            Codes in use can be deactivated (hidden from pickers) but not deleted.
          </CardDescription>
          <form action={createCode} className="grid gap-4 md:grid-cols-2">
            <Field label="Code" htmlFor="code-code">
              <Input id="code-code" name="code" required maxLength={50} placeholder="e.g. URG" />
            </Field>
            <Field label="Short label" htmlFor="code-label">
              <Input
                id="code-label"
                name="shortLabel"
                required
                maxLength={120}
                placeholder="e.g. Urgent"
              />
            </Field>
            <Field label="Group (optional)" htmlFor="code-group">
              <Input
                id="code-group"
                name="groupName"
                maxLength={80}
                placeholder="e.g. Priority"
              />
            </Field>
            <Field label="Description (optional)" htmlFor="code-desc">
              <Input id="code-desc" name="description" maxLength={500} />
            </Field>
            <div>
              <Button type="submit">Add code</Button>
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
