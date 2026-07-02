"use client";
/**
 * Create/edit form for a record, including the optimistic-concurrency conflict
 * prompt: when a save is rejected as stale, the user's typed values are kept,
 * the other writer's values are shown alongside, and the hidden version field
 * is advanced so "Save again" knowingly overwrites — or "Reload" discards the
 * local edits.
 *
 * React resets uncontrolled form fields to their defaultValue after an action
 * completes, so a failed save echoes the submitted values back through action
 * state (state.values) and this form renders them as the defaults — otherwise
 * the reset would silently discard the user's in-progress edits.
 */
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { RecordFormState } from "@/lib/records/actions";
import type { RecordFormOptions } from "@/lib/records/queries";

/** Initial values, pre-serialized (dates as yyyy-mm-dd) by the server page. */
export interface RecordFormValues {
  id: string;
  version: number;
  title: string;
  reference: string;
  subjectName: string;
  recordTypeId: string;
  statusId: string;
  assigneeId: string;
  openedDate: string;
  dueDate: string;
}

const IDLE: RecordFormState = { status: "idle" };

export function RecordForm({
  action,
  options,
  record,
  readOnly = false,
  submitLabel,
}: {
  action: (state: RecordFormState, formData: FormData) => Promise<RecordFormState>;
  options: RecordFormOptions;
  /** Present when editing; absent when creating. */
  record?: RecordFormValues;
  /** True for roles without record:write — renders a disabled, view-only form. */
  readOnly?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);

  const conflict = state.status === "conflict" ? state : null;
  const expectedVersion = conflict?.freshVersion ?? record?.version;

  // After a failed save, prefer what the user just typed over the stored row.
  const echoed = state.status === "error" || state.status === "conflict" ? state.values : undefined;
  const v = (field: keyof RecordFormValues): string | undefined =>
    echoed?.[field] ?? (record ? record[field] : undefined)?.toString();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {state.message}
        </p>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-amber-500/50 bg-amber-500/10 px-3 py-3 text-sm"
        >
          <p className="font-medium">Edit conflict</p>
          <p className="mt-1 text-[var(--muted-foreground)]">{conflict.message}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {conflict.theirs.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="text-[var(--muted-foreground)]">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Reload their version (discard my changes)
            </Button>
          </div>
        </div>
      ) : null}

      {record ? (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
        </>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title" htmlFor="rec-title" className="md:col-span-2">
          <Input
            id="rec-title"
            name="title"
            required
            maxLength={300}
            defaultValue={v("title")}
            disabled={readOnly}
          />
        </Field>

        <Field label="Reference" htmlFor="rec-reference">
          <Input
            id="rec-reference"
            name="reference"
            maxLength={100}
            placeholder="e.g. MAT-2026-0042"
            defaultValue={v("reference")}
            disabled={readOnly}
          />
        </Field>

        <Field label="Subject" htmlFor="rec-subject">
          <Input
            id="rec-subject"
            name="subjectName"
            maxLength={300}
            placeholder="Primary party or subject"
            defaultValue={v("subjectName")}
            disabled={readOnly}
          />
        </Field>

        <Field label="Record type" htmlFor="rec-type">
          <Select
            id="rec-type"
            name="recordTypeId"
            required
            defaultValue={v("recordTypeId") ?? ""}
            disabled={readOnly}
          >
            <option value="" disabled>
              Select a type…
            </option>
            {options.recordTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="rec-status">
          <Select
            id="rec-status"
            name="statusId"
            defaultValue={v("statusId") ?? ""}
            disabled={readOnly}
          >
            <option value="">No status</option>
            {options.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.category === "CLOSED" ? " (closed)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Assignee" htmlFor="rec-assignee">
          <Select
            id="rec-assignee"
            name="assigneeId"
            defaultValue={v("assigneeId") ?? ""}
            disabled={readOnly}
          >
            <option value="">Unassigned</option>
            {options.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name ?? m.email}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Opened" htmlFor="rec-opened">
          <Input
            id="rec-opened"
            name="openedDate"
            type="date"
            defaultValue={v("openedDate")}
            disabled={readOnly}
          />
        </Field>

        <Field label="Due" htmlFor="rec-due">
          <Input
            id="rec-due"
            name="dueDate"
            type="date"
            defaultValue={v("dueDate")}
            disabled={readOnly}
          />
        </Field>
      </div>

      {readOnly ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Your role is view-only, so this form can’t be edited.
        </p>
      ) : (
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : conflict ? "Save again (overwrite theirs)" : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
