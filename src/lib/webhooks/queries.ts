/**
 * Webhook queries — org-scoped reads for the settings page.
 */
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/db";

/** The org's webhooks, newest first. */
export async function listWebhooks(orgId: string) {
  return db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.orgId, orgId))
    .orderBy(desc(schema.webhooks.createdAt));
}

export type WebhookListRow = Awaited<ReturnType<typeof listWebhooks>>[number];

/** One webhook, scoped to the org. */
export async function getWebhook(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.orgId, orgId)));
  return row ?? null;
}

/** Recent deliveries across the org's webhooks, newest first. */
export async function listDeliveries(orgId: string, limit = 25) {
  return db
    .select({
      id: schema.webhookDeliveries.id,
      webhookId: schema.webhookDeliveries.webhookId,
      url: schema.webhooks.url,
      event: schema.webhookDeliveries.event,
      attempt: schema.webhookDeliveries.attempt,
      status: schema.webhookDeliveries.status,
      responseStatus: schema.webhookDeliveries.responseStatus,
      error: schema.webhookDeliveries.error,
      createdAt: schema.webhookDeliveries.createdAt,
      completedAt: schema.webhookDeliveries.completedAt,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(eq(schema.webhookDeliveries.orgId, orgId))
    .orderBy(desc(schema.webhookDeliveries.createdAt))
    .limit(limit);
}

export type DeliveryListRow = Awaited<ReturnType<typeof listDeliveries>>[number];

/** One delivery with its webhook, scoped to the org (for redelivery). */
export async function getDeliveryWithWebhook(orgId: string, deliveryId: string) {
  const [row] = await db
    .select({
      delivery: schema.webhookDeliveries,
      webhook: schema.webhooks,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhooks, eq(schema.webhookDeliveries.webhookId, schema.webhooks.id))
    .where(
      and(
        eq(schema.webhookDeliveries.id, deliveryId),
        eq(schema.webhookDeliveries.orgId, orgId),
      ),
    );
  return row ?? null;
}
