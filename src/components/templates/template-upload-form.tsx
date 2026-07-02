"use client";
/**
 * Upload form for a new .docx template. Client component only for
 * useActionState: validation problems (not a .docx, too big, bad zip) come
 * back as an inline error banner instead of losing the page, matching the
 * record-form error pattern.
 */
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import type { TemplateFormState } from "@/lib/templates/actions";

const IDLE: TemplateFormState = { status: "idle" };

/** Mirrors MAX_TEMPLATE_BYTES in lib/templates/actions.ts so oversized files
 *  never leave the browser (the server re-checks regardless). */
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export function TemplateUploadForm({
  action,
  recordTypes,
}: {
  action: (state: TemplateFormState, formData: FormData) => Promise<TemplateFormState>;
  recordTypes: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE);
  const [fileError, setFileError] = useState<string | null>(null);
  const errorMessage = fileError ?? (state.status === "error" ? state.message : null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {errorMessage ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600"
        >
          {errorMessage}
        </p>
      ) : null}

      <Field label="Template file (.docx, up to 10 MB)" htmlFor="tpl-file">
        <Input
          id="tpl-file"
          name="file"
          type="file"
          required
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            setFileError(
              f && f.size > MAX_TEMPLATE_BYTES
                ? "Template files must be 10 MB or smaller."
                : null,
            );
          }}
        />
      </Field>

      <Field label="Name (optional — defaults to the file name)" htmlFor="tpl-name">
        <Input
          id="tpl-name"
          name="name"
          maxLength={200}
          placeholder="e.g. Engagement letter"
        />
      </Field>

      <Field label="Description (optional)" htmlFor="tpl-description">
        <Textarea
          id="tpl-description"
          name="description"
          maxLength={2000}
          className="min-h-16"
          placeholder="What this template is for, and when to use it."
        />
      </Field>

      <Field label="Record type (optional)" htmlFor="tpl-record-type">
        <Select id="tpl-record-type" name="recordTypeId" defaultValue="">
          <option value="">Any record type</option>
          {recordTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="-mt-2 text-xs text-[var(--muted-foreground)]">
        Restricting to a type surfaces that type&rsquo;s custom fields first in the
        mapping editor and pre-fills the batch filter.
      </p>

      <div>
        <Button type="submit" disabled={isPending || fileError !== null}>
          {isPending ? "Uploading…" : "Upload template"}
        </Button>
      </div>
    </form>
  );
}
