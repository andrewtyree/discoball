import { describe, expect, it } from "vitest";

import {
  customFieldName,
  formatCustomValue,
  parseCustomValues,
  snapshotCustomValues,
  type CustomFieldDef,
} from "@/lib/records/custom-fields";

const RT = "11111111-1111-1111-1111-111111111111";

function def(partial: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "fieldType">): CustomFieldDef {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    label: partial.key,
    options: [],
    required: false,
    recordTypeId: RT,
    ...partial,
  };
}

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

describe("parseCustomValues", () => {
  it("parses each field type into its stored shape", () => {
    const defs = [
      def({ key: "court", fieldType: "TEXT" }),
      def({ key: "amount", fieldType: "NUMBER" }),
      def({ key: "filed", fieldType: "DATE" }),
      def({ key: "expedited", fieldType: "BOOLEAN" }),
      def({ key: "venue", fieldType: "SELECT", options: ["North", "South"] }),
      def({ key: "tags", fieldType: "MULTI_SELECT", options: ["a", "b", "c"] }),
    ];
    const result = parseCustomValues(
      defs,
      form({
        cf_court: "  District 9 ",
        cf_amount: "1250.75",
        cf_filed: "2026-07-01",
        cf_expedited: "1",
        cf_venue: "South",
        cf_tags: ["a", "c"],
      }),
    );
    expect(result).toEqual({
      ok: true,
      values: {
        court: "District 9",
        amount: 1250.75,
        filed: "2026-07-01",
        expedited: true,
        venue: "South",
        tags: ["a", "c"],
      },
    });
  });

  it("omits empty optional values but always stores booleans", () => {
    const defs = [
      def({ key: "notes", fieldType: "TEXT" }),
      def({ key: "flag", fieldType: "BOOLEAN" }),
    ];
    const result = parseCustomValues(defs, form({}));
    expect(result).toEqual({ ok: true, values: { flag: false } });
  });

  it("rejects a missing required value with the field label", () => {
    const defs = [def({ key: "court", label: "Court", fieldType: "TEXT", required: true })];
    expect(parseCustomValues(defs, form({}))).toEqual({
      ok: false,
      error: "Court is required.",
    });
  });

  it("rejects a non-numeric NUMBER", () => {
    const defs = [def({ key: "amount", label: "Amount", fieldType: "NUMBER" })];
    expect(parseCustomValues(defs, form({ cf_amount: "12x" }))).toEqual({
      ok: false,
      error: "Amount must be a number.",
    });
  });

  it("rejects a malformed DATE", () => {
    const defs = [def({ key: "filed", label: "Filed", fieldType: "DATE" })];
    expect(parseCustomValues(defs, form({ cf_filed: "07/01/2026" }))).toEqual({
      ok: false,
      error: "Filed must be a valid date.",
    });
  });

  it("rejects values outside a SELECT/MULTI_SELECT vocabulary", () => {
    const defs = [
      def({ key: "venue", label: "Venue", fieldType: "SELECT", options: ["North"] }),
    ];
    expect(parseCustomValues(defs, form({ cf_venue: "West" }))).toMatchObject({ ok: false });

    const multi = [
      def({ key: "tags", label: "Tags", fieldType: "MULTI_SELECT", options: ["a"] }),
    ];
    expect(parseCustomValues(multi, form({ cf_tags: ["a", "z"] }))).toMatchObject({ ok: false });
  });

  it("rejects a non-uuid USER/CONTACT selection", () => {
    const defs = [def({ key: "lead", label: "Lead", fieldType: "USER" })];
    expect(parseCustomValues(defs, form({ cf_lead: "not-a-uuid" }))).toEqual({
      ok: false,
      error: "Lead has an invalid selection.",
    });
    expect(
      parseCustomValues(defs, form({ cf_lead: "22222222-2222-2222-2222-222222222222" })),
    ).toMatchObject({ ok: true });
  });

  it("ignores form entries with no matching definition", () => {
    const defs = [def({ key: "court", fieldType: "TEXT" })];
    const result = parseCustomValues(defs, form({ cf_rogue: "x", cf_court: "A" }));
    expect(result).toEqual({ ok: true, values: { court: "A" } });
  });
});

describe("snapshotCustomValues", () => {
  it("namespaces keys for audit diffs", () => {
    expect(snapshotCustomValues({ court: "A", amount: 3 })).toEqual({
      "custom.court": "A",
      "custom.amount": 3,
    });
    expect(snapshotCustomValues(null)).toEqual({});
  });
});

describe("formatCustomValue", () => {
  it("renders human-readable values", () => {
    expect(formatCustomValue({ fieldType: "BOOLEAN" }, true)).toBe("Yes");
    expect(formatCustomValue({ fieldType: "BOOLEAN" }, false)).toBe("No");
    expect(formatCustomValue({ fieldType: "MULTI_SELECT" }, ["a", "b"])).toBe("a, b");
    expect(formatCustomValue({ fieldType: "TEXT" }, undefined)).toBe("—");
    expect(
      formatCustomValue({ fieldType: "USER" }, "abc", (id) => (id === "abc" ? "Avery" : undefined)),
    ).toBe("Avery");
  });
});

describe("customFieldName", () => {
  it("prefixes the machine key", () => {
    expect(customFieldName("court")).toBe("cf_court");
  });
});
