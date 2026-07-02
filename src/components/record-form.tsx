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
 *
 * The record type select is controlled: choosing a type swaps in that type's
 * user-defined custom fields (rendered by CustomFieldInputs below), which post
 * as `cf_<key>` and are stored in records.customValues.
 */
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { customFieldName, type CustomFieldDef } from "@/lib/records/custom-fields";
import type { RecordFormEcho, RecordFormState } from "@/lib/records/actions";
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
  customValues: Record<string, unknown>;
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
  const [recordTypeId, setRecordTypeId] = useState(record?.recordTypeId ?? "");

  const conflict = state.status === "conflict" ? state : null;
  const expectedVersion = conflict?.freshVersion ?? record?.version;

  // After a failed save, prefer what the user just typed over the stored row.
  const echoed = state.status === "error" || state.status === "conflict" ? state.values : undefined;
  const v = (field: keyof Omit<RecordFormValues, "customValues">): string | undefined => {
    const e = echoed?.[field];
    if (typeof e === "string") return e;
    return (record ? record[field] : undefined)?.toString();
  };

  const typeFields = options.customFields.filter((f) => f.recordTypeId === recordTypeId);

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
            value={recordTypeId}
            onChange={(e) => setRecordTypeId(e.target.value)}
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

      {typeFields.length > 0 ? (
        <CustomFieldInputs
          defs={typeFields}
          members={options.members}
          contacts={options.contacts}
          echoed={echoed}
          stored={record?.customValues ?? {}}
          readOnly={readOnly}
        />
      ) : null}

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

/* -------------------------------------------------------------------------- */
/* Dynamic custom fields                                                       */
/* -------------------------------------------------------------------------- */

function CustomFieldInputs({
  defs,
  members,
  contacts,
  echoed,
  stored,
  readOnly,
}: {
  defs: CustomFieldDef[];
  members: RecordFormOptions["members"];
  contacts: RecordFormOptions["contacts"];
  /** Values from a failed save; when present they win over stored values. */
  echoed: RecordFormEcho | undefined;
  stored: Record<string, unknown>;
  readOnly: boolean;
}) {
  // A checkbox that was unchecked at submit time simply doesn't appear in the
  // echo, so "echo round happened" must be tracked separately from per-key
  // presence to re-render unchecked boxes as unchecked.
  const hasEcho = echoed !== undefined;

  const textDefault = (def: CustomFieldDef): string => {
    const e = echoed?.[customFieldName(def.key)];
    if (typeof e === "string") return e;
    if (Array.isArray(e)) return e[0] ?? "";
    const s = stored[def.key];
    return s === undefined || s === null ? "" : String(s);
  };

  const checkedSet = (def: CustomFieldDef): Set<string> => {
    const name = customFieldName(def.key);
    if (hasEcho) {
      const e = echoed?.[name];
      return new Set(Array.isArray(e) ? e : typeof e === "string" ? [e] : []);
    }
    const s = stored[def.key];
    return new Set(Array.isArray(s) ? s.map(String) : []);
  };

  const boolDefault = (def: CustomFieldDef): boolean => {
    if (hasEcho) return echoed?.[customFieldName(def.key)] !== undefined;
    return stored[def.key] === true;
  };

  return (
    <fieldset className="border-t border-[var(--border)] pt-4">
      <legend className="float-left mb-3 w-full text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        Type details
      </legend>
      <div className="grid gap-4 md:grid-cols-2">
        {defs.map((def) => {
          const name = customFieldName(def.key);
          const id = `cf-${def.key}`;
          const label = def.required ? `${def.label} *` : def.label;

          switch (def.fieldType) {
            case "LONG_TEXT":
              return (
                <Field key={def.id} label={label} htmlFor={id} className="md:col-span-2">
                  <Textarea
                    id={id}
                    name={name}
                    maxLength={10_000}
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  />
                </Field>
              );
            case "NUMBER":
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Input
                    id={id}
                    name={name}
                    type="number"
                    step="any"
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  />
                </Field>
              );
            case "DATE":
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Input
                    id={id}
                    name={name}
                    type="date"
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  />
                </Field>
              );
            case "BOOLEAN":
              return (
                <label
                  key={def.id}
                  className="flex items-center gap-2 self-end pb-2 text-sm"
                  htmlFor={id}
                >
                  <input
                    id={id}
                    name={name}
                    type="checkbox"
                    value="1"
                    defaultChecked={boolDefault(def)}
                    disabled={readOnly}
                  />
                  {def.label}
                </label>
              );
            case "SELECT":
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Select
                    id={id}
                    name={name}
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  >
                    <option value="">—</option>
                    {def.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            case "MULTI_SELECT":
              return (
                <fieldset key={def.id}>
                  <legend className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">
                    {label}
                  </legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {def.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name={name}
                          value={opt}
                          defaultChecked={checkedSet(def).has(opt)}
                          disabled={readOnly}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            case "USER":
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Select
                    id={id}
                    name={name}
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.email}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            case "CONTACT":
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Select
                    id={id}
                    name={name}
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  >
                    <option value="">—</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            case "TEXT":
            default:
              return (
                <Field key={def.id} label={label} htmlFor={id}>
                  <Input
                    id={id}
                    name={name}
                    maxLength={500}
                    required={def.required}
                    defaultValue={textDefault(def)}
                    disabled={readOnly}
                  />
                </Field>
              );
          }
        })}
      </div>
    </fieldset>
  );
}
