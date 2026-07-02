import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/phase-notice";
import {
  MappingEditor,
  type MappingSourceGroup,
} from "@/components/templates/mapping-editor";
import { PreviewPicker } from "@/components/templates/preview-picker";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { parseRecordFilter } from "@/lib/records/filters";
import { getRecordFormOptions, listRecords } from "@/lib/records/queries";
import {
  deleteTemplate,
  toggleTemplateActive,
  updateTemplateMappings,
} from "@/lib/templates/actions";
import {
  GENERATION_RECORD_CAP,
  getRun,
  getTemplate,
  listRuns,
  type RunListRow,
} from "@/lib/templates/queries";
import { customSourcePath, MAPPING_SOURCES } from "@/lib/templates/resolve";
import { runGeneration } from "@/lib/templates/runner";
import { cn, ymd } from "@/lib/utils";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "That request wasn’t valid — check the values and try again.",
  inactive: "This template is inactive — activate it before generating documents.",
  has_runs:
    "This template has generation runs, so it can’t be deleted (run history is kept). Deactivate it instead to retire it.",
};

const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

const RUN_STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  RUNNING: "bg-blue-600/15 text-blue-700",
  COMPLETED: "bg-green-600/15 text-green-700",
  FAILED: "bg-red-500/15 text-red-600",
};

/** Run creation time as "yyyy-mm-dd hh:mm" (UTC, matching ymd elsewhere). */
function runTimestamp(d: Date): string {
  return `${ymd(d)} ${d.toISOString().slice(11, 16)}`;
}

function RunStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
        RUN_STATUS_STYLES[status] ?? RUN_STATUS_STYLES.PENDING,
      )}
    >
      {RUN_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function WarningsDetails({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return <span className="text-[var(--muted-foreground)]">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-amber-700">
        {warnings.length} warning{warnings.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-4 text-xs text-[var(--muted-foreground)]">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

/** Outcome banner for the run the user just triggered (?run=<id>). */
function RunOutcome({ run }: { run: RunListRow }) {
  if (run.status === "COMPLETED") {
    return (
      <div
        role="status"
        className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-3 text-sm"
      >
        <p className="font-medium text-green-700">
          Generated {run.recordCount} document{run.recordCount === 1 ? "" : "s"} (
          {run.outputMode}).
        </p>
        {run.resultStorageKey ? (
          <p className="mt-1">
            <a href={`/api/runs/${run.id}/artifact`} className="underline">
              Download the result
            </a>
          </p>
        ) : null}
        {run.warnings.length > 0 ? (
          <div className="mt-2">
            <WarningsDetails warnings={run.warnings} />
          </div>
        ) : null}
      </div>
    );
  }
  if (run.status === "FAILED") {
    return (
      <div
        role="alert"
        className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm"
      >
        <p className="font-medium text-red-600">Generation failed.</p>
        {run.error ? <p className="mt-1 text-red-600">{run.error}</p> : null}
      </div>
    );
  }
  return (
    <p
      role="status"
      className="mb-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]"
    >
      Run in progress — refresh this page to see the result.
    </p>
  );
}

/** Template workbench: mapping editor, single-record preview + batch
 *  generation, and the template's run history. */
export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    run?: string;
    recq?: string;
    confirm?: string;
  }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const template = await getTemplate(user.orgId, id);
  if (!template) notFound();

  const sp = await searchParams;
  const canWrite = can(user.role, "template:write");
  const canRun = can(user.role, "generation:run");

  const recq = sp.recq?.trim() ?? "";
  const runId = z.string().uuid().safeParse(sp.run).success ? sp.run : undefined;

  const [options, runs, highlightedRun, pickerPage] = await Promise.all([
    getRecordFormOptions(user.orgId),
    listRuns(user.orgId, id),
    runId ? getRun(user.orgId, runId) : Promise.resolve(null),
    canRun
      ? listRecords(
          user.orgId,
          parseRecordFilter({
            search: recq || undefined,
            recordTypeId: template.recordTypeId ?? undefined,
            state: "all",
            includeArchived: true,
            sort: "updatedAt",
            dir: "desc",
            pageSize: 10,
          }),
        )
      : Promise.resolve(null),
  ]);

  // The ?run= banner only applies to this template's runs.
  const outcomeRun =
    highlightedRun && highlightedRun.templateId === template.id ? highlightedRun : null;

  /* Mapping-source catalog, grouped for the editor: fixed record fields first,
   * then each record type's custom fields (the template's own type leading).
   * The server accepts any org custom field regardless of the chosen type, so
   * every group stays selectable. */
  const typeNames = new Map(options.recordTypes.map((t) => [t.id, t.name]));
  const customByType = new Map<string, { path: string; label: string }[]>();
  for (const f of options.customFields) {
    const list = customByType.get(f.recordTypeId) ?? [];
    list.push({ path: customSourcePath(f.key), label: f.label });
    customByType.set(f.recordTypeId, list);
  }
  const sourceGroups: MappingSourceGroup[] = [
    { label: "Record fields", sources: MAPPING_SOURCES },
    ...[...customByType.entries()]
      .sort(([a], [b]) =>
        a === template.recordTypeId ? -1 : b === template.recordTypeId ? 1 : 0,
      )
      .map(([typeId, sources]) => ({
        label: `${typeNames.get(typeId) ?? "Other"} — custom fields`,
        sources,
      })),
  ];

  const pickerRecords =
    pickerPage?.rows.map((r) => ({
      id: r.id,
      label:
        [r.reference, r.title].filter(Boolean).join(" — ") +
        (r.isArchived ? " (archived)" : ""),
    })) ?? [];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={template.name}
          subtitle={
            [template.recordTypeName ?? "Any record type", template.description]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        />
        <Link href="/templates" className="text-sm text-[var(--muted-foreground)] hover:underline">
          ← All templates
        </Link>
      </div>

      {sp.saved ? (
        <p
          role="status"
          className="mb-4 rounded-[var(--radius)] border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
        >
          Saved.
        </p>
      ) : null}
      {sp.error === "forbidden" ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          Your role ({user.role}) doesn’t have permission to do that.
        </p>
      ) : sp.error && ERROR_MESSAGES[sp.error] ? (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {ERROR_MESSAGES[sp.error]}
        </p>
      ) : null}
      {!template.isActive ? (
        <p className="mb-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
          This template is inactive — it can’t be used to generate documents
          {canWrite ? " until it’s activated again" : ""}.
        </p>
      ) : null}
      {outcomeRun ? <RunOutcome run={outcomeRun} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ Mapping editor */}
        <Card>
          <CardTitle className="mb-1">Placeholder mappings</CardTitle>
          <CardDescription className="mb-4">
            Bind each discovered {"{placeholder}"} to the data it should merge.
          </CardDescription>
          <MappingEditor
            action={updateTemplateMappings}
            template={{
              id: template.id,
              name: template.name,
              description: template.description ?? "",
              recordTypeId: template.recordTypeId ?? "",
              outputNamePattern: template.outputNamePattern ?? "",
              placeholders: template.placeholders,
              fieldMappings: template.fieldMappings,
            }}
            recordTypes={options.recordTypes}
            sourceGroups={sourceGroups}
            readOnly={!canWrite}
          />
        </Card>

        {/* ------------------------------------------------ Sidebar */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle className="mb-3">Template file</CardTitle>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-[var(--muted-foreground)]">Original</dt>
              <dd>
                <a href={`/api/templates/${template.id}/file`} className="underline">
                  Download .docx
                </a>
              </dd>
              <dt className="text-[var(--muted-foreground)]">Placeholders</dt>
              <dd className="tabular-nums">{template.placeholders.length}</dd>
              <dt className="text-[var(--muted-foreground)]">Uploaded by</dt>
              <dd>{template.createdByName ?? template.createdByEmail ?? "—"}</dd>
              <dt className="text-[var(--muted-foreground)]">Updated</dt>
              <dd className="font-mono text-xs leading-5">{ymd(template.updatedAt)}</dd>
              <dt className="text-[var(--muted-foreground)]">Active</dt>
              <dd>{template.isActive ? "Yes" : "No"}</dd>
            </dl>
          </Card>

          {canWrite ? (
            <Card>
              <CardTitle>
                {template.isActive ? "Deactivate or delete" : "Activate or delete"}
              </CardTitle>
              <CardDescription className="mb-3">
                Inactive templates keep their history but can’t generate documents.
              </CardDescription>
              <div className="flex flex-col gap-3">
                <form action={toggleTemplateActive}>
                  <input type="hidden" name="id" value={template.id} />
                  <Button type="submit" variant="outline">
                    {template.isActive ? "Deactivate template" : "Activate template"}
                  </Button>
                </form>

                {runs.length > 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    This template has {runs.length} generation run
                    {runs.length === 1 ? "" : "s"}, so it can’t be deleted — run
                    history is kept. Deactivate it instead.
                  </p>
                ) : sp.confirm === "delete" ? (
                  <div className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-3 text-sm">
                    <p className="font-medium text-red-600">Delete this template?</p>
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      The uploaded .docx and its mappings are removed permanently.
                      This can’t be undone.
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <form action={deleteTemplate}>
                        <input type="hidden" name="id" value={template.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          className="border-red-500/40 text-red-600"
                        >
                          Yes, delete permanently
                        </Button>
                      </form>
                      <Link href={`/templates/${template.id}`} className="text-sm underline">
                        Cancel
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Link
                    href={`/templates/${template.id}?confirm=delete`}
                    className="text-sm text-red-600 underline"
                  >
                    Delete template…
                  </Link>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------ Generate */}
      <Card className="mt-6">
        <CardTitle className="mb-1">Generate documents</CardTitle>
        <CardDescription className="mb-4">
          Preview one record first, then merge a whole filtered batch.
        </CardDescription>

        {!canRun ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Your role ({user.role}) can view templates and download files, but
            can’t generate documents.
          </p>
        ) : !template.isActive ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            This template is inactive — activate it to generate documents.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Single-record preview */}
            <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
              <h4 id="preview-heading" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Single-record preview
              </h4>
              <form
                method="get"
                action={`/templates/${template.id}`}
                className="flex flex-wrap items-end gap-2"
              >
                <Field label="Find a record" htmlFor="preview-search">
                  <Input
                    id="preview-search"
                    name="recq"
                    type="search"
                    defaultValue={recq}
                    placeholder="Search reference, title, subject…"
                    className="w-72"
                  />
                </Field>
                <Button type="submit" variant="outline">
                  Search
                </Button>
              </form>
              <PreviewPicker templateId={template.id} records={pickerRecords} />
              <p className="text-xs text-[var(--muted-foreground)]">
                Previews render on the fly and don’t create a run. If placeholders
                are unmapped, the preview names them instead of rendering.
              </p>
            </section>

            {/* Batch generation */}
            <section
              aria-labelledby="batch-heading"
              className="border-t border-[var(--border)] pt-6"
            >
              <h4 id="batch-heading" className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Batch generation
              </h4>
              <form action={runGeneration} className="flex flex-col gap-4">
                <input type="hidden" name="templateId" value={template.id} />

                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Search" htmlFor="gen-search">
                    <Input
                      id="gen-search"
                      name="search"
                      type="search"
                      placeholder="Reference, title, subject…"
                      className="w-56"
                    />
                  </Field>
                  <Field label="Record type" htmlFor="gen-type">
                    <Select id="gen-type" name="type" defaultValue={template.recordTypeId ?? ""}>
                      <option value="">All types</option>
                      {options.recordTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Status" htmlFor="gen-status">
                    <Select id="gen-status" name="status" defaultValue="">
                      <option value="">All statuses</option>
                      {options.statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.category === "CLOSED" ? " (closed)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Assignee" htmlFor="gen-assignee">
                    <Select id="gen-assignee" name="assignee" defaultValue="">
                      <option value="">Anyone</option>
                      {options.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name ?? m.email}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Open or closed" htmlFor="gen-state">
                    <Select id="gen-state" name="state" defaultValue="active">
                      <option value="active">Active</option>
                      <option value="closed">Closed</option>
                      <option value="all">All states</option>
                    </Select>
                  </Field>
                  <Field label="Due on or after" htmlFor="gen-due-from">
                    <Input id="gen-due-from" name="dueFrom" type="date" />
                  </Field>
                  <Field label="Due on or before" htmlFor="gen-due-to">
                    <Input id="gen-due-to" name="dueTo" type="date" />
                  </Field>
                  <label className="flex items-center gap-2 pb-2 text-sm text-[var(--muted-foreground)]">
                    <input type="checkbox" name="archived" value="1" />
                    Include archived
                  </label>
                </div>

                <fieldset>
                  <legend className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">
                    Output format
                  </legend>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-start gap-2 text-sm">
                      <input type="radio" name="outputMode" value="DOCX" defaultChecked className="mt-1" />
                      <span>
                        <span className="font-medium">DOCX</span>{" "}
                        <span className="text-[var(--muted-foreground)]">
                          — editable Word documents (a single file for one record,
                          a zip for a batch).
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="radio" name="outputMode" value="PDF" className="mt-1" />
                      <span>
                        <span className="font-medium">PDF</span>{" "}
                        <span className="text-[var(--muted-foreground)]">
                          — finished PDFs rendered by the built-in converter.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="radio" name="outputMode" value="ZIP" className="mt-1" />
                      <span>
                        <span className="font-medium">ZIP</span>{" "}
                        <span className="text-[var(--muted-foreground)]">
                          — both the .docx and the .pdf for every record, in one zip.
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit">Generate documents</Button>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Runs the filter above (capped at {GENERATION_RECORD_CAP} records)
                    and records the run below.
                  </p>
                </div>
              </form>
            </section>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ Run history */}
      <Card className="mt-6 p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <CardTitle>Run history</CardTitle>
        </div>
        {runs.length === 0 ? (
          <p className="p-5 pt-3 text-sm text-[var(--muted-foreground)]">
            No generation runs for this template yet.
            {canRun && template.isActive ? " Generate the first batch above." : ""}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)]">
                <tr>
                  <th className="p-3 font-medium">When</th>
                  <th className="p-3 font-medium">By</th>
                  <th className="p-3 font-medium">Mode</th>
                  <th className="p-3 font-medium">Records</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Warnings</th>
                  <th className="p-3 font-medium">Artifact</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-[var(--border)] last:border-b-0 align-top",
                      r.id === runId && "bg-[var(--muted)]",
                    )}
                  >
                    <td className="p-3 font-mono text-xs">{runTimestamp(r.createdAt)}</td>
                    <td className="p-3">{r.createdByName ?? r.createdByEmail ?? "—"}</td>
                    <td className="p-3">{r.outputMode}</td>
                    <td className="p-3 tabular-nums">{r.recordCount}</td>
                    <td className="max-w-72 p-3">
                      <RunStatusBadge status={r.status} />
                      {r.status === "FAILED" && r.error ? (
                        <p className="mt-1 text-xs text-red-600">{r.error}</p>
                      ) : null}
                    </td>
                    <td className="max-w-64 p-3">
                      <WarningsDetails warnings={r.warnings} />
                    </td>
                    <td className="p-3">
                      {r.status === "COMPLETED" && r.resultStorageKey ? (
                        <a href={`/api/runs/${r.id}/artifact`} className="underline">
                          Download
                        </a>
                      ) : (
                        <span className="text-[var(--muted-foreground)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
