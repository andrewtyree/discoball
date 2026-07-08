/**
 * Webhook dispatch — fan one record event out to every subscribed webhook.
 *
 * Mutations call `emitRecordEvent` inside `after()` (next/server) right
 * after their transaction commits: the callback runs once the response —
 * including the redirect — has been sent, so delivery latency never blocks
 * the UI, and the work is sanctioned to finish post-response.
 *
 * Every attempt is recorded as a `webhook_deliveries` row (PENDING →
 * SUCCESS/FAILED with the HTTP status or error), so dispatch is debuggable
 * without a job queue. There are no automatic retries — failures stay
 * visible in /settings/webhooks with a manual Redeliver button; production
 * would move this behind an outbox + queue (see docs/ops.md).
 *
 * Requests carry:
 *   X-Discoball-Event:     the event name
 *   X-Discoball-Delivery:  the delivery row id
 *   X-Discoball-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>
 */
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { logger } from "@/lib/logger";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signWebhookBody } from "./sign";
import { webhookDeliveryProblem } from "./url-guard";

export type WebhookEvent =
  | "record.created"
  | "record.updated"
  | "record.archived"
  | "record.imported"
  | "ping";

export const WEBHOOK_EVENTS: { event: WebhookEvent; label: string }[] = [
  { event: "record.created", label: "Record created" },
  { event: "record.updated", label: "Record updated" },
  { event: "record.archived", label: "Record archived or restored" },
  { event: "record.imported", label: "CSV import completed (one batch event)" },
];

/** Delivery timeout — a webhook receiver gets this long to respond. */
const DELIVERY_TIMEOUT_MS = 10_000;

const log = logger.child({ module: "webhooks" });

interface WebhookRow {
  id: string;
  orgId: string;
  url: string;
  secret: string;
}

/**
 * POST one event to one webhook and record the outcome on an existing
 * PENDING delivery row. Never throws — failures become FAILED rows + a log
 * line. Shared by event fan-out, the test button, and redelivery.
 */
export async function deliverWebhook(
  hook: WebhookRow,
  deliveryId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({ event, deliveryId, payload });

  const finish = async (patch: {
    status: "SUCCESS" | "FAILED";
    responseStatus?: number;
    error?: string;
  }) => {
    await db
      .update(schema.webhookDeliveries)
      .set({ ...patch, completedAt: new Date() })
      .where(eq(schema.webhookDeliveries.id, deliveryId));
  };

  // Re-check at delivery time: the environment (or the URL row) may have
  // changed since the webhook was created.
  const urlProblem = webhookDeliveryProblem(hook.url);
  if (urlProblem) {
    await finish({ status: "FAILED", error: urlProblem });
    log.warn("webhook delivery blocked", { webhookId: hook.id, deliveryId, event, urlProblem });
    return;
  }

  try {
    const response = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [EVENT_HEADER]: event,
        [DELIVERY_HEADER]: deliveryId,
        [SIGNATURE_HEADER]: signWebhookBody(hook.secret, body),
      },
      body,
      // A redirect would re-aim the (signed) request — refuse instead.
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    const ok = response.status >= 200 && response.status < 300;
    await finish({
      status: ok ? "SUCCESS" : "FAILED",
      responseStatus: response.status,
      ...(ok ? {} : { error: `Receiver responded ${response.status}.` }),
    });
    log[ok ? "info" : "warn"]("webhook delivered", {
      webhookId: hook.id,
      deliveryId,
      event,
      responseStatus: response.status,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? `Receiver did not respond within ${DELIVERY_TIMEOUT_MS / 1000}s.`
        : err instanceof Error
          ? err.message
          : String(err);
    await finish({ status: "FAILED", error: message.slice(0, 500) });
    log.warn("webhook delivery failed", { webhookId: hook.id, deliveryId, event, err });
  }
}

/**
 * Fan one event out to every active webhook in the org subscribed to it.
 * Deliveries run concurrently; the function resolves when all outcomes are
 * recorded. Never throws.
 */
export async function emitRecordEvent(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await db
      .select({
        id: schema.webhooks.id,
        orgId: schema.webhooks.orgId,
        url: schema.webhooks.url,
        secret: schema.webhooks.secret,
        events: schema.webhooks.events,
        isActive: schema.webhooks.isActive,
      })
      .from(schema.webhooks)
      .where(eq(schema.webhooks.orgId, orgId));

    const subscribed = hooks.filter((h) => h.isActive && h.events.includes(event));
    if (subscribed.length === 0) return;

    await Promise.all(
      subscribed.map(async (hook) => {
        const [delivery] = await db
          .insert(schema.webhookDeliveries)
          .values({ orgId, webhookId: hook.id, event, payload })
          .returning({ id: schema.webhookDeliveries.id });
        await deliverWebhook(hook, delivery.id, event, payload);
      }),
    );
  } catch (err) {
    // Webhooks are best-effort by design — never let dispatch break the
    // mutation that triggered it.
    log.error("webhook fan-out failed", { orgId, event, err });
  }
}
