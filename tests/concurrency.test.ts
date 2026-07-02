import { describe, expect, it } from "vitest";

import { isStaleWrite } from "@/lib/records/concurrency";

describe("isStaleWrite", () => {
  it("accepts a write based on the current version", () => {
    expect(isStaleWrite(1, 1)).toBe(false);
    expect(isStaleWrite(7, 7)).toBe(false);
  });

  it("rejects a write based on an older version", () => {
    expect(isStaleWrite(2, 1)).toBe(true);
    expect(isStaleWrite(42, 41)).toBe(true);
  });

  it("rejects a write claiming a version the row has never reached", () => {
    // e.g. a tampered or duplicated form submission
    expect(isStaleWrite(3, 9)).toBe(true);
  });
});
