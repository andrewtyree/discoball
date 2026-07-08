import { describe, expect, it } from "vitest";

import { clientIpFrom } from "@/lib/request-ip";

describe("clientIpFrom", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    expect(clientIpFrom(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "198.51.100.4",
    });
    expect(clientIpFrom(headers)).toBe("203.0.113.7");
  });

  it("returns 'unknown' when nothing usable is present", () => {
    expect(clientIpFrom(new Headers())).toBe("unknown");
    expect(clientIpFrom(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
