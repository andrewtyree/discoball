/**
 * Webhook payload signing — HMAC-SHA256 over the raw request body, sent as
 * `X-Discoball-Signature: sha256=<hex>`. Receivers recompute the HMAC with
 * their copy of the secret and compare (constant-time) before trusting the
 * payload; see scripts/webhook-receiver.mjs for a reference verifier.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "X-Discoball-Signature";
export const EVENT_HEADER = "X-Discoball-Event";
export const DELIVERY_HEADER = "X-Discoball-Delivery";

/** `sha256=<hex hmac>` for one raw body. */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

/** Constant-time signature check (for receivers / tests). */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhookBody(secret, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
