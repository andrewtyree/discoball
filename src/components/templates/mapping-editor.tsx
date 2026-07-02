"use client";
/**
 * The template mapping editor: one row per discovered placeholder, each bound
 * to a data source via a grouped select. Client component for two reasons:
 * useActionState (save errors come back inline) and live mapping validation —
 * the unmapped/complete banner and per-row flags react to the selects before
 * anything is saved, using the same pure `validateMappings` the server runs.
 *
 * Unmapped placeholders never block saving: generation is what fails (naming
 * the tags), so a user can upload first and finish mapping later.
 *
 * VIEWERs get the same layout with every control disabled and no submit
 * button (`readOnly`), mirroring the record form.
 */
import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { TemplateFormState } from "@/lib/templates/actions";
import { validateMappings } from "@/lib/templates/placeholders";
import { cn } from "@/lib/utils";

export interface MappingSourceGroup {
  /** Optgroup label, e.g. "Record fields" or "Employment matter — custom fields". */
  label: string;
  sources: { path: string; label: string }[];
}

export interface MappingEditorTemplate {
  id: string;
  name: string;
  description: string;
  recordTypeId: string;
  outputNamePattern: string;
  placeholders: string[];
  fieldMappings: Record<string, string>;
}

const IDLE: TemplateFormState = { status: "idle" };

export function MappingEditor({
  action,
  template,
  recordTypes,
  sourceGroups,
  readOnly = false,
}: {
  action: (state: TemplateFormState, formData: FormData) => Promise<TemplateFormState>;
  template: MappingEditorTemplate;
  recordTypes: { id: string; name: string }[];
  sourceGroups: MappingSourceGroup[];
  readOnly?: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);

  // Current (unsaved) bindings, keyed by placeholder; "" = unmapped.
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of template.placeholders) init[p] = template.fieldMappings[p] ?? "";
    return init;
  });

  const validation = useMemo(() => {
    const bound: Record<string, string> = {};
    for (const [tag, source] of Object.entries(mappings)) {
      if (source !== "") bound[tag] = source;
    }
    return validateMappings(template.placeholders, bound);
  }, [mappings, template.placeholders]);

  /** Saved bindings whose placeholder no longer exists in the template —
   *  informational only; saving drops them (the form posts one control per
   *  current placeholder). */
  const staleBindings = useMemo(
    () =>
      Object.keys(template.fieldMappings).filter(
        (tag) => !template.placeholders.includes(tag),
      ),
    [template.fieldMappings, template.placeholders],
  );

  const knownPaths = useMemo(
    () => new Set(sourceGroups.flatMap((g) => g.sources.map((s) => s.path))),
    [sourceGroups],
  );

  const total = template.placeholders.length;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={template.id} />

      {state.status === "error" ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {state.message}
        </p>
      ) : null}

      {/* Mapping summary banner — live, before saving. */}
      {total === 0 ? (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]"
        >
          No {"{placeholder}"} tags were discovered in this template, so there is
          nothing to map — generation will produce the document as uploaded.
        </p>
      ) : validation.isComplete ? (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
        >
          All {total} placeholder{total === 1 ? "" : "s"} mapped — ready to generate.
        </p>
      ) : (
        <p
          role="status"
          className="rounded-[var(--radius)] border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          {validation.unmapped.length} of {total} placeholder
          {total === 1 ? "" : "s"} unmapped:{" "}
          <span className="font-mono text-xs">
            {validation.unmapped.map((t) => `{${t}}`).join(", ")}
          </span>
          . You can still save, but generation will fail until they&rsquo;re mapped.
        </p>
      )}

      {staleBindings.length > 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">
          Saved bindings without a matching placeholder (dropped on next save):{" "}
          <span className="font-mono">
            {staleBindings.map((t) => `{${t}}`).join(", ")}
          </span>
        </p>
      ) : null}

      {/* Placeholder → source rows */}
      {total > 0 ? (
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
              <tr>
                <th className="p-3 font-medium">Placeholder</th>
                <th className="p-3 font-medium">Data source</th>
                <th className="p-3 font-medium sr-only">Mapping state</th>
              </tr>
            </thead>
            <tbody>
              {template.placeholders.map((tag) => {
                const value = mappings[tag] ?? "";
                const unmapped = value === "";
                return (
                  <tr
                    key={tag}
                    className={cn(
                      "border-b border-[var(--border)] last:border-b-0",
                      unmapped && "bg-amber-500/5",
                    )}
                  >
                    <td className="p-3">
                      <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                        {`{${tag}}`}
                      </code>
                    </td>
                    <td className="p-3">
                      <Select
                        name={`map_${tag}`}
                        aria-label={`Data source for placeholder ${tag}`}
                        value={value}
                        onChange={(e) =>
                          setMappings((prev) => ({ ...prev, [tag]: e.target.value }))
                        }
                        disabled={readOnly}
                        className="w-full max-w-xs py-1.5"
                      >
                        <option value="">— Not mapped —</option>
                        {value !== "" && !knownPaths.has(value) ? (
                          <option value={value}>{value} (missing field)</option>
                        ) : null}
                        {sourceGroups.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.sources.map((s) => (
                              <option key={s.path} value={s.path}>
                                {s.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3 text-right">
                      {unmapped ? (
                        <span className="inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          Unmapped
                        </span>
                      ) : (
                        <span className="inline-block rounded bg-green-600/15 px-1.5 py-0.5 text-xs font-medium text-green-700">
                          Mapped
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Template metadata */}
      <div className="grid gap-4 border-t border-[var(--border)] pt-4 md:grid-cols-2">
        <Field label="Name" htmlFor="tpl-name">
          <Input
            id="tpl-name"
            name="name"
            required
            maxLength={200}
            defaultValue={template.name}
            disabled={readOnly}
          />
        </Field>

        <Field label="Record type" htmlFor="tpl-record-type">
          <Select
            id="tpl-record-type"
            name="recordTypeId"
            defaultValue={template.recordTypeId}
            disabled={readOnly}
          >
            <option value="">Any record type</option>
            {recordTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Description" htmlFor="tpl-description" className="md:col-span-2">
          <Textarea
            id="tpl-description"
            name="description"
            maxLength={2000}
            className="min-h-16"
            defaultValue={template.description}
            disabled={readOnly}
          />
        </Field>

        <Field
          label="Output filename pattern"
          htmlFor="tpl-output-pattern"
          className="md:col-span-2"
        >
          <Input
            id="tpl-output-pattern"
            name="outputNamePattern"
            maxLength={200}
            placeholder="{reference}"
            defaultValue={template.outputNamePattern}
            disabled={readOnly}
          />
        </Field>
        <p className="-mt-2 text-xs text-[var(--muted-foreground)] md:col-span-2">
          Tokens use the same data-source paths as mappings, e.g.{" "}
          <code className="font-mono">{"{reference}_{subjectName}"}</code> or{" "}
          <code className="font-mono">{"{custom.court_name}"}</code>. Defaults to{" "}
          <code className="font-mono">{"{reference}"}</code>; the .docx/.pdf
          extension is added automatically.
        </p>
      </div>

      {readOnly ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          Your role is view-only, so mappings and settings can&rsquo;t be edited.
        </p>
      ) : (
        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save mappings & settings"}
          </Button>
        </div>
      )}
    </form>
  );
}
