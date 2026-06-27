import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

/** Records list. Phase 2 replaces this with a TanStack Table backed by
 *  server-side filtering/sorting/pagination and saved views. */
export default function RecordsPage() {
  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Records"
          subtitle="Your configurable matters, files, or projects."
        />
        <Button>New record</Button>
      </div>

      <Card className="mb-6 p-0">
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
            <tr>
              <td className="p-3 text-[var(--muted-foreground)]" colSpan={6}>
                Records load here once the data layer is wired (Phase 1). Run{" "}
                <code>npm run db:seed</code> to populate fictional demo data.
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <PhaseNotice phase="Records — Phases 1–2">
        CRUD with optimistic concurrency arrives in Phase 1; rich
        table/search/filter/saved-views in Phase 2.
      </PhaseNotice>
    </>
  );
}
