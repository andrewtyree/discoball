"use server";
/**
 * Saved-view mutations.
 *
 * A saved view is a named, reusable record-list filter (the URL search params,
 * validated and normalized). Any member may save personal views — including
 * VIEWERs, since a view only reads. Sharing a view with the whole org requires
 * record:write; deleting someone else's shared view requires config:write.
 */
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { requireSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import {
  recordFilterFromSearchParams,
  recordFilterToSearchParams,
} from "@/lib/records/filters";

export type SavedViewFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

/**
 * Normalize a raw query string into the stored filter shape: parse through the
 * filter schema (dropping unknown keys and invalid values), reset to page 1,
 * and keep only non-default params. Applying the view later replays these
 * through the same parser.
 */
function normalizeViewFilter(raw: string): Record<string, string> {
  const params: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    const existing = params[k];
    if (existing === undefined) params[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else params[k] = [existing, v];
  }
  const filter = recordFilterFromSearchParams(params);
  filter.page = 1;
  return Object.fromEntries(recordFilterToSearchParams(filter).entries());
}

export async function createSavedView(
  _prev: SavedViewFormState,
  formData: FormData,
): Promise<SavedViewFormState> {
  const user = await requireSessionUser();

  const parsed = z
    .object({
      name: z.string().trim().min(1, "Give the view a name.").max(100),
      params: z.string().max(2000),
      shared: z.literal("1").optional(),
    })
    .safeParse({
      name: formData.get("name") ?? "",
      params: formData.get("params") ?? "",
      shared: formData.get("shared") ?? undefined,
    });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const isShared = parsed.data.shared === "1";
  if (isShared && !can(user.role, "record:write")) {
    return {
      status: "error",
      message: `Your role (${user.role}) can save personal views, but not share them.`,
    };
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.savedViews)
      .values({
        orgId: user.orgId,
        userId: user.id,
        name: parsed.data.name,
        entity: "records",
        filter: normalizeViewFilter(parsed.data.params),
        isShared,
      })
      .returning({ id: schema.savedViews.id });

    await tx.insert(schema.auditLog).values({
      orgId: user.orgId,
      userId: user.id,
      entity: "saved_view",
      entityId: row.id,
      action: "create",
      diff: { name: parsed.data.name, shared: isShared },
    });
  });

  revalidatePath("/records");
  return { status: "success" };
}

export async function deleteSavedView(formData: FormData): Promise<void> {
  const user = await requireSessionUser();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  const [view] = await db
    .select()
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.id, id.data), eq(schema.savedViews.orgId, user.orgId)));
  if (!view) return;

  const isMine = view.userId === user.id;
  if (!isMine && !(view.isShared && can(user.role, "config:write"))) return;

  await db.transaction(async (tx) => {
    await tx.delete(schema.savedViews).where(eq(schema.savedViews.id, view.id));
    await tx.insert(schema.auditLog).values({
      orgId: user.orgId,
      userId: user.id,
      entity: "saved_view",
      entityId: view.id,
      action: "delete",
      diff: { name: view.name },
    });
  });

  revalidatePath("/records");
}
