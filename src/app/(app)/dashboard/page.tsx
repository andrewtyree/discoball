import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";

const STATS = [
  { label: "Open records", hint: "Active matters assigned across the team" },
  { label: "Due this week", hint: "Deadlines surfacing on the calendar" },
  { label: "Awaiting documents", hint: "Records with outstanding deliverables" },
  { label: "Generated this month", hint: "Documents produced from templates" },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="At-a-glance workload and recent activity."
      />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {STATS.map((s) => (
          <Card key={s.label}>
            <div className="text-3xl font-bold">—</div>
            <CardTitle className="mt-2">{s.label}</CardTitle>
            <CardDescription>{s.hint}</CardDescription>
          </Card>
        ))}
      </div>
      <PhaseNotice phase="Dashboard — Phase 2">
        Live metrics and a recent-activity feed (sourced from the audit log) land
        in Phase 2. The cards above are placeholders. See ROADMAP.md.
      </PhaseNotice>
    </>
  );
}
