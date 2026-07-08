import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/phase-notice";
import { RecordsTable } from "@/components/records-table";
import { SavedViewsMenu, type SavedViewItem } from "@/components/saved-views-menu";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import {
  recordFilterFromSearchParams,
  recordFilterToSearchParams,
} from "@/lib/records/filters";
import {
  getRecordFormOptions,
  listRecords,
  listSavedViews,
} from "@/lib/records/queries";

/** Re-normalize stored view params so equality against the current URL works. */
function normalizeParams(raw: Record<string, unknown>): string {
  const asStrings = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, String(v)]),
  );
  const filter = recordFilterFromSearchParams(asStrings);
  filter.page = 1;
  return recordFilterToSearchParams(filter).toString();
}

async function savedViewItems(user: SessionUser): Promise<SavedViewItem[]> {
  const views = await listSavedViews(user.orgId, user.id);
  return views.map((v) => ({
    id: v.id,
    name: v.name,
    isShared: v.isShared,
    params: normalizeParams(v.filter),
    canDelete: v.userId === user.id || (v.isShared && can(user.role, "config:write")),
  }));
}

/** Records list — server-side sorted/filtered/paginated TanStack Table. */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const filter = recordFilterFromSearchParams(await searchParams);

  const [{ rows, total, page, pageCount }, options, views] = await Promise.all([
    listRecords(user.orgId, filter),
    getRecordFormOptions(user.orgId),
    savedViewItems(user),
  ]);
  const canWrite = can(user.role, "record:write");
  const currentParams = recordFilterToSearchParams({ ...filter, page: 1 }).toString();
  const exportQuery = currentParams ? `${currentParams}&` : "";

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
        <div className="flex items-center gap-2">
          <a
            href={`/api/records/export?${exportQuery}format=csv`}
            className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Export CSV
          </a>
          <a
            href={`/api/records/export?${exportQuery}format=json`}
            className="inline-flex items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          >
            Export JSON
          </a>
          {canWrite ? (
            <Link
              href="/records/new"
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
            >
              New record
            </Link>
          ) : null}
        </div>
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
        <>
          <SavedViewsMenu
            views={views}
            currentParams={currentParams}
            canShare={canWrite}
          />
          <RecordsTable
            rows={rows}
            total={total}
            page={page}
            pageCount={pageCount}
            filter={filter}
            options={options}
          />
        </>
      )}
    </>
  );
}
