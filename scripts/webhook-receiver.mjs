/**
 * Reference webhook receiver — a tiny local server for demos and for
 * verifying DiscoBall's delivery signatures.
 *
 *   WEBHOOK_SECRET=<secret from /settings/webhooks> node scripts/webhook-receiver.mjs [port]
 *
 * Prints every delivery (headers + parsed body) and verifies the
 * X-Discoball-Signature header when WEBHOOK_SECRET is set: HMAC-SHA256 of
 * the raw body, compared constant-time. Responds 200 on valid (or
 * unverified) deliveries, 401 on a bad signature.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9999);
const secret = process.env.WEBHOOK_SECRET ?? "";

function verify(body, signature) {
  if (!secret) return null; // unverified mode
  if (!signature) return false;
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`,
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const event = req.headers["x-discoball-event"] ?? "?";
    const delivery = req.headers["x-discoball-delivery"] ?? "?";
    const verdict = verify(body, req.headers["x-discoball-signature"]);

    console.log(`\n─── ${new Date().toISOString()}  ${req.method} ${req.url}`);
    console.log(`event: ${event}   delivery: ${delivery}`);
    console.log(
      `signature: ${verdict === null ? "not checked (set WEBHOOK_SECRET to verify)" : verdict ? "VALID ✓" : "INVALID ✗"}`,
    );
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      console.log(body);
    }

    if (verdict === false) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("bad signature");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(port, () => {
  console.log(`Webhook receiver listening on http://localhost:${port}/hook`);
  console.log(secret ? "Verifying signatures with WEBHOOK_SECRET." : "WEBHOOK_SECRET not set — accepting unverified.");
});
