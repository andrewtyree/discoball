import { describe, expect, it } from "vitest";

import {
  formatLogLine,
  parseLogLevel,
  serializeError,
  shouldLog,
} from "@/lib/logger";

const AT = new Date("2026-07-08T12:00:00.000Z");

describe("shouldLog", () => {
  it("suppresses levels below the threshold", () => {
    expect(shouldLog("debug", "info")).toBe(false);
    expect(shouldLog("info", "warn")).toBe(false);
    expect(shouldLog("warn", "error")).toBe(false);
  });

  it("passes levels at or above the threshold", () => {
    expect(shouldLog("info", "info")).toBe(true);
    expect(shouldLog("error", "info")).toBe(true);
    expect(shouldLog("error", "error")).toBe(true);
    expect(shouldLog("debug", "debug")).toBe(true);
  });
});

describe("parseLogLevel", () => {
  it("accepts every valid level", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("error")).toBe("error");
  });

  it("defaults to info for unset or junk values", () => {
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("")).toBe("info");
    expect(parseLogLevel("verbose")).toBe("info");
    expect(parseLogLevel("INFO")).toBe("info");
  });
});

describe("serializeError", () => {
  it("flattens an Error to name/message/stack", () => {
    const flat = serializeError(new RangeError("out of range"));
    expect(flat.name).toBe("RangeError");
    expect(flat.message).toBe("out of range");
    expect(flat.stack).toContain("RangeError");
  });

  it("wraps non-Error throwables", () => {
    expect(serializeError("boom")).toEqual({ name: "NonError", message: "boom" });
    expect(serializeError(42)).toEqual({ name: "NonError", message: "42" });
  });
});

describe("formatLogLine", () => {
  it("emits one JSON object with time, level, msg first", () => {
    const line = formatLogLine("info", "hello", {}, AT);
    expect(JSON.parse(line)).toEqual({
      time: "2026-07-08T12:00:00.000Z",
      level: "info",
      msg: "hello",
    });
    expect(line.startsWith('{"time":')).toBe(true);
  });

  it("merges context fields", () => {
    const parsed = JSON.parse(formatLogLine("warn", "slow query", { ms: 812, table: "records" }, AT));
    expect(parsed.ms).toBe(812);
    expect(parsed.table).toBe("records");
  });

  it("does not let context clobber reserved keys", () => {
    const parsed = JSON.parse(
      formatLogLine("error", "real", { msg: "fake", level: "info", time: "1999" }, AT),
    );
    expect(parsed.msg).toBe("real");
    expect(parsed.level).toBe("error");
    expect(parsed.time).toBe(AT.toISOString());
  });

  it("drops undefined values and expands Error values", () => {
    const parsed = JSON.parse(
      formatLogLine("error", "failed", { gone: undefined, err: new Error("nope") }, AT),
    );
    expect("gone" in parsed).toBe(false);
    expect(parsed.err.name).toBe("Error");
    expect(parsed.err.message).toBe("nope");
  });

  it("survives circular context instead of throwing", () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const parsed = JSON.parse(formatLogLine("info", "cycle", { loop }, AT));
    expect(parsed.loop.a).toBe(1);
    expect(parsed.loop.self).toBe("[circular]");
  });

  it("stringifies bigints", () => {
    const parsed = JSON.parse(formatLogLine("info", "big", { n: 9007199254740993n }, AT));
    expect(parsed.n).toBe("9007199254740993");
  });
});
