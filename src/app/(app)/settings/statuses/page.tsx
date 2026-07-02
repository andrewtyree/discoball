import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { ConfigBanner } from "@/components/config-banner";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createStatus, deleteStatus, setDefaultStatus } from "@/lib/config/actions";
import { listStatuses } from "@/lib/config/queries";

const CATEGORY_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  CLOSED: "Closed",
};

/** Status editor: user-defined workflow states with open/closed classes. */
export default async function StatusesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const [statuses, sp] = await Promise.all([listStatuses(user.orgId), searchParams]);
  const canConfig = can(user.role, "config:write");

  return (
    <>
      <PageHeader
        title="Statuses"
        subtitle="Workflow states are data — the “closed” category is what drives active/closed filtering."
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
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Category</th>
              <th className="p-3 font-medium">Records</th>
              <th className="p-3 font-medium">Default</th>
              {canConfig ? <th className="p-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {statuses.length === 0 ? (
              <tr>
                <td className="p-3 text-[var(--muted-foreground)]" colSpan={5}>
                  No statuses yet — add the first one below.
                </td>
              </tr>
            ) : (
              statuses.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </span>
                  </td>
                  <td className="p-3">{CATEGORY_LABELS[s.category] ?? s.category}</td>
                  <td className="p-3">{s.recordCount}</td>
                  <td className="p-3">
                    {s.isDefault ? (
                      "Default"
                    ) : canConfig ? (
                      <form action={setDefaultStatus}>
                        <input type="hidden" name="id" value={s.id} />
                        <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                          Make default
                        </Button>
                      </form>
                    ) : (
                      "—"
                    )}
                  </td>
                  {canConfig ? (
                    <td className="p-3 text-right">
                      {s.recordCount === 0 ? (
                        <form action={deleteStatus}>
                          <input type="hidden" name="id" value={s.id} />
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
          <CardTitle>Add a status</CardTitle>
          <CardDescription className="mb-4">
            The first status becomes the default for new records automatically.
          </CardDescription>
          <form action={createStatus} className="flex flex-wrap items-end gap-4">
            <Field label="Name" htmlFor="st-name">
              <Input id="st-name" name="name" required maxLength={120} placeholder="e.g. In review" />
            </Field>
            <Field label="Category" htmlFor="st-category">
              <Select id="st-category" name="category" required defaultValue="OPEN">
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Color" htmlFor="st-color">
              <Input
                id="st-color"
                name="color"
                type="color"
                defaultValue="#6366f1"
                className="h-9 w-16 p-1"
              />
            </Field>
            <Button type="submit">Add status</Button>
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
