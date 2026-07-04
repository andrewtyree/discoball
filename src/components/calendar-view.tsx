"use client";
/**
 * The interactive calendar — FullCalendar v6 in controlled-by-the-URL mode.
 *
 * The server component owns all state (view, anchor date, filters) via search
 * params and passes down plain serializable events; this component renders
 * them and translates user gestures back into either URL changes (click →
 * ?event=…, navigate → ?date=…) or the `rescheduleItem` server action
 * (drag/resize). After a successful reschedule we `router.refresh()` so the
 * server re-reads the window; on failure we revert the drop and show an
 * inline banner — no dialogs, matching the app's plain-form conventions.
 *
 * Timezone: the app stores instants in UTC and formats dates with `ymd`
 * (UTC), so the calendar runs with timeZone="UTC" — day cells, event
 * positions, and the ISO strings FullCalendar emits (`startStr`/`endStr`)
 * all agree with the database without any client-locale drift.
 */
import { useEffect, useMemo, useRef, useState, useTransition, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import type {
  DateSpanApi,
  DatesSetArg,
  DayCellContentArg,
  EventApi,
  EventClickArg,
  EventDropArg,
} from "@fullcalendar/core";

import { rescheduleItem } from "@/lib/calendar/actions";
import {
  fromExclusiveAllDayEnd,
  stripItemId,
  toExclusiveAllDayEnd,
} from "@/lib/calendar/items";
import type { LoadLevel } from "@/lib/calendar/workload";

export type CalendarViewName = "month" | "week" | "day";

/** A CalendarItem flattened to what the client actually renders (ISO strings
 *  so the server → client boundary stays plainly serializable). */
export interface CalendarViewEvent {
  id: string;
  kind: "event" | "record-due";
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  isDone: boolean;
  recordId: string | null;
  /** records.version as loaded — submitted with a due-date drag so a stale
   *  view can't clobber a concurrent edit (null for kind "event"). */
  recordVersion: number | null;
}

const FC_VIEWS: Record<CalendarViewName, string> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  day: "timeGridDay",
};

export function CalendarView({
  view,
  date,
  events,
  dayLoads,
  canWrite,
}: {
  view: CalendarViewName;
  /** Anchor date, yyyy-mm-dd (UTC). */
  date: string;
  events: CalendarViewEvent[];
  /** yyyy-mm-dd → load level, for the month-view heatmap. */
  dayLoads: Record<string, LoadLevel>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const calendarRef = useRef<FullCalendar>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Current URL with some params changed (null deletes); outcome params from
   *  a previous action never carry over. */
  const buildUrl = useCallback(
    (overrides: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("ok");
      params.delete("error");
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [searchParams, pathname],
  );

  /* The URL is the source of truth: when the server re-renders with a new
   * view/date (toolbar links), steer the already-mounted calendar to match. */
  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const fcView = FC_VIEWS[view];
    if (api.view.type !== fcView) {
      api.changeView(fcView, date);
      return;
    }
    const target = new Date(`${date}T00:00:00Z`);
    if (target < api.view.currentStart || target >= api.view.currentEnd) {
      api.gotoDate(date);
    }
  }, [view, date]);

  /* If the calendar ever navigates itself, reflect it back into ?date — but
   * only when the anchor actually left the visible range, so the mount /
   * changeView datesSet events don't ping-pong with the effect above. */
  const handleDatesSet = (arg: DatesSetArg) => {
    const anchor = new Date(`${date}T00:00:00Z`);
    if (anchor >= arg.view.currentStart && anchor < arg.view.currentEnd) return;
    const next = arg.view.currentStart.toISOString().slice(0, 10);
    if (next !== date) router.push(buildUrl({ date: next }));
  };

  const handleEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    const kind = arg.event.extendedProps.kind as CalendarViewEvent["kind"];
    if (kind === "record-due") {
      const recordId = arg.event.extendedProps.recordId as string | null;
      if (recordId) router.push(`/records/${recordId}`);
      return;
    }
    router.push(buildUrl({ event: stripItemId(arg.event.id) }));
  };

  /** Persist a drag/resize via the reschedule action; revert the visual move
   *  if the server says no (RBAC, archived record, or a lost version race). */
  const applyReschedule = (event: EventApi, revert: () => void, includeEnd: boolean) => {
    const formData = new FormData();
    formData.set("kind", String(event.extendedProps.kind));
    formData.set("id", event.id);
    formData.set("newStart", event.startStr);
    // Drops omit the end so the server preserves the stored duration; resizes
    // (timed views only) send the new end explicitly. FullCalendar emits an
    // EXCLUSIVE all-day end, while the app stores the inclusive last covered
    // day — convert back at this boundary (inverse of the fcEvents mapping).
    if (includeEnd && event.endStr) {
      formData.set(
        "newEnd",
        event.allDay && event.end && event.start
          ? fromExclusiveAllDayEnd(event.end, event.start).toISOString()
          : event.endStr,
      );
    }
    // Due-date drags submit the version the calendar loaded, so the server
    // rejects a drag based on a stale view (records/concurrency.ts pattern).
    const recordVersion = event.extendedProps.recordVersion as number | null;
    if (event.extendedProps.kind === "record-due" && recordVersion !== null) {
      formData.set("expectedVersion", String(recordVersion));
    }
    setDropError(null);
    startTransition(async () => {
      try {
        const result = await rescheduleItem(formData);
        if ("error" in result) {
          setDropError(result.error);
          revert();
        } else {
          router.refresh();
        }
      } catch {
        setDropError("Couldn't save the new time — please try again.");
        revert();
      }
    });
  };

  const handleEventDrop = (info: EventDropArg) =>
    applyReschedule(info.event, info.revert, false);
  const handleEventResize = (info: EventResizeDoneArg) =>
    applyReschedule(info.event, info.revert, true);

  const dayCellClassNames = useCallback(
    (arg: DayCellContentArg) => {
      const level = dayLoads[arg.date.toISOString().slice(0, 10)];
      return level ? [`load-${level}`] : [];
    },
    [dayLoads],
  );

  /** All-day and timed lanes must not swap on drag: the reschedule action only
   *  moves times, so a cross-lane drop would silently revert on refresh (and a
   *  timed event dropped in the all-day row would lose its time-of-day). */
  const eventAllow = useCallback(
    (span: DateSpanApi, movingEvent: EventApi | null) =>
      movingEvent === null || span.allDay === movingEvent.allDay,
    [],
  );

  const fcEvents = useMemo(
    () =>
      events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.start,
        // The app stores an all-day end as the inclusive last covered day;
        // FullCalendar wants it exclusive — convert at this boundary so the
        // grid paints the same days the panel says the event covers.
        end: e.end
          ? e.allDay
            ? toExclusiveAllDayEnd(new Date(e.end)).toISOString()
            : e.end
          : undefined,
        allDay: e.allDay,
        // Due-date chips are instants — resizing one to a span would be a
        // silent no-op, so don't offer the handle.
        ...(e.kind === "record-due" ? { durationEditable: false } : {}),
        classNames: [
          e.kind === "record-due" ? "cal-item-deadline" : "cal-item-event",
          ...(e.isDone ? ["cal-item-done"] : []),
        ],
        extendedProps: { kind: e.kind, recordId: e.recordId, recordVersion: e.recordVersion },
      })),
    [events],
  );

  return (
    <div className="calendar-shell">
      {dropError ? (
        <div
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          <span>{dropError}</span>
          <button
            type="button"
            onClick={() => setDropError(null)}
            className="shrink-0 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <FullCalendar
        ref={calendarRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={FC_VIEWS[view]}
        initialDate={date}
        timeZone="UTC"
        headerToolbar={false}
        // Month sizes to its rows; timed views would render all 24h without a
        // viewport cap, so give them a scrolling window opened at working hours.
        height={view === "month" ? "auto" : "72vh"}
        // The grid must show exactly the weeks the server fetched
        // (monthGridRange) — a fixed 6-row month would display trailing weeks
        // whose events were never loaded.
        fixedWeekCount={false}
        scrollTime="08:00:00"
        events={fcEvents}
        editable={canWrite}
        eventStartEditable={canWrite}
        // Resizing is a timed-view affordance; month-view drags only move.
        eventDurationEditable={canWrite && view !== "month"}
        eventResizableFromStart={false}
        eventAllow={eventAllow}
        dayMaxEventRows={4}
        nowIndicator
        eventDisplay="block"
        displayEventEnd={view !== "month"}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        dayCellClassNames={view === "month" ? dayCellClassNames : undefined}
        datesSet={handleDatesSet}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventResize={handleEventResize}
      />
    </div>
  );
}
