import { describe, expect, it } from "vitest";

import { discoverPlaceholders, validateMappings } from "@/lib/templates/placeholders";

describe("discoverPlaceholders", () => {
  it("extracts unique placeholders in order", () => {
    const text = "Dear {subjectName}, re {reference} dated {openedDate}.";
    expect(discoverPlaceholders(text)).toEqual([
      "subjectName",
      "reference",
      "openedDate",
    ]);
  });

  it("deduplicates repeated placeholders", () => {
    expect(discoverPlaceholders("{a} and {a} and {b}")).toEqual(["a", "b"]);
  });

  it("ignores loop/condition section markers", () => {
    const text = "{#items}{name}{/items}{^empty}none{/empty}";
    expect(discoverPlaceholders(text)).toEqual(["items", "name", "empty"]);
  });

  it("strips formatters after a pipe", () => {
    expect(discoverPlaceholders("{dueDate | date}")).toEqual(["dueDate"]);
  });

  it("returns an empty list when there are no placeholders", () => {
    expect(discoverPlaceholders("just plain text")).toEqual([]);
  });
});

describe("validateMappings", () => {
  it("flags unmapped and unused placeholders", () => {
    const result = validateMappings(["a", "b", "c"], { a: "title", x: "stale" });
    expect(result.unmapped).toEqual(["b", "c"]);
    expect(result.unused).toEqual(["x"]);
    expect(result.isComplete).toBe(false);
  });

  it("reports complete when every placeholder is mapped", () => {
    const result = validateMappings(["a", "b"], { a: "title", b: "reference" });
    expect(result.isComplete).toBe(true);
    expect(result.unmapped).toEqual([]);
  });
});
