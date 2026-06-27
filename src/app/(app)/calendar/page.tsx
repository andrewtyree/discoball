import { Card } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

/** Calendar + workload. Phase 4 mounts FullCalendar and the per-assignee daily
 *  workload heatmap (aggregation already implemented in
 *  src/lib/calendar/workload.ts). */
export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Every deadline in one place — and a heads-up before heavy days."
      />
      <Card className="mb-6 grid h-72 place-items-center text-[var(--muted-foreground)]">
        Calendar mounts here (FullCalendar) in Phase 4.
      </Card>
      <PhaseNotice phase="Calendar &amp; workload — Phase 4">
        The workload aggregation that flags heavy/overloaded days is implemented
        and unit-tested; the interactive month/week/day calendar and
        drag-to-reschedule land in Phase 4.
      </PhaseNotice>
    </>
  );
}
