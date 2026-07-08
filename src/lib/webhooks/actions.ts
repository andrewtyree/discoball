"use server";
/**
 * Webhook settings mutations — create, toggle, delete, test, redeliver.
 *
 * Same authorization pattern as the config editors: session → RBAC
 * (`config:write`) → validate → org-scoped write → audit; the page is a
 * plain server-component form, so outcomes travel as query params. Test and
 * redeliver run the delivery inline (not via after()) — the user clicked a
 * button and wants the outcome on the next render.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@/db";
import { requireSessionUser } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { deliverWebhook, WEBHOOK_EVENTS, type WebhookEvent } from "./dispatch";
import { getDeliveryWithWebhook, getWebhook } from "./queries";
import { webhookDeliveryProblem } from "./url-guard";

const PATH = "/settings/webhooks";

async function requireWebhookUser() {
  const user = await requireSessionUser();
  if (!can(user.role, "config:write")) redirect(`${PATH}?error=forbidden`);
  return user;
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  user: { orgId: string; id: string },
  entityId: string,
  action: string,
  diff?: Record<string, unknown>,
) {
  await tx.insert(schema.auditLog).values({
    orgId: user.orgId,
    userId: user.id,
    entity: "webhook",
    entityId,
    action,
    diff: diff ?? null,
  });
}

const KNOWN_EVENTS = WEBHOOK_EVENTS.map((e) => e.event);

export async function createWebhook(formData: FormData): Promise<void> {
  const user = await requireWebhookUser();

  const urlParse = z.string().trim().max(2000).safeParse(formData.get("url"));
  if (!urlParse.success || urlParse.data === "") redirect(`${PATH}?error=invalid`);
  const url = urlParse.data;

  const problem = webhookDeliveryProblem(url);
  if (problem) redirect(`${PATH}?error=url&detail=${encodeURIComponent(problem)}`);

  const events = formData
    .getAll("events")
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is WebhookEvent => (KNOWN_EVENTS as string[]).includes(v));
  if (events.length === 0) redirect(`${PATH}?error=no_events`);

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.webhooks)
      .values({
        orgId: user.orgId,
        url,
        secret: randomBytes(32).toString("hex"),
        events,
        createdById: user.id,
      })
      .returning({ id: schema.webhooks.id });
    await audit(tx, user, row.id, "webhook_create", { url, events });
  });

  revalidatePath(PATH);
  redirect(`${PATH}?ok=1`);
}

export async function toggleWebhook(formData: FormData): Promise<void> {
  const user = await requireWebhookUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect(`${PATH}?error=invalid`);
  const id = idParse.data;

  const hook = await getWebhook(user.orgId, id);
  if (!hook) redirect(`${PATH}?error=invalid`);

  await db.transaction(async (tx) => {
    await tx
      .update(schema.webhooks)
      .set({ isActive: !hook.isActive })
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, user.orgId)));
    await audit(tx, user, id, "webhook_update", {
      isActive: { from: hook.isActive, to: !hook.isActive },
    });
  });

  revalidatePath(PATH);
  redirect(`${PATH}?ok=1`);
}

export async function deleteWebhook(formData: FormData): Promise<void> {
  const user = await requireWebhookUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect(`${PATH}?error=invalid`);
  const id = idParse.data;

  const hook = await getWebhook(user.orgId, id);
  if (!hook) redirect(`${PATH}?error=invalid`);

  // Deliveries cascade with the webhook row.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.webhooks)
      .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, user.orgId)));
    await audit(tx, user, id, "webhook_delete", { url: hook.url });
  });

  revalidatePath(PATH);
  redirect(`${PATH}?ok=1`);
}

/** Fire a `ping` event at one webhook, inline, and show the outcome. */
export async function sendTestEvent(formData: FormData): Promise<void> {
  const user = await requireWebhookUser();

  const idParse = z.string().uuid().safeParse(formData.get("id"));
  if (!idParse.success) redirect(`${PATH}?error=invalid`);
  const id = idParse.data;

  const hook = await getWebhook(user.orgId, id);
  if (!hook) redirect(`${PATH}?error=invalid`);

  const payload = {
    message: "DiscoBall webhook test",
    org: user.orgId,
    sentBy: user.email,
  };
  const [delivery] = await db
    .insert(schema.webhookDeliveries)
    .values({ orgId: user.orgId, webhookId: hook.id, event: "ping", payload })
    .returning({ id: schema.webhookDeliveries.id });

  await deliverWebhook(hook, delivery.id, "ping", payload);

  await db.transaction(async (tx) => {
    await audit(tx, user, id, "webhook_test");
  });

  revalidatePath(PATH);
  redirect(`${PATH}?tested=1`);
}

/** Re-send a failed delivery's exact payload, as a fresh attempt. */
export async function redeliverWebhook(formData: FormData): Promise<void> {
  const user = await requireWebhookUser();

  const idParse = z.string().uuid().safeParse(formData.get("deliveryId"));
  if (!idParse.success) redirect(`${PATH}?error=invalid`);

  const found = await getDeliveryWithWebhook(user.orgId, idParse.data);
  if (!found) redirect(`${PATH}?error=invalid`);
  const { delivery, webhook } = found;

  const [fresh] = await db
    .insert(schema.webhookDeliveries)
    .values({
      orgId: user.orgId,
      webhookId: webhook.id,
      event: delivery.event,
      payload: delivery.payload,
      attempt: delivery.attempt + 1,
    })
    .returning({ id: schema.webhookDeliveries.id });

  await deliverWebhook(webhook, fresh.id, delivery.event as WebhookEvent, delivery.payload);

  revalidatePath(PATH);
  redirect(`${PATH}?tested=1`);
}
