import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { PageHeader, PhaseNotice } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { listCalendarItems } from "@/lib/calendar/queries";
import { ymd } from "@/lib/utils";

const STATS = [
  { label: "Open records", hint: "Active matters assigned across the team" },
  { label: "Due this week", hint: "Deadlines surfacing on the calendar" },
  { label: "Awaiting documents", hint: "Records with outstanding deliverables" },
  { label: "Generated this month", hint: "Documents produced from templates" },
];

const UPCOMING_LIMIT = 6;

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + 7 * 86_400_000);
  // Fetch one row beyond what we render — enough to know whether to point at
  // the calendar for more, without pulling the whole week's items.
  const upcoming = await listCalendarItems(user.orgId, {
    from,
    to,
    limit: UPCOMING_LIMIT + 1,
  });

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

      <Card className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Upcoming deadlines — next 7 days</CardTitle>
          <Link href="/calendar" className="text-sm underline">
            Open calendar
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <CardDescription>
            Nothing due in the next week. Deadlines and events land here as they
            approach.
          </CardDescription>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {upcoming.slice(0, UPCOMING_LIMIT).map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--muted-foreground)]">
                  {ymd(item.start)}
                </span>
                {item.kind === "record-due" && item.recordId ? (
                  <Link href={`/records/${item.recordId}`} className="truncate hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  <Link
                    href={`/calendar?view=day&date=${ymd(item.start)}`}
                    className="truncate hover:underline"
                  >
                    {item.title}
                  </Link>
                )}
                <span className="ml-auto shrink-0 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                  {item.kind === "record-due" ? "record due" : item.type.toLowerCase()}
                </span>
              </li>
            ))}
            {upcoming.length > UPCOMING_LIMIT ? (
              <li className="text-xs text-[var(--muted-foreground)]">
                …and more on the{" "}
                <Link href="/calendar" className="underline">
                  calendar
                </Link>
                .
              </li>
            ) : null}
          </ul>
        )}
      </Card>

      <PhaseNotice phase="Dashboard — Phase 2">
        Live metrics and a recent-activity feed (sourced from the audit log) land
        in Phase 2. The cards above are placeholders. See ROADMAP.md.
      </PhaseNotice>
    </>
  );
}
