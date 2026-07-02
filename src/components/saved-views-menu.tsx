"use client";
/**
 * Saved views: pick a named filter to apply it, save the current filter as a
 * new view, or delete a view you own. Applying a view just navigates to its
 * stored search params — the table's URL-driven state does the rest.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useActionState } from "react";
import { Bookmark, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  createSavedView,
  deleteSavedView,
  type SavedViewFormState,
} from "@/lib/records/view-actions";

export interface SavedViewItem {
  id: string;
  name: string;
  isShared: boolean;
  /** Normalized URL search params this view applies. */
  params: string;
  canDelete: boolean;
}

const IDLE: SavedViewFormState = { status: "idle" };

export function SavedViewsMenu({
  views,
  currentParams,
  canShare,
}: {
  views: SavedViewItem[];
  /** The current filter, normalized the same way stored views are. */
  currentParams: string;
  canShare: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [state, formAction, isPending] = useActionState(createSavedView, IDLE);
  const formRef = useRef<HTMLFormElement>(null);

  const active = views.find((v) => v.params === currentParams);

  useEffect(() => {
    if (state.status === "success") {
      setSaving(false);
      formRef.current?.reset();
    }
  }, [state]);

  const applyView = (id: string) => {
    const view = views.find((v) => v.id === id);
    startTransition(() => {
      router.push(view?.params ? `${pathname}?${view.params}` : pathname, { scroll: false });
    });
  };

  const personal = views.filter((v) => !v.isShared);
  const shared = views.filter((v) => v.isShared);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select
        value={active?.id ?? ""}
        onChange={(e) => applyView(e.target.value)}
        aria-label="Saved views"
      >
        <option value="">{active ? "All records" : "Views…"}</option>
        {personal.length > 0 ? (
          <optgroup label="My views">
            {personal.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {shared.length > 0 ? (
          <optgroup label="Shared with the organization">
            {shared.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>

      {active?.canDelete ? (
        <form action={deleteSavedView}>
          <input type="hidden" name="id" value={active.id} />
          <Button
            type="submit"
            variant="ghost"
            className="px-2.5"
            aria-label={`Delete view “${active.name}”`}
            title={`Delete view “${active.name}”`}
          >
            <Trash2 size={15} aria-hidden />
          </Button>
        </form>
      ) : null}

      {saving ? (
        <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="params" value={currentParams} />
          <Input
            name="name"
            required
            maxLength={100}
            placeholder="View name"
            aria-label="View name"
            className="w-44"
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          {canShare ? (
            <label className="flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
              <input type="checkbox" name="shared" value="1" />
              Share with org
            </label>
          ) : null}
          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSaving(false)}>
            Cancel
          </Button>
          {state.status === "error" ? (
            <span role="alert" className="text-sm text-red-600">
              {state.message}
            </span>
          ) : null}
        </form>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setSaving(true)}
          className="px-3"
        >
          <Bookmark size={15} aria-hidden />
          Save current view
        </Button>
      )}
    </div>
  );
}
