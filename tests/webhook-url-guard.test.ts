import { describe, expect, it } from "vitest";

import {
  isPrivateHost,
  privateHostsBlocked,
  webhookDeliveryProblem,
  webhookUrlProblem,
} from "@/lib/webhooks/url-guard";

const PROD = { NODE_ENV: "production" };
const DEV = { NODE_ENV: "development" };

describe("webhookUrlProblem (structural, enforced everywhere)", () => {
  it("accepts plain http(s) URLs", () => {
    expect(webhookUrlProblem("https://example.com/hooks")).toBeNull();
    expect(webhookUrlProblem("http://example.com:8080/x?y=1")).toBeNull();
  });

  it("rejects non-http schemes, garbage, and embedded credentials", () => {
    expect(webhookUrlProblem("ftp://example.com")).toMatch(/http/);
    expect(webhookUrlProblem("file:///etc/passwd")).toMatch(/http/);
    expect(webhookUrlProblem("not a url")).toMatch(/valid URL/);
    expect(webhookUrlProblem("https://user:pw@example.com/")).toMatch(/credentials/);
  });
});

describe("isPrivateHost", () => {
  it.each([
    "localhost",
    "sub.localhost",
    "printer.local",
    "127.0.0.1",
    "127.9.9.9",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.0.1",
  ])("flags %s", (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(["example.com", "8.8.8.8", "172.32.0.1", "11.0.0.1", "2606:4700::1111"])(
    "allows %s",
    (host) => {
      expect(isPrivateHost(host)).toBe(false);
    },
  );
});

describe("privateHostsBlocked", () => {
  it("blocks only in production without the override", () => {
    expect(privateHostsBlocked(PROD)).toBe(true);
    expect(privateHostsBlocked({ ...PROD, ALLOW_PRIVATE_WEBHOOKS: "1" })).toBe(false);
    expect(privateHostsBlocked(DEV)).toBe(false);
    expect(privateHostsBlocked({})).toBe(false);
  });
});

describe("webhookDeliveryProblem", () => {
  it("lets localhost through in dev (the demo receiver)", () => {
    expect(webhookDeliveryProblem("http://localhost:9999/hook", DEV)).toBeNull();
  });

  it("blocks private hosts in production", () => {
    expect(webhookDeliveryProblem("http://localhost:9999/hook", PROD)).toMatch(/public/);
    expect(webhookDeliveryProblem("http://10.1.2.3/hook", PROD)).toMatch(/public/);
    expect(webhookDeliveryProblem("https://example.com/hook", PROD)).toBeNull();
  });

  it("still applies structural rules in every environment", () => {
    expect(webhookDeliveryProblem("file:///x", DEV)).toMatch(/http/);
  });
});
