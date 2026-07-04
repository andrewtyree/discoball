import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { EventPanel } from "@/components/calendar-event-panel";
import { CalendarView, type CalendarViewEvent, type CalendarViewName } from "@/components/calendar-view";
import { PageHeader } from "@/components/phase-notice";
import { getSessionUser } from "@/lib/auth";
import { monthGridRange, toWorkloadEvents, type DateWindow } from "@/lib/calendar/items";
import {
  getEvent,
  getRecordOption,
  getUserOption,
  listCalendarItems,
  listOrgMembers,
  listRecordOptions,
} from "@/lib/calendar/queries";
import { heavyDays, summarizeWorkload, type LoadLevel } from "@/lib/calendar/workload";
import { can } from "@/lib/rbac";
import { cn, ymd } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* URL state                                                                   */
/* -------------------------------------------------------------------------- */

const VIEWS = ["month", "week", "day"] as const;

interface CalState {
  view: CalendarViewName;
  date: string; // yyyy-mm-dd anchor
  assignee: string; // "all" | "me" | member uuid
  done: boolean;
}

/** Serialize calendar state to an href; `event` opens/keeps the panel. */
function calHref(state: CalState, overrides: Partial<CalState> = {}, event?: string): string {
  const s = { ...state, ...overrides };
  const params = new URLSearchParams();
  params.set("view", s.view);
  params.set("date", s.date);
  if (s.assignee !== "all") params.set("assignee", s.assignee);
  if (s.done) params.set("done", "1");
  if (event) params.set("event", event);
  return `/calendar?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* Date math (UTC, matching the app's `ymd` convention)                        */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseAnchor(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && ymd(d) === value) return d;
  }
  return todayUtc();
}

/** The visible window for a view: month = full weeks around the month. */
function viewWindow(view: CalendarViewName, anchor: Date): DateWindow {
  if (view === "month") {
    return monthGridRange(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1);
  }
  if (view === "week") {
    const from = addDays(anchor, -anchor.getUTCDay());
    return { from, to: addDays(from, 7) };
  }
  return { from: anchor, to: addDays(anchor, 1) };
}

/** Prev/next anchor for the toolbar arrows. */
function shiftAnchor(view: CalendarViewName, anchor: Date, dir: 1 | -1): Date {
  if (view === "month") {
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + dir, 1));
  }
  return addDays(anchor, (view === "week" ? 7 : 1) * dir);
}

const MONTH_LABEL = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function rangeLabel(view: CalendarViewName, anchor: Date, window: DateWindow): string {
  if (view === "month") return MONTH_LABEL.format(anchor);
  if (view === "week") return `${ymd(window.from)} – ${ymd(addDays(window.to, -1))}`;
  return ymd(anchor);
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That change wasn’t valid — check the fields and try again.",
  notfound: "That event no longer exists.",
};

const LOAD_LEVELS: { level: LoadLevel; label: string }[] = [
  { level: "light", label: "Light (≤ 50% of capacity)" },
  { level: "moderate", label: "Moderate (≤ 85%)" },
  { level: "heavy", label: "Heavy (≤ 100%)" },
  { level: "overloaded", label: "Overloaded (> 100%)" },
];

/** Calendar & workload: events + record due dates in one FullCalendar view,
 *  day cells tinted by estimated load, heavy days called out beside it. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  const view: CalendarViewName = VIEWS.includes(str(sp.view) as CalendarViewName)
    ? (str(sp.view) as CalendarViewName)
    : "month";
  const anchor = parseAnchor(str(sp.date));
  const rawAssignee = str(sp.assignee) ?? "all";
  const assignee =
    rawAssignee === "me" || z.string().uuid().safeParse(rawAssignee).success
      ? rawAssignee
      : "all";
  const includeDone = str(sp.done) === "1";

  const state: CalState = { view, date: ymd(anchor), assignee, done: includeDone };
  const window = viewWindow(view, anchor);
  const assigneeId = assignee === "me" ? user.id : assignee === "all" ? undefined : assignee;

  const eventParam = str(sp.event);
  const panelEventId =
    eventParam && eventParam !== "new" && z.string().uuid().safeParse(eventParam).success
      ? eventParam
      : null;
  const panelOpen = eventParam === "new" || panelEventId !== null;

  const [items, members, recordOptions, panelEvent] = await Promise.all([
    listCalendarItems(user.orgId, { from: window.from, to: window.to, assigneeId, includeDone }),
    listOrgMembers(user.orgId),
    listRecordOptions(user.orgId),
    panelEventId ? getEvent(user.orgId, panelEventId) : Promise.resolve(null),
  ]);

  // The panel's selects must contain the event's CURRENT record and assignee
  // even when they fall outside the option lists (archived record, record
  // beyond the cap, removed member) — otherwise the browser silently falls
  // back to the empty first option and saving an unrelated field would
  // unlink/unassign the event.
  let panelRecords = recordOptions;
  if (panelEvent?.recordId && !recordOptions.some((r) => r.id === panelEvent.recordId)) {
    const linked = await getRecordOption(user.orgId, panelEvent.recordId);
    if (linked) {
      panelRecords = [
        {
          id: linked.id,
          reference: linked.reference,
          title: linked.isArchived ? `${linked.title} (archived)` : linked.title,
        },
        ...recordOptions,
      ];
    }
  }
  let panelMembers = members;
  if (panelEvent?.assigneeId && !members.some((m) => m.id === panelEvent.assigneeId)) {
    const assignee = await getUserOption(panelEvent.assigneeId);
    if (assignee) {
      panelMembers = [
        { ...assignee, name: `${assignee.name ?? assignee.email} (no longer a member)` },
        ...members,
      ];
    }
  }

  // Workload over the same items the calendar shows (no second DB round-trip).
  const summary = summarizeWorkload(toWorkloadEvents(items), { excludeDone: !includeDone });
  const heavy = heavyDays(summary);
  const dayLoads = Object.fromEntries(summary.map((d) => [d.date, d.level]));

  const canWrite = can(user.role, "record:write");

  const viewEvents: CalendarViewEvent[] = items.map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    start: item.start.toISOString(),
    end: item.end ? item.end.toISOString() : null,
    allDay: item.allDay,
    isDone: item.isDone,
    recordId: item.recordId,
    recordVersion: item.recordVersion,
  }));

  const okParam = str(sp.ok);
  const errorParam = str(sp.error);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <PageHeader
          title="Calendar"
          subtitle="Every deadline in one place — and a heads-up before heavy days."
        />
        {canWrite ? (
          <Link
            href={calHref(state, {}, "new")}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)]"
          >
            New event
          </Link>
        ) : null}
      </div>

      {okParam ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
        >
          Saved.
        </p>
      ) : null}
      {errorParam === "forbidden" ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          Your role ({user.role}) doesn’t have permission to do that.
        </p>
      ) : errorParam && ERROR_MESSAGES[errorParam] ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {ERROR_MESSAGES[errorParam]}
        </p>
      ) : null}

      {/* Toolbar — links and a plain GET form, all keyboard-reachable. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Calendar navigation" className="flex items-center gap-1">
          <ToolbarLink
            href={calHref(state, { date: ymd(shiftAnchor(view, anchor, -1)) })}
            ariaLabel={`Previous ${view}`}
          >
            ‹
          </ToolbarLink>
          <ToolbarLink href={calHref(state, { date: ymd(todayUtc()) })}>Today</ToolbarLink>
          <ToolbarLink
            href={calHref(state, { date: ymd(shiftAnchor(view, anchor, 1)) })}
            ariaLabel={`Next ${view}`}
          >
            ›
          </ToolbarLink>
        </nav>

        <span aria-live="polite" className="min-w-36 text-sm font-semibold">
          {rangeLabel(view, anchor, window)}
        </span>

        <nav
          aria-label="Calendar view"
          className="flex items-center rounded-[var(--radius)] border border-[var(--border)] p-0.5"
        >
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={calHref(state, { view: v })}
              aria-current={view === v ? "page" : undefined}
              className={cn(
                "rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-sm capitalize",
                view === v
                  ? "bg-[var(--muted)] font-medium"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {v}
            </Link>
          ))}
        </nav>

        <form method="get" action="/calendar" className="ml-auto flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={state.date} />
          <Field label="Assignee" htmlFor="cal-assignee">
            <Select
              id="cal-assignee"
              name="assignee"
              defaultValue={assignee}
              className="py-1.5"
            >
              <option value="all">Everyone</option>
              <option value="me">Me</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="done"
              value="1"
              defaultChecked={includeDone}
              className="size-4 accent-[var(--primary)]"
            />
            Include done
          </label>
          <Button type="submit" variant="outline" className="px-3 py-1.5 text-xs">
            Apply
          </Button>
        </form>
      </div>

      <div
        className={cn(
          "grid gap-6",
          panelOpen ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]",
        )}
      >
        <div className="min-w-0">
          <Card className="p-3">
            {items.length === 0 ? (
              <p className="px-2 pb-1 pt-2 text-sm text-[var(--muted-foreground)]" role="status">
                Nothing scheduled in this {view === "month" ? "month" : view}
                {assignee !== "all" ? " for this assignee" : ""}.
                {canWrite ? " Add the first event with “New event”." : ""}
              </p>
            ) : null}
            <CalendarView
              view={view}
              date={state.date}
              events={viewEvents}
              dayLoads={dayLoads}
              canWrite={canWrite}
            />
          </Card>

          {view === "month" ? (
            <ul aria-label="Workload legend" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
              {LOAD_LEVELS.map(({ level, label }) => (
                <li key={level} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`load-swatch load-${level} inline-block size-3 rounded-sm border border-[var(--border)]`}
                  />
                  {label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {eventParam === "new" && canWrite ? (
            <EventPanel
              event={null}
              members={panelMembers}
              records={panelRecords}
              canWrite={canWrite}
              defaultDate={state.date}
              returnTo={calHref(state, {}, "new")}
              closeTo={calHref(state)}
            />
          ) : panelEventId && panelEvent ? (
            <EventPanel
              event={panelEvent}
              members={panelMembers}
              records={panelRecords}
              canWrite={canWrite}
              defaultDate={state.date}
              returnTo={calHref(state, {}, panelEventId)}
              closeTo={calHref(state)}
            />
          ) : panelEventId && !panelEvent ? (
            <Card>
              <CardTitle>Event not found</CardTitle>
              <CardDescription className="mb-3">
                It may have been deleted, or belongs to another workspace.
              </CardDescription>
              <Link href={calHref(state)} className="text-sm underline">
                Close
              </Link>
            </Card>
          ) : null}

          <Card>
            <CardTitle>Heavy days ahead</CardTitle>
            <CardDescription className="mb-3">
              Days in this window where estimated effort nears or exceeds capacity (8h).
            </CardDescription>
            {heavy.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                No heavy or overloaded days — nice and steady.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {heavy.map((d) => (
                  <li key={d.date} className="flex items-center justify-between gap-3">
                    <Link
                      href={calHref(state, { view: "day", date: d.date })}
                      className="font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {d.date}
                    </Link>
                    <span className="text-[var(--muted-foreground)]">
                      {d.eventCount} {d.eventCount === 1 ? "item" : "items"} ·{" "}
                      {(d.totalMinutes / 60).toFixed(1)}h
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        d.level === "overloaded"
                          ? "bg-red-500/15 text-red-600"
                          : "bg-orange-500/15 text-orange-600",
                      )}
                    >
                      {d.level}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}

function ToolbarLink({
  href,
  children,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex min-w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
    >
      {children}
    </Link>
  );
}
