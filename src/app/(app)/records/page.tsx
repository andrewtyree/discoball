import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { RecordsTable } from "@/components/records-table";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { recordFilterFromSearchParams } from "@/lib/records/filters";
import { getRecordFormOptions, listRecords } from "@/lib/records/queries";

/** Records list — server-side sorted/filtered/paginated TanStack Table. */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const filter = recordFilterFromSearchParams(await searchParams);

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listRecords(user.orgId, filter),
    getRecordFormOptions(user.orgId),
  ]);
  const canWrite = can(user.role, "record:write");

  const hasActiveFilters =
    Boolean(
      filter.search ||
        filter.recordTypeId ||
        filter.statusId ||
        filter.assigneeId ||
        filter.dueFrom ||
        filter.dueTo ||
        filter.includeArchived,
    ) || filter.state !== "active";

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

      {total === 0 && !hasActiveFilters ? (
        <Card className="py-12 text-center">
          <CardTitle className="text-base">No records yet</CardTitle>
          <CardDescription className="mx-auto max-w-md">
            Records are your configurable matters, files, or projects.
            {canWrite ? (
              <>
                {" "}
                <Link href="/records/new" className="underline">
                  Create the first one
                </Link>{" "}
                to get started.
              </>
            ) : (
              <> Ask an editor in your organization to create the first one.</>
            )}
          </CardDescription>
        </Card>
      ) : (
        <RecordsTable
          rows={rows}
          total={total}
          page={page}
          pageCount={pageCount}
          filter={filter}
          options={options}
        />
      )}
    </>
  );
}
