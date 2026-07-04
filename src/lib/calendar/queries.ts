/**
 * Calendar queries — org-scoped reads for the calendar & workload screens.
 *
 * Same discipline as src/lib/records/queries.ts: every query takes the
 * caller's `orgId` (from the session) and scopes rows to it. The list query is
 * range-bounded on both sources — events overlap-test against the window
 * (upper-bounded on (org_id, start_at) via `events_org_start_idx`; the lower
 * bound is on the effective end so multi-day events spanning the window start
 * still match), record due dates on (org_id, due_date) via
 * `records_org_due_idx` — so a month view never scans the whole table.
 */
import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";

import { db, schema } from "@/db";
import type { CalendarEvent } from "@/db/schema";
import {
  calendarItemId,
  recordDueTitle,
  toWorkloadEvents,
  type CalendarItem,
} from "./items";
import { heavyDays, summarizeWorkload, type DayWorkload } from "./workload";

/* -------------------------------------------------------------------------- */
/* Unified calendar items                                                      */
/* -------------------------------------------------------------------------- */

export interface CalendarItemsFilter {
  /** Window start, inclusive. */
  from: Date;
  /** Window end, exclusive. */
  to: Date;
  /** Only items assigned to this user. */
  assigneeId?: string | null;
  /** Include events already marked done (default false). */
  includeDone?: boolean;
  /** Cap the result (applied per source in SQL and to the merged list), for
   *  callers like the dashboard that only render the first few items. */
  limit?: number;
}

/**
 * Everything the calendar shows in [from, to): real `events` rows plus
 * non-archived records with a due date in range as virtual DEADLINE items.
 * Sorted by start time (ties by title) so agendas render stably.
 */
export async function listCalendarItems(
  orgId: string,
  filter: CalendarItemsFilter,
): Promise<CalendarItem[]> {
  const { from, to, assigneeId, includeDone = false, limit } = filter;

  const eventConds = [
    eq(schema.events.orgId, orgId),
    lt(schema.events.startAt, to),
    // Overlap, not start-in-window: a multi-day event that starts before the
    // window but ends inside it must still show up. `gte` on the end (i.e.
    // coalesce(endAt, startAt) >= from) keeps all-day events — whose stored
    // end is the INCLUSIVE last covered day — visible in a window starting on
    // that day; point events (null endAt) fall back to start-in-window.
    or(
      gte(schema.events.endAt, from),
      and(isNull(schema.events.endAt), gte(schema.events.startAt, from)),
    ),
  ];
  if (assigneeId) eventConds.push(eq(schema.events.assigneeId, assigneeId));
  if (!includeDone) eventConds.push(eq(schema.events.isDone, false));

  const recordConds = [
    eq(schema.records.orgId, orgId),
    eq(schema.records.isArchived, false),
    gte(schema.records.dueDate, from),
    lt(schema.records.dueDate, to),
  ];
  if (assigneeId) recordConds.push(eq(schema.records.assigneeId, assigneeId));

  const eventQuery = db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      type: schema.events.type,
      startAt: schema.events.startAt,
      endAt: schema.events.endAt,
      allDay: schema.events.allDay,
      assigneeId: schema.events.assigneeId,
      estimatedMinutes: schema.events.estimatedMinutes,
      isDone: schema.events.isDone,
      recordId: schema.events.recordId,
      notes: schema.events.notes,
      assigneeName: schema.users.name,
      assigneeEmail: schema.users.email,
      recordReference: schema.records.reference,
      recordTitle: schema.records.title,
    })
    .from(schema.events)
    .leftJoin(schema.users, eq(schema.events.assigneeId, schema.users.id))
    // Org-scoped join: a forged cross-org recordId must not leak a title.
    .leftJoin(
      schema.records,
      and(eq(schema.events.recordId, schema.records.id), eq(schema.records.orgId, orgId)),
    )
    .where(and(...eventConds))
    .orderBy(asc(schema.events.startAt));
  const recordQuery = db
    .select({
      id: schema.records.id,
      reference: schema.records.reference,
      title: schema.records.title,
      dueDate: schema.records.dueDate,
      assigneeId: schema.records.assigneeId,
      version: schema.records.version,
      assigneeName: schema.users.name,
      assigneeEmail: schema.users.email,
    })
    .from(schema.records)
    .leftJoin(schema.users, eq(schema.records.assigneeId, schema.users.id))
    .where(and(...recordConds))
    .orderBy(asc(schema.records.dueDate));

  // A cap keeps the fetch bounded for callers that render a handful of rows;
  // fetching `limit` per source guarantees the merged top-`limit` is complete.
  const [eventRows, recordRows] = await Promise.all([
    limit ? eventQuery.limit(limit) : eventQuery,
    limit ? recordQuery.limit(limit) : recordQuery,
  ]);

  const items: CalendarItem[] = [
    ...eventRows.map(
      (row): CalendarItem => ({
        id: calendarItemId("event", row.id),
        kind: "event",
        title: row.title,
        type: row.type,
        start: row.startAt,
        end: row.endAt,
        allDay: row.allDay,
        assigneeId: row.assigneeId,
        assigneeName: row.assigneeId ? (row.assigneeName ?? row.assigneeEmail) : null,
        estimatedMinutes: row.estimatedMinutes,
        isDone: row.isDone,
        recordId: row.recordId,
        recordReference: row.recordReference,
        recordTitle: row.recordTitle,
        recordVersion: null,
        notes: row.notes,
      }),
    ),
    ...recordRows.map(
      (row): CalendarItem => ({
        id: calendarItemId("record-due", row.id),
        kind: "record-due",
        title: recordDueTitle(row.reference, row.title),
        type: "DEADLINE",
        // The WHERE clause guarantees dueDate is non-null in range.
        start: row.dueDate as Date,
        end: null,
        allDay: true,
        assigneeId: row.assigneeId,
        assigneeName: row.assigneeId ? (row.assigneeName ?? row.assigneeEmail) : null,
        estimatedMinutes: null,
        isDone: false,
        recordId: row.id,
        recordReference: row.reference,
        recordTitle: row.title,
        recordVersion: row.version,
        notes: null,
      }),
    ),
  ];

  items.sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title),
  );
  return limit ? items.slice(0, limit) : items;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

/** Members of the org, for the assignee filter and event forms. Same shape as
 *  the members list in getRecordFormOptions (no standalone helper existed). */
export async function listOrgMembers(orgId: string) {
  return db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, orgId))
    .orderBy(asc(schema.users.name));
}

export type OrgMember = Awaited<ReturnType<typeof listOrgMembers>>[number];

/** Active records for the event form's record-link select — the same "pick
 *  from everything in the org" pattern as the contacts list in
 *  getRecordFormOptions, capped so the select stays sane. */
export async function listRecordOptions(orgId: string, cap = 500) {
  return db
    .select({
      id: schema.records.id,
      reference: schema.records.reference,
      title: schema.records.title,
    })
    .from(schema.records)
    .where(and(eq(schema.records.orgId, orgId), eq(schema.records.isArchived, false)))
    .orderBy(asc(schema.records.reference), asc(schema.records.title))
    .limit(cap);
}

export type RecordOption = Awaited<ReturnType<typeof listRecordOptions>>[number];

/** One record as a select option, regardless of archival — so an event's
 *  currently linked record can always be shown (and kept) by the edit form
 *  even when it's archived or beyond `listRecordOptions`' cap. */
export async function getRecordOption(
  orgId: string,
  id: string,
): Promise<(RecordOption & { isArchived: boolean }) | null> {
  const [record] = await db
    .select({
      id: schema.records.id,
      reference: schema.records.reference,
      title: schema.records.title,
      isArchived: schema.records.isArchived,
    })
    .from(schema.records)
    .where(and(eq(schema.records.id, id), eq(schema.records.orgId, orgId)));
  return record ?? null;
}

/** One user as an assignee option, membership or not — so an event assigned
 *  to a since-removed member still shows (and keeps) its assignee. */
export async function getUserOption(id: string): Promise<OrgMember | null> {
  const [row] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return row ?? null;
}

/** One event row, scoped to the org (for the edit panel). */
export async function getEvent(orgId: string, id: string): Promise<CalendarEvent | null> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, id), eq(schema.events.orgId, orgId)));
  return event ?? null;
}

/* -------------------------------------------------------------------------- */
/* Workload                                                                    */
/* -------------------------------------------------------------------------- */

export interface WorkloadReport {
  /** Per-day totals for every day in range with at least one item. */
  summary: DayWorkload[];
  /** Just the heavy/overloaded days, for the warning strip. */
  heavy: DayWorkload[];
}

export interface WorkloadFilter extends CalendarItemsFilter {
  /** Working-day capacity in minutes (default 480 — see workload.ts). */
  capacityMinutes?: number;
}

/**
 * Workload for a range/assignee: fetches the same unified items the calendar
 * renders, maps them to WorkloadEvents, and summarizes per day. Record due
 * dates carry no estimate, so they raise a day's eventCount without adding
 * minutes.
 */
export async function getWorkload(
  orgId: string,
  filter: WorkloadFilter,
): Promise<WorkloadReport> {
  const items = await listCalendarItems(orgId, filter);
  const summary = summarizeWorkload(toWorkloadEvents(items), {
    capacityMinutes: filter.capacityMinutes,
    // Done items are already excluded in SQL unless includeDone was set, in
    // which case the workload should count them too.
    excludeDone: !filter.includeDone,
  });
  return { summary, heavy: heavyDays(summary) };
}
