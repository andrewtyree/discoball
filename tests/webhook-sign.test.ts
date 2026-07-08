import { describe, expect, it } from "vitest";

import { signWebhookBody, verifyWebhookSignature } from "@/lib/webhooks/sign";

describe("signWebhookBody", () => {
  it("produces the documented sha256=<hex> form against a fixed vector", () => {
    // Fixed vector: HMAC-SHA256("secret", "hello") — stable across runtimes,
    // so a receiver implemented from the docs interoperates.
    expect(signWebhookBody("secret", "hello")).toBe(
      "sha256=88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b",
    );
  });

  it("changes with body and secret", () => {
    const base = signWebhookBody("secret", "hello");
    expect(signWebhookBody("secret", "hello!")).not.toBe(base);
    expect(signWebhookBody("other", "hello")).not.toBe(base);
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a matching signature", () => {
    const body = JSON.stringify({ event: "ping", payload: { a: 1 } });
    const sig = signWebhookBody("k", body);
    expect(verifyWebhookSignature("k", body, sig)).toBe(true);
  });

  it("rejects a tampered body, wrong key, or malformed signature", () => {
    const body = "payload";
    const sig = signWebhookBody("k", body);
    expect(verifyWebhookSignature("k", "payload2", sig)).toBe(false);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature("k", body, "sha256=nope")).toBe(false);
    expect(verifyWebhookSignature("k", body, "")).toBe(false);
  });
});
