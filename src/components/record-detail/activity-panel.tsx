/**
 * Activity tab — the record's full audit timeline. Every mutation on the
 * record (field edits, custom values, documents, contacts, codes, archival)
 * lands here as an append-only entry with a compact before→after diff.
 */
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import type { listRecordActivity } from "@/lib/records/queries";

const ACTION_LABELS: Record<string, string> = {
  create: "created this record",
  update: "updated this record",
  archive: "archived this record",
  unarchive: "restored this record",
  document_add: "added a document",
  document_update: "updated a document",
  document_delete: "removed a document",
  contact_link: "linked a contact",
  contact_unlink: "unlinked a contact",
  code_add: "added a code",
  code_remove: "removed a code",
  event_add: "added an event",
  event_update: "updated an event",
  event_reschedule: "rescheduled an event",
  event_delete: "removed an event",
  reschedule: "rescheduled the due date",
};

/** Deterministic server-rendered timestamp (no locale surprises). */
function fmtAt(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function isFromTo(v: unknown): v is { from?: unknown; to?: unknown } {
  // JSONB storage drops `undefined` sides (e.g. `from` on a create diff, `to`
  // on a cleared field), so a one-sided object is still a from→to entry.
  return typeof v === "object" && v !== null && ("from" in v || "to" in v);
}

const MAX_DIFF_LINES = 8;

/** Render one audit entry's diff into compact, readable lines. */
function diffLines(action: string, diff: Record<string, unknown>): string[] {
  // Archival stores a bare reason; sub-entity actions store labeled values.
  if (action === "archive" || action === "unarchive") {
    const reason = (diff as { reason?: unknown }).reason;
    return reason ? [`reason: ${fmtValue(reason)}`] : [];
  }
  if (action.startsWith("document_")) {
    const lines = [`document: ${fmtValue(diff.title)}`];
    if (isFromTo(diff.status)) {
      lines.push(`status: ${fmtValue(diff.status.from)} → ${fmtValue(diff.status.to)}`);
    } else if (diff.status !== undefined) {
      lines.push(`status: ${fmtValue(diff.status)}`);
    }
    return lines;
  }
  if (action.startsWith("contact_")) {
    const lines = [`contact: ${fmtValue(diff.name)}`];
    if (diff.role) lines.push(`role: ${fmtValue(diff.role)}`);
    return lines;
  }
  if (action.startsWith("code_")) {
    return [`code: ${fmtValue(diff.code)}${diff.label ? ` (${fmtValue(diff.label)})` : ""}`];
  }
  if (action.startsWith("event_")) {
    // The title is a plain string on update/reschedule/delete but a {from,to}
    // diff entry on add (diffFields against an empty snapshot); the eventId
    // key is an internal pointer, not something to show.
    const title = diff.title;
    const lines = [`event: ${fmtValue(isFromTo(title) ? title.to : title)}`];
    for (const [key, value] of Object.entries(diff)) {
      // eventId/recordId are internal pointers; the entry already sits on the
      // record's own timeline and the title line names the event.
      if (key === "eventId" || key === "recordId" || key === "title") continue;
      if (isFromTo(value)) {
        lines.push(
          action === "event_add"
            ? `${key}: ${fmtValue(value.to)}`
            : `${key}: ${fmtValue(value.from)} → ${fmtValue(value.to)}`,
        );
      } else {
        lines.push(`${key}: ${fmtValue(value)}`);
      }
    }
    return lines;
  }

  // create/update: field-level {from, to} entries, custom fields namespaced.
  const lines: string[] = [];
  for (const [key, value] of Object.entries(diff)) {
    const label = key.startsWith("custom.") ? key.slice("custom.".length) : key;
    if (isFromTo(value)) {
      lines.push(
        action === "create"
          ? `${label}: ${fmtValue(value.to)}`
          : `${label}: ${fmtValue(value.from)} → ${fmtValue(value.to)}`,
      );
    } else {
      lines.push(`${label}: ${fmtValue(value)}`);
    }
  }
  return lines;
}

export function ActivityPanel({
  activity,
  version,
}: {
  activity: Awaited<ReturnType<typeof listRecordActivity>>;
  version: number;
}) {
  return (
    <Card>
      <CardTitle className="mb-1">Activity</CardTitle>
      <CardDescription className="mb-4">
        The append-only audit timeline for this record. Version {version}.
      </CardDescription>
      {activity.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">No activity recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-4 text-sm">
          {activity.map((entry) => {
            const lines = entry.diff ? diffLines(entry.action, entry.diff) : [];
            return (
              <li key={entry.id} className="border-l-2 border-[var(--border)] pl-3">
                <div>
                  <span className="font-medium">
                    {entry.userName ?? entry.userEmail ?? "System"}
                  </span>{" "}
                  <span className="text-[var(--muted-foreground)]">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                </div>
                {lines.length > 0 ? (
                  <ul className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {lines.slice(0, MAX_DIFF_LINES).map((line, i) => (
                      <li key={i} className="truncate">
                        {line}
                      </li>
                    ))}
                    {lines.length > MAX_DIFF_LINES ? (
                      <li>…and {lines.length - MAX_DIFF_LINES} more</li>
                    ) : null}
                  </ul>
                ) : null}
                <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {fmtAt(entry.at)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
