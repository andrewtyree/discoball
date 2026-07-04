"use server";
/**
 * Calendar mutations — events CRUD plus drag-reschedule.
 *
 * Same authorization pattern as every mutation since Phase 1: session → RBAC
 * (record:write) → Zod-validate → verify referenced rows belong to the
 * caller's org → write in a transaction → audit entry.
 *
 * Audit convention (Phase 2): an event linked to a record audits onto the
 * RECORD's timeline (entity "record", entityId = recordId) with namespaced
 * actions — "event_add", "event_update", "event_reschedule", "event_delete".
 * Standalone events audit entity "event" with the plain actions.
 *
 * Form actions redirect back to the calendar with ?ok=1 / ?error=… (the
 * Phase 2 outcome convention); an optional `returnTo` field (must start with
 * "/calendar") preserves the view/month/filter params across the round-trip,
 * and an optional `errorTo` field sends failures somewhere else — the create
 * form uses it to keep its panel open on a validation error (matching the
 * record-detail convention that the erroring form stays visible).
 * `rescheduleItem` is the exception: it returns { ok } / { error } so a client
 * drag handler can revert the drop on failure.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { diffFields, recordAudit } from "@/lib/audit";
import { requireSessionUser, type SessionUser } from "@/lib/auth";
import { combineDateTime, shiftItemTimes, stripItemId } from "@/lib/calendar/items";
import { isStaleWrite } from "@/lib/records/concurrency";
import { assertCan } from "@/lib/rbac";
import { ymd } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

function checkRole(user: SessionUser, permission: Parameters<typeof assertCan>[1]): string | null {
  try {
    assertCan(user.role, permission);
    return null;
  } catch {
    return `Your role (${user.role}) doesn't have permission to do this.`;
  }
}

/** Where a form action returns to. Only calendar-local paths are honored, so
 *  a forged returnTo/errorTo can't turn the action into an open redirect. */
function calendarPath(formData: FormData, field: "returnTo" | "errorTo"): string {
  const raw = formData.get(field);
  if (typeof raw === "string" && raw.startsWith("/calendar")) return raw;
  // No (or bad) errorTo: fall back to the success path, then to the calendar.
  return field === "errorTo" ? calendarPath(formData, "returnTo") : "/calendar";
}

function back(formData: FormData, outcome: "ok" | string): never {
  const base = calendarPath(formData, outcome === "ok" ? "returnTo" : "errorTo");
  const sep = base.includes("?") ? "&" : "?";
  redirect(`${base}${sep}${outcome === "ok" ? "ok=1" : `error=${outcome}`}`);
}

function refresh(recordId: string | null) {
  revalidatePath("/calendar");
  if (recordId) revalidatePath(`/records/${recordId}`);
}

type EventRow = typeof schema.events.$inferSelect;

/** The audited fields of an event, ISO-formatted for the audit diff. */
function eventSnapshot(ev: {
  title: string;
  type: EventRow["type"];
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  assigneeId: string | null;
  estimatedMinutes: number | null;
  notes: string | null;
  recordId: string | null;
}): Record<string, unknown> {
  return {
    title: ev.title,
    type: ev.type,
    startAt: ev.startAt.toISOString(),
    endAt: ev.endAt ? ev.endAt.toISOString() : null,
    allDay: ev.allDay,
    assigneeId: ev.assigneeId,
    estimatedMinutes: ev.estimatedMinutes,
    notes: ev.notes,
    recordId: ev.recordId,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Write the audit entry for an event mutation per the Phase 2 convention:
 * onto each linked record's timeline as `event_<action>`, or onto the event's
 * own timeline when standalone. `recordIds` normally holds one id — updates
 * that re-link an event pass both the old and new record so neither timeline
 * has a gap.
 */
async function auditEvent(
  tx: Tx,
  user: SessionUser,
  eventId: string,
  recordIds: (string | null)[],
  action: "add" | "update" | "reschedule" | "delete",
  diff: Record<string, unknown>,
): Promise<void> {
  const linked = [...new Set(recordIds.filter((id): id is string => id !== null))];
  if (linked.length === 0) {
    await recordAudit(
      {
        orgId: user.orgId,
        userId: user.id,
        entity: "event",
        entityId: eventId,
        action: action === "add" ? "create" : action,
        diff,
      },
      tx,
    );
    return;
  }
  for (const recordId of linked) {
    await recordAudit(
      {
        orgId: user.orgId,
        userId: user.id,
        entity: "record",
        entityId: recordId,
        action: `event_${action}`,
        diff: { eventId, ...diff },
      },
      tx,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

const EVENT_TYPES = ["DEADLINE", "APPOINTMENT", "TASK", "REMINDER"] as const;

const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

const eventFieldsSchema = z.object({
  title: z.string({ required_error: "Title is required" }).trim().min(1).max(300),
  type: z.enum(EVENT_TYPES),
  allDay: z.coerce.boolean(),
  recordId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  assigneeId: z.preprocess(emptyToNull, z.string().uuid().nullable()),
  estimatedMinutes: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1).max(10080).nullable(),
  ),
  notes: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()),
});

interface EventInput extends z.infer<typeof eventFieldsSchema> {
  startAt: Date;
  endAt: Date | null;
}

/** Parse the event form: scalar fields via Zod, then startDate/startTime and
 *  endDate/endTime combined into UTC instants (times ignored for all-day). */
function parseEventInput(formData: FormData): EventInput | { error: string } {
  const parsed = eventFieldsSchema.safeParse({
    title: formData.get("title"),
    type: formData.get("type") ?? "APPOINTMENT",
    allDay: formData.get("allDay"),
    recordId: formData.get("recordId"),
    assigneeId: formData.get("assigneeId"),
    estimatedMinutes: formData.get("estimatedMinutes"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const str = (key: string): string | null => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const startDate = str("startDate");
  if (!startDate) return { error: "Start date is required." };
  const allDay = parsed.data.allDay;

  const startAt = combineDateTime(startDate, allDay ? null : str("startTime"));
  if (!startAt) return { error: "Invalid start date/time." };

  const endDate = str("endDate");
  const endTime = allDay ? null : str("endTime");
  let endAt: Date | null = null;
  if (endDate || endTime) {
    // An end time without an end date means "same day".
    endAt = combineDateTime(endDate ?? startDate, endTime);
    if (!endAt) return { error: "Invalid end date/time." };
    if (endAt.getTime() < startAt.getTime()) {
      return { error: "End must be on or after start." };
    }
  }

  return { ...parsed.data, startAt, endAt };
}

/** A client can post any UUIDs; verify the record and assignee are the org's.
 *  `keepAssigneeId` (the event's stored assignee, on update) stays valid even
 *  after their membership was removed, so saving an unrelated field doesn't
 *  bounce on a no-longer-member assignee. */
async function validateEventRefs(
  orgId: string,
  input: EventInput,
  keepAssigneeId?: string | null,
): Promise<string | null> {
  if (input.recordId) {
    const [record] = await db
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(and(eq(schema.records.id, input.recordId), eq(schema.records.orgId, orgId)));
    if (!record) return "Unknown record.";
  }
  if (input.assigneeId && input.assigneeId !== keepAssigneeId) {
    const [member] = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, input.assigneeId),
          eq(schema.memberships.orgId, orgId),
        ),
      );
    if (!member) return "The assignee is not a member of this organization.";
  }
  return null;
}

/** Session + role gate + org-scoped event load shared by update/delete/toggle. */
async function requireWritableEvent(
  formData: FormData,
): Promise<{ user: SessionUser; event: EventRow }> {
  const user = await requireSessionUser();
  if (checkRole(user, "record:write")) back(formData, "forbidden");

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) back(formData, "invalid");

  const [event] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, idParse.data), eq(schema.events.orgId, user.orgId)));
  if (!event) back(formData, "notfound");

  return { user, event };
}

/* -------------------------------------------------------------------------- */
/* Event CRUD                                                                  */
/* -------------------------------------------------------------------------- */

export async function createEvent(formData: FormData): Promise<void> {
  const user = await requireSessionUser();
  if (checkRole(user, "record:write")) back(formData, "forbidden");

  const input = parseEventInput(formData);
  if ("error" in input) back(formData, "invalid");

  const refError = await validateEventRefs(user.orgId, input);
  if (refError) back(formData, "invalid");

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.events)
      .values({
        orgId: user.orgId,
        recordId: input.recordId,
        title: input.title,
        type: input.type,
        startAt: input.startAt,
        endAt: input.endAt,
        allDay: input.allDay,
        assigneeId: input.assigneeId,
        estimatedMinutes: input.estimatedMinutes,
        notes: input.notes,
      })
      .returning({ id: schema.events.id });

    await auditEvent(
      tx,
      user,
      created.id,
      [input.recordId],
      "add",
      diffFields({}, eventSnapshot(input)),
    );
  });

  refresh(input.recordId);
  back(formData, "ok");
}

export async function updateEvent(formData: FormData): Promise<void> {
  const { user, event } = await requireWritableEvent(formData);

  const input = parseEventInput(formData);
  if ("error" in input) back(formData, "invalid");

  const refError = await validateEventRefs(user.orgId, input, event.assigneeId);
  if (refError) back(formData, "invalid");

  await db.transaction(async (tx) => {
    await tx
      .update(schema.events)
      .set({
        recordId: input.recordId,
        title: input.title,
        type: input.type,
        startAt: input.startAt,
        endAt: input.endAt,
        allDay: input.allDay,
        assigneeId: input.assigneeId,
        estimatedMinutes: input.estimatedMinutes,
        notes: input.notes,
      })
      .where(eq(schema.events.id, event.id));

    await auditEvent(
      tx,
      user,
      event.id,
      [event.recordId, input.recordId],
      "update",
      { title: input.title, ...diffFields(eventSnapshot(event), eventSnapshot(input)) },
    );
  });

  refresh(event.recordId);
  if (input.recordId !== event.recordId) refresh(input.recordId);
  back(formData, "ok");
}

export async function deleteEvent(formData: FormData): Promise<void> {
  const { user, event } = await requireWritableEvent(formData);

  await db.transaction(async (tx) => {
    await tx.delete(schema.events).where(eq(schema.events.id, event.id));
    await auditEvent(tx, user, event.id, [event.recordId], "delete", {
      title: event.title,
      startAt: event.startAt.toISOString(),
    });
  });

  refresh(event.recordId);
  back(formData, "ok");
}

export async function toggleEventDone(formData: FormData): Promise<void> {
  const { user, event } = await requireWritableEvent(formData);
  const isDone = !event.isDone;

  await db.transaction(async (tx) => {
    await tx.update(schema.events).set({ isDone }).where(eq(schema.events.id, event.id));
    await auditEvent(tx, user, event.id, [event.recordId], "update", {
      title: event.title,
      isDone: { from: event.isDone, to: isDone },
    });
  });

  refresh(event.recordId);
  back(formData, "ok");
}

/* -------------------------------------------------------------------------- */
/* Drag reschedule                                                             */
/* -------------------------------------------------------------------------- */

export type RescheduleResult = { ok: true } | { error: string };

const rescheduleSchema = z.object({
  kind: z.enum(["event", "record-due"]),
  id: z.string().min(1),
  newStart: z.string().min(1),
  newEnd: z.string().nullable(),
  /** records.version the client loaded — required for kind "record-due", so
   *  a drag from a stale calendar is rejected (see records/concurrency.ts). */
  expectedVersion: z.coerce.number().int().positive().nullable(),
});

const RESCHEDULE_CONFLICT_MESSAGE =
  "Someone else changed this record while you were dragging — reload and try again.";

/**
 * Move a dragged calendar item. Events shift startAt (and endAt, preserving
 * duration unless the drag resized it). Record due dates update
 * records.dueDate under the optimistic-concurrency guard: the client submits
 * the `records.version` it loaded (like a record edit form — see
 * records/concurrency.ts) and the UPDATE only matches while the row is still
 * at it, auditing the before→after diff as "reschedule" on the record's
 * timeline. Returns a result instead of redirecting so the client drag
 * handler can revert the drop on failure.
 */
export async function rescheduleItem(formData: FormData): Promise<RescheduleResult> {
  const user = await requireSessionUser();
  const forbidden = checkRole(user, "record:write");
  if (forbidden) return { error: forbidden };

  const parsed = rescheduleSchema.safeParse({
    kind: formData.get("kind"),
    id: formData.get("id"),
    newStart: formData.get("newStart"),
    newEnd: typeof formData.get("newEnd") === "string" ? formData.get("newEnd") : null,
    expectedVersion:
      typeof formData.get("expectedVersion") === "string"
        ? formData.get("expectedVersion")
        : null,
  });
  if (!parsed.success) return { error: "Invalid reschedule request." };

  // Accept both the raw uuid and the namespaced CalendarItem id.
  const idParse = z.string().uuid().safeParse(stripItemId(parsed.data.id));
  if (!idParse.success) return { error: "Invalid reschedule request." };
  const id = idParse.data;

  const newStart = new Date(parsed.data.newStart);
  if (Number.isNaN(newStart.getTime())) return { error: "Invalid new start." };

  let newEnd: Date | null = null;
  if (parsed.data.newEnd && parsed.data.newEnd.trim() !== "") {
    newEnd = new Date(parsed.data.newEnd);
    if (Number.isNaN(newEnd.getTime())) return { error: "Invalid new end." };
    if (newEnd.getTime() < newStart.getTime()) {
      return { error: "End must be on or after start." };
    }
  }

  if (parsed.data.kind === "event") {
    const [event] = await db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.id, id), eq(schema.events.orgId, user.orgId)));
    if (!event) return { error: "Event not found." };

    const times = shiftItemTimes({ startAt: event.startAt, endAt: event.endAt }, newStart, newEnd);

    await db.transaction(async (tx) => {
      await tx.update(schema.events).set(times).where(eq(schema.events.id, event.id));
      await auditEvent(tx, user, event.id, [event.recordId], "reschedule", {
        title: event.title,
        startAt: { from: event.startAt.toISOString(), to: times.startAt.toISOString() },
        endAt: {
          from: event.endAt ? event.endAt.toISOString() : null,
          to: times.endAt ? times.endAt.toISOString() : null,
        },
      });
    });

    refresh(event.recordId);
    return { ok: true };
  }

  // kind === "record-due": move records.dueDate under the optimistic-
  // concurrency pattern (see src/lib/records/actions.ts + concurrency.ts) —
  // the guarded UPDATE only matches while the row is still at the version the
  // CLIENT loaded, bumping it on success, so a drag on a stale calendar can't
  // clobber a concurrent edit.
  const expectedVersion = parsed.data.expectedVersion;
  if (expectedVersion === null) return { error: "Invalid reschedule request." };
  // Due-date chips have no duration; a resize would be a silent no-op.
  if (newEnd) return { error: "A record's due date can't be resized." };

  const before = await db.query.records.findFirst({
    where: and(eq(schema.records.id, id), eq(schema.records.orgId, user.orgId)),
  });
  if (!before) return { error: "Record not found." };
  if (before.isArchived) return { error: "This record is archived." };
  if (isStaleWrite(before.version, expectedVersion)) {
    return { error: RESCHEDULE_CONFLICT_MESSAGE };
  }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.records)
      .set({
        dueDate: newStart,
        version: sql`${schema.records.version} + 1`,
        updatedById: user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.records.id, id),
          eq(schema.records.orgId, user.orgId),
          eq(schema.records.version, expectedVersion),
        ),
      )
      .returning({ id: schema.records.id });
    if (rows.length === 0) return false;

    await recordAudit(
      {
        orgId: user.orgId,
        userId: user.id,
        entity: "record",
        entityId: id,
        action: "reschedule",
        diff: {
          dueDate: {
            from: before.dueDate ? ymd(before.dueDate) : null,
            to: ymd(newStart),
          },
        },
      },
      tx,
    );
    return true;
  });

  if (!updated) return { error: RESCHEDULE_CONFLICT_MESSAGE };

  refresh(id);
  return { ok: true };
}
