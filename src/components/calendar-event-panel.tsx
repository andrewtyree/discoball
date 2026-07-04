/**
 * Calendar event panel — the aside toggled by ?event=new / ?event=<id>.
 *
 * Server-rendered plain forms posting to the calendar server actions, exactly
 * like the record-detail panels: no client dialogs, outcomes come back as
 * ?ok / ?error on the `returnTo` path. Create closes the panel on success but
 * stays open on a validation error (its `errorTo` preserves ?event=new, the
 * record-detail convention that the erroring form remains visible); edit
 * keeps it open either way (its returnTo preserves ?event=<id>); delete
 * closes it.
 */
import Link from "next/link";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { CalendarEvent } from "@/db/schema";
import {
  createEvent,
  deleteEvent,
  toggleEventDone,
  updateEvent,
} from "@/lib/calendar/actions";
import type { OrgMember, RecordOption } from "@/lib/calendar/queries";
import { ymd } from "@/lib/utils";

export const EVENT_TYPE_LABELS: Record<string, string> = {
  DEADLINE: "Deadline",
  APPOINTMENT: "Appointment",
  TASK: "Task",
  REMINDER: "Reminder",
};

/** hh:mm (UTC) for `<input type="time">`, matching `ymd`'s convention. */
function hm(date: Date | null): string {
  return date ? date.toISOString().slice(11, 16) : "";
}

function recordLabel(r: RecordOption): string {
  return r.reference ? `${r.reference} — ${r.title}` : r.title;
}

export function EventPanel({
  event,
  members,
  records,
  canWrite,
  defaultDate,
  returnTo,
  closeTo,
}: {
  /** Existing event to edit, or null for the create form. */
  event: CalendarEvent | null;
  members: OrgMember[];
  records: RecordOption[];
  canWrite: boolean;
  /** Prefill for the create form's start date (yyyy-mm-dd). */
  defaultDate: string;
  /** Calendar URL including ?event=… — where edit/toggle land (panel stays open). */
  returnTo: string;
  /** Calendar URL without ?event=… — the Close link and where create/delete land. */
  closeTo: string;
}) {
  const isEdit = event !== null;

  /* VIEWERs get a read-only summary — no forms, no mutating controls. */
  if (!canWrite) {
    if (!event) return null;
    return (
      <Card aria-label="Event details">
        <PanelHeader title={event.title} closeTo={closeTo} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[var(--muted-foreground)]">Type</dt>
          <dd>{EVENT_TYPE_LABELS[event.type] ?? event.type}</dd>
          <dt className="text-[var(--muted-foreground)]">Starts</dt>
          <dd className="font-mono text-xs leading-5">
            {ymd(event.startAt)}
            {event.allDay ? " (all day)" : ` ${hm(event.startAt)}`}
          </dd>
          <dt className="text-[var(--muted-foreground)]">Ends</dt>
          <dd className="font-mono text-xs leading-5">
            {event.endAt ? `${ymd(event.endAt)}${event.allDay ? "" : ` ${hm(event.endAt)}`}` : "—"}
          </dd>
          <dt className="text-[var(--muted-foreground)]">Assignee</dt>
          <dd>
            {members.find((m) => m.id === event.assigneeId)?.name ??
              members.find((m) => m.id === event.assigneeId)?.email ??
              "Unassigned"}
          </dd>
          <dt className="text-[var(--muted-foreground)]">Record</dt>
          <dd>
            {event.recordId ? (
              <Link href={`/records/${event.recordId}`} className="underline">
                {records.find((r) => r.id === event.recordId)
                  ? recordLabel(records.find((r) => r.id === event.recordId)!)
                  : "Open record"}
              </Link>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-[var(--muted-foreground)]">Effort</dt>
          <dd>{event.estimatedMinutes ? `${event.estimatedMinutes} min` : "—"}</dd>
          <dt className="text-[var(--muted-foreground)]">Done</dt>
          <dd>{event.isDone ? "Yes" : "No"}</dd>
        </dl>
        {event.notes ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
            {event.notes}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card aria-label={isEdit ? "Edit event" : "New event"}>
      <PanelHeader title={isEdit ? "Edit event" : "New event"} closeTo={closeTo} />
      <CardDescription className="mb-4">
        {isEdit
          ? "Change the details, or use the actions below the form."
          : "Add a deadline, appointment, task, or reminder — optionally linked to a record."}
      </CardDescription>

      <form action={isEdit ? updateEvent : createEvent} className="flex flex-col gap-3">
        {isEdit ? <input type="hidden" name="id" value={event.id} /> : null}
        <input type="hidden" name="returnTo" value={isEdit ? returnTo : closeTo} />
        {/* Errors land back on the open panel, not the closed calendar. */}
        <input type="hidden" name="errorTo" value={returnTo} />

        <Field label="Title" htmlFor="event-title">
          <Input
            id="event-title"
            name="title"
            required
            maxLength={300}
            defaultValue={event?.title ?? ""}
            placeholder="e.g. File response brief"
          />
        </Field>

        <Field label="Type" htmlFor="event-type">
          <Select id="event-type" name="type" defaultValue={event?.type ?? "APPOINTMENT"}>
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="event-start-date">
            <Input
              id="event-start-date"
              name="startDate"
              type="date"
              required
              defaultValue={event ? ymd(event.startAt) : defaultDate}
            />
          </Field>
          <Field label="Start time" htmlFor="event-start-time">
            <Input
              id="event-start-time"
              name="startTime"
              type="time"
              defaultValue={event && !event.allDay ? hm(event.startAt) : ""}
            />
          </Field>
          <Field label="End date (optional)" htmlFor="event-end-date">
            <Input
              id="event-end-date"
              name="endDate"
              type="date"
              defaultValue={event?.endAt ? ymd(event.endAt) : ""}
            />
          </Field>
          <Field label="End time" htmlFor="event-end-time">
            <Input
              id="event-end-time"
              name="endTime"
              type="time"
              defaultValue={event?.endAt && !event.allDay ? hm(event.endAt) : ""}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="allDay"
            value="true"
            defaultChecked={event?.allDay ?? false}
            className="size-4 accent-[var(--primary)]"
          />
          All day (times ignored)
        </label>

        <Field label="Assignee" htmlFor="event-assignee">
          <Select id="event-assignee" name="assigneeId" defaultValue={event?.assigneeId ?? ""}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Linked record (optional)" htmlFor="event-record">
          <Select id="event-record" name="recordId" defaultValue={event?.recordId ?? ""}>
            <option value="">No linked record</option>
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {recordLabel(r)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Estimated effort (minutes)" htmlFor="event-minutes">
          <Input
            id="event-minutes"
            name="estimatedMinutes"
            type="number"
            min={1}
            max={10080}
            step={1}
            defaultValue={event?.estimatedMinutes ?? ""}
            placeholder="e.g. 90"
          />
        </Field>

        <Field label="Notes (optional)" htmlFor="event-notes">
          <Textarea
            id="event-notes"
            name="notes"
            maxLength={2000}
            defaultValue={event?.notes ?? ""}
          />
        </Field>

        <div>
          <Button type="submit">{isEdit ? "Save changes" : "Create event"}</Button>
        </div>
      </form>

      {isEdit ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
          <form action={toggleEventDone}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" variant="outline" className="text-xs">
              {event.isDone ? "Mark as not done" : "Mark as done"}
            </Button>
          </form>
          <form action={deleteEvent}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="returnTo" value={closeTo} />
            <Button type="submit" variant="ghost" className="text-xs text-red-600">
              Delete event
            </Button>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

function PanelHeader({ title, closeTo }: { title: string; closeTo: string }) {
  return (
    <div className="mb-1 flex items-start justify-between gap-3">
      <CardTitle className="text-base">{title}</CardTitle>
      <Link
        href={closeTo}
        aria-label="Close panel"
        title="Close panel"
        className="rounded-[var(--radius)] p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
      >
        <X size={16} aria-hidden />
      </Link>
    </div>
  );
}
