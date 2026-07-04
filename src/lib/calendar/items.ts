/**
 * Calendar items — the pure core of the calendar feature.
 *
 * A `CalendarItem` is the unified shape the calendar page renders: real rows
 * from the `events` table plus "virtual" deadline items derived from
 * `records.dueDate`. Everything in this module is a pure function (no db, no
 * session) so the mapping, date-window math, and reschedule arithmetic are
 * unit-testable without a database (see tests/calendar-items.test.ts).
 */
import type { WorkloadEvent } from "./workload";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type CalendarItemKind = "event" | "record-due";

export type CalendarItemType = "DEADLINE" | "APPOINTMENT" | "TASK" | "REMINDER";

/** One entry on the calendar — a real event or a record's due date. */
export interface CalendarItem {
  /** Namespaced id: `event:<uuid>` for events, `record:<uuid>` for due dates. */
  id: string;
  kind: CalendarItemKind;
  /** Record due dates render as "REF — title" (just the title without a ref). */
  title: string;
  /** Record due dates are always DEADLINE. */
  type: CalendarItemType;
  start: Date;
  end: Date | null;
  allDay: boolean;
  assigneeId: string | null;
  /** Assignee display name (falls back to email), when assigned. */
  assigneeName: string | null;
  /** Estimated effort in minutes; null counts toward event totals only. */
  estimatedMinutes: number | null;
  isDone: boolean;
  /** The linked record (always set for kind "record-due"). */
  recordId: string | null;
  /** Reference/title of the linked record, when recordId is set. */
  recordReference: string | null;
  recordTitle: string | null;
  /** The record's optimistic-concurrency version — set for kind "record-due"
   *  so a drag-reschedule can submit the version it loaded (the same
   *  convention as record edit forms — see src/lib/records/concurrency.ts). */
  recordVersion: number | null;
  notes: string | null;
}

/* -------------------------------------------------------------------------- */
/* Ids & titles                                                                */
/* -------------------------------------------------------------------------- */

/** Namespace a raw row id into a CalendarItem id. */
export function calendarItemId(kind: CalendarItemKind, rawId: string): string {
  return kind === "record-due" ? `record:${rawId}` : `event:${rawId}`;
}

/** Strip the `event:`/`record:` namespace off a CalendarItem id (a bare id
 *  passes through unchanged, so callers can accept either form). */
export function stripItemId(id: string): string {
  return id.replace(/^(?:event|record):/, "");
}

/** Display title for a record's due-date item: "REF — title". */
export function recordDueTitle(reference: string | null, title: string): string {
  return reference ? `${reference} — ${title}` : title;
}

/* -------------------------------------------------------------------------- */
/* Workload mapping                                                            */
/* -------------------------------------------------------------------------- */

/** Map calendar items to the shape `summarizeWorkload` consumes. Items without
 *  an estimate (e.g. record due dates) contribute to the day's event count but
 *  not its minutes — workload.ts already treats null minutes as 0. */
export function toWorkloadEvents(items: CalendarItem[]): WorkloadEvent[] {
  return items.map((item) => ({
    startAt: item.start,
    estimatedMinutes: item.estimatedMinutes,
    assigneeId: item.assigneeId,
    isDone: item.isDone,
  }));
}

/* -------------------------------------------------------------------------- */
/* Date windows                                                                */
/* -------------------------------------------------------------------------- */

/** A half-open UTC window: `from` inclusive, `to` exclusive. */
export interface DateWindow {
  from: Date;
  to: Date;
}

/**
 * The full grid window a month view displays: the month itself plus the
 * leading/trailing days that pad it to whole weeks. UTC throughout (the app's
 * date convention — see `ymd`). `month` is 1-12; `weekStartsOn` is 0=Sunday
 * (FullCalendar's default) through 6.
 */
export function monthGridRange(
  year: number,
  month: number,
  weekStartsOn = 0,
): DateWindow {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const lead = (firstOfMonth.getUTCDay() - weekStartsOn + 7) % 7;
  const from = new Date(Date.UTC(year, month - 1, 1 - lead));

  const firstOfNext = new Date(Date.UTC(year, month, 1));
  const trail = (weekStartsOn - firstOfNext.getUTCDay() + 7) % 7;
  const to = new Date(Date.UTC(year, month, 1 + trail));

  return { from, to };
}

/** Parse a `yyyy-mm` query param into { year, month } (month 1-12), or null. */
export function parseMonth(value: string | null | undefined): { year: number; month: number } | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return { year, month };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * Combine a `<input type="date">` value and an optional `<input type="time">`
 * value into a UTC Date (the app stores instants in UTC and displays with
 * `ymd`). Returns null for missing/invalid input, including impossible
 * calendar dates like 2026-02-30.
 */
export function combineDateTime(date: string, time?: string | null): Date | null {
  if (!DATE_RE.test(date)) return null;
  const t = typeof time === "string" && time.trim() !== "" ? time.trim() : "00:00";
  if (!TIME_RE.test(t)) return null;
  const combined = new Date(`${date}T${t}:00.000Z`);
  if (Number.isNaN(combined.getTime())) return null;
  // Date.parse rolls impossible days over (2026-02-30 → March 2); requiring
  // the calendar date to round-trip rejects them.
  return combined.toISOString().slice(0, 10) === date ? combined : null;
}

/* -------------------------------------------------------------------------- */
/* All-day end conversion                                                      */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * The app stores an all-day event's end as the INCLUSIVE last covered day
 * (exactly what the form's "End date" says), while FullCalendar treats an
 * all-day end as EXCLUSIVE. These convert at that boundary so the grid and
 * the panel agree on which days an event covers.
 */
export function toExclusiveAllDayEnd(end: Date): Date {
  return new Date(end.getTime() + DAY_MS);
}

/** Inverse of `toExclusiveAllDayEnd`, clamped so a single-day span (exclusive
 *  end = start + 1 day) round-trips to an inclusive end equal to the start. */
export function fromExclusiveAllDayEnd(end: Date, start: Date): Date {
  const inclusive = new Date(end.getTime() - DAY_MS);
  return inclusive.getTime() < start.getTime() ? start : inclusive;
}

/* -------------------------------------------------------------------------- */
/* Rescheduling                                                                */
/* -------------------------------------------------------------------------- */

/**
 * New start/end for a dragged event. An explicit `newEnd` wins; otherwise an
 * existing end shifts with the start, preserving the event's duration; an
 * event without an end stays open-ended.
 */
export function shiftItemTimes(
  current: { startAt: Date; endAt: Date | null },
  newStart: Date,
  newEnd?: Date | null,
): { startAt: Date; endAt: Date | null } {
  if (newEnd) return { startAt: newStart, endAt: newEnd };
  if (!current.endAt) return { startAt: newStart, endAt: null };
  const duration = current.endAt.getTime() - current.startAt.getTime();
  return { startAt: newStart, endAt: new Date(newStart.getTime() + duration) };
}
