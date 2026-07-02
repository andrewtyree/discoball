import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { parseRecordFilter } from "@/lib/records/filters";
import { listRecords, RECORDS_PAGE_SIZE } from "@/lib/records/queries";
import { ymd } from "@/lib/utils";

const STATES = ["active", "closed", "all"] as const;

/** Records list — real, filtered, org-scoped data. Phase 2 upgrades this to a
 *  TanStack Table with server-side sort/pagination and saved views. */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; state?: string; archived?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const sp = await searchParams;
  const filter = parseRecordFilter({
    search: sp.search?.trim() || undefined,
    state: STATES.includes(sp.state as (typeof STATES)[number]) ? sp.state : undefined,
    includeArchived: sp.archived === "1",
  });

  const { rows, total } = await listRecords(user.orgId, filter);
  const canWrite = can(user.role, "record:write");

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Records"
          subtitle="Your configurable matters, files, or projects."
        />
        {canWrite ? (
          <Link
            href="/records/new"
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            New record
          </Link>
        ) : null}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          name="search"
          placeholder="Search reference, title, subject…"
          defaultValue={sp.search ?? ""}
          className="w-64"
          aria-label="Search records"
        />
        <Select name="state" defaultValue={filter.state} aria-label="Open or closed">
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="all">All states</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          <input type="checkbox" name="archived" value="1" defaultChecked={filter.includeArchived} />
          Include archived
        </label>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <Card className="mb-2 p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
            <tr>
              <th className="p-3 font-medium">Reference</th>
              <th className="p-3 font-medium">Title</th>
              <th className="p-3 font-medium">Type</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Assignee</th>
              <th className="p-3 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-[var(--muted-foreground)]" colSpan={6}>
                  No records match this filter.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="p-3 font-mono text-xs">{r.reference ?? "—"}</td>
                  <td className="p-3">
                    <Link href={`/records/${r.id}`} className="font-medium hover:underline">
                      {r.title}
                    </Link>
                    {r.isArchived ? (
                      <span className="ml-2 rounded bg-[var(--muted)] px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">
                        archived
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3">{r.typeName ?? "—"}</td>
                  <td className="p-3">
                    {r.statusName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block size-2 rounded-full"
                          style={{ backgroundColor: r.statusColor ?? undefined }}
                        />
                        {r.statusName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">{r.assigneeName ?? r.assigneeEmail ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{r.dueDate ? ymd(r.dueDate) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <p className="mb-6 text-xs text-[var(--muted-foreground)]">
        Showing {rows.length} of {total}
        {total > RECORDS_PAGE_SIZE ? " — pagination arrives with the Phase 2 table." : "."}
      </p>

      <PhaseNotice phase="Records — Phase 2">
        Rich table with server-side sorting/pagination, saved views, and custom
        fields in the list are next.
      </PhaseNotice>
    </>
  );
}
