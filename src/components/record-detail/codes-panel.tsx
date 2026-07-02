/**
 * Codes tab — the controlled-vocabulary codes applied to one record. Codes
 * come from the org's code table (Settings → Codes); imported rows that never
 * matched a code keep their raw text.
 */
import Link from "next/link";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { addRecordCode, removeRecordCode } from "@/lib/records/detail-actions";
import type { listAvailableCodes, listRecordCodes } from "@/lib/records/queries";

export function CodesPanel({
  recordId,
  applied,
  available,
  canWrite,
}: {
  recordId: string;
  applied: Awaited<ReturnType<typeof listRecordCodes>>;
  available: Awaited<ReturnType<typeof listAvailableCodes>>;
  canWrite: boolean;
}) {
  // Group the vocabulary for the picker; ungrouped codes go under "Codes".
  const groups = new Map<string, typeof available>();
  for (const code of available) {
    const group = code.groupName ?? "Codes";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(code);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-0">
        {applied.length === 0 ? (
          <p className="p-6 text-sm text-[var(--muted-foreground)]">
            No codes applied to this record yet.
            {canWrite ? " Add one below." : ""}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {applied.map((rc) => (
              <li key={rc.id} className="flex items-center gap-3 p-3 text-sm">
                <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-xs">
                  {rc.code ?? rc.rawText ?? "?"}
                </span>
                <span className="font-medium">{rc.shortLabel ?? "Unmatched import text"}</span>
                {rc.description ? (
                  <span className="hidden text-[var(--muted-foreground)] md:inline">
                    {rc.description}
                  </span>
                ) : null}
                {canWrite ? (
                  <form action={removeRecordCode} className="ml-auto">
                    <input type="hidden" name="recordId" value={recordId} />
                    <input type="hidden" name="recordCodeId" value={rc.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      className="px-2 py-1"
                      aria-label={`Remove code ${rc.code ?? rc.rawText ?? ""}`}
                      title={`Remove code ${rc.code ?? rc.rawText ?? ""}`}
                    >
                      <X size={14} aria-hidden />
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canWrite ? (
        <Card>
          <CardTitle>Add a code</CardTitle>
          <CardDescription className="mb-4">
            Apply a code from the workspace vocabulary. Manage the vocabulary in{" "}
            <Link href="/settings/codes" className="underline">
              Settings → Codes
            </Link>
            .
          </CardDescription>
          {available.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No active codes defined yet.
            </p>
          ) : (
            <form action={addRecordCode} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="recordId" value={recordId} />
              <Field label="Code" htmlFor="add-code">
                <Select id="add-code" name="codeId" required defaultValue="">
                  <option value="" disabled>
                    Select a code…
                  </option>
                  {[...groups.entries()].map(([group, codes]) => (
                    <optgroup key={group} label={group}>
                      {codes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.shortLabel}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Add code</Button>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
