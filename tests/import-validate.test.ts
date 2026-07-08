import { describe, expect, it } from "vitest";

import { formatCustomExportValue } from "@/lib/export/columns";
import type { CustomFieldDef } from "@/lib/records/custom-fields";
import {
  validateImportRows,
  type ImportLookups,
} from "@/lib/import/validate";

const MATTER = "11111111-1111-1111-1111-111111111111";
const STATUS_INTAKE = "22222222-2222-2222-2222-222222222222";
const USER_CASEY = "33333333-3333-3333-3333-333333333333";
const CONTACT_A = "44444444-4444-4444-4444-444444444444";

function lookups(overrides: Partial<ImportLookups> = {}): ImportLookups {
  return {
    statusIdByName: new Map([["intake", STATUS_INTAKE]]),
    userIdByEmail: new Map([["casey.editor@example.com", USER_CASEY]]),
    userIds: new Set([USER_CASEY]),
    contactIds: new Set([CONTACT_A]),
    existingReferences: new Set(["TAKEN-1"]),
    ...overrides,
  };
}

function def(overrides: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "fieldType">): CustomFieldDef {
  return {
    id: `${overrides.key}-id`,
    label: overrides.key,
    options: [],
    required: false,
    recordTypeId: MATTER,
    ...overrides,
  };
}

const HEADERS = ["reference", "title", "status", "assignee", "dueDate"];
const MAPPING: Record<string, string> = {
  reference: "reference",
  title: "title",
  status: "status",
  assignee: "assignee",
  dueDate: "dueDate",
};

describe("validateImportRows — fixed fields", () => {
  it("accepts a clean row and resolves names to ids", () => {
    const out = validateImportRows(
      HEADERS,
      [["R-1", "A matter", "Intake", "casey.editor@example.com", "2026-08-01"]],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.validCount).toBe(1);
    expect(out.errorCount).toBe(0);
    expect(out.rows[0].values).toEqual({
      title: "A matter",
      reference: "R-1",
      subjectName: null,
      statusId: STATUS_INTAKE,
      assigneeId: USER_CASEY,
      openedDate: null,
      dueDate: "2026-08-01",
      customValues: {},
    });
  });

  it("numbers rows like a spreadsheet (header = row 1)", () => {
    const out = validateImportRows(
      HEADERS,
      [
        ["R-1", "ok", "", "", ""],
        ["R-2", "", "", "", ""], // missing title → file row 3
      ],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.errors).toEqual([
      { row: 3, column: "title", message: "Title is required." },
    ]);
  });

  it("resolves status names case-insensitively and rejects unknown ones", () => {
    const out = validateImportRows(
      HEADERS,
      [
        ["", "ok", "INTAKE", "", ""],
        ["", "ok", "Closedish", "", ""],
      ],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.rows[0].values?.statusId).toBe(STATUS_INTAKE);
    expect(out.rows[1].errors[0].message).toContain("Closedish");
  });

  it("rejects unknown assignee emails", () => {
    const out = validateImportRows(
      HEADERS,
      [["", "ok", "", "nobody@example.com", ""]],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.errors[0].message).toContain("nobody@example.com");
  });

  it("rejects malformed dates but keeps valid ones as yyyy-mm-dd", () => {
    const out = validateImportRows(
      HEADERS,
      [
        ["", "ok", "", "", "2026-13-45"],
        ["", "ok", "", "", "08/01/2026"],
        ["", "ok", "", "", "2026-08-01"],
      ],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.errorCount).toBe(2);
    expect(out.rows[2].values?.dueDate).toBe("2026-08-01");
  });

  it("flags references that already exist in the workspace", () => {
    const out = validateImportRows(HEADERS, [["TAKEN-1", "ok", "", "", ""]], MAPPING, [], lookups());
    expect(out.errors[0].message).toContain("TAKEN-1");
    expect(out.errors[0].message).toContain("already exists");
  });

  it("flags in-file duplicate references, pointing at the first use", () => {
    const out = validateImportRows(
      HEADERS,
      [
        ["R-9", "first", "", "", ""],
        ["R-9", "second", "", "", ""],
      ],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.validCount).toBe(1);
    expect(out.errors[0].row).toBe(3);
    expect(out.errors[0].message).toContain("row 2");
  });

  it("collects every problem on a row, not just the first", () => {
    const out = validateImportRows(
      HEADERS,
      [["TAKEN-1", "", "Nope", "ghost@example.com", "bad"]],
      MAPPING,
      [],
      lookups(),
    );
    expect(out.rows[0].errors.length).toBe(5);
    expect(out.errorCount).toBe(1); // one invalid ROW
  });
});

describe("validateImportRows — custom fields", () => {
  const headers = ["title", "cf_court_room", "cf_urgent", "cf_tags", "cf_owner"];
  const mapping: Record<string, string> = {
    title: "title",
    cf_court_room: "custom.court_room",
    cf_urgent: "custom.urgent",
    cf_tags: "custom.tags",
    cf_owner: "custom.owner",
  };
  const defs = [
    def({ key: "court_room", fieldType: "TEXT" }),
    def({ key: "urgent", fieldType: "BOOLEAN" }),
    def({ key: "tags", fieldType: "MULTI_SELECT", options: ["red", "green", "blue"] }),
    def({ key: "owner", fieldType: "USER" }),
  ];

  it("parses each type through the record-form validator", () => {
    const out = validateImportRows(
      headers,
      [["ok", "4B", "yes", "red; blue", USER_CASEY]],
      mapping,
      defs,
      lookups(),
    );
    expect(out.errorCount).toBe(0);
    expect(out.rows[0].values?.customValues).toEqual({
      court_room: "4B",
      urgent: true,
      tags: ["red", "blue"],
      owner: USER_CASEY,
    });
  });

  it("errors on boolean junk instead of guessing", () => {
    const out = validateImportRows(headers, [["ok", "", "maybe", "", ""]], mapping, defs, lookups());
    expect(out.errors[0].column).toBe("cf_urgent");
    expect(out.errors[0].message).toContain("true or false");
  });

  it("treats an empty boolean cell as false", () => {
    const out = validateImportRows(headers, [["ok", "", "", "", ""]], mapping, defs, lookups());
    expect(out.rows[0].values?.customValues.urgent).toBe(false);
  });

  it("rejects multi-select values outside the options", () => {
    const out = validateImportRows(
      headers,
      [["ok", "", "", "red; purple", ""]],
      mapping,
      defs,
      lookups(),
    );
    expect(out.errors[0].column).toBe("cf_tags");
    expect(out.errors[0].message).toContain("purple");
  });

  it("rejects USER values that aren't org members", () => {
    const stranger = "99999999-9999-9999-9999-999999999999";
    const out = validateImportRows(headers, [["ok", "", "", "", stranger]], mapping, defs, lookups());
    expect(out.errors[0].column).toBe("cf_owner");
    expect(out.errors[0].message).toContain("not a member");
  });

  it("enforces required custom fields even when the column is unmapped", () => {
    const strict = [def({ key: "court_room", fieldType: "TEXT", required: true, label: "Court room" })];
    const out = validateImportRows(
      ["title"],
      [["ok"]],
      { title: "title" },
      strict,
      lookups(),
    );
    expect(out.errors[0].message).toBe("Court room is required.");
  });
});

describe("export → import round-trip", () => {
  it("re-parses every value the export formatter emits", () => {
    const defs = [
      def({ key: "hearing_date", fieldType: "DATE" }),
      def({ key: "urgent", fieldType: "BOOLEAN" }),
      def({ key: "tags", fieldType: "MULTI_SELECT", options: ["red", "green", "blue"] }),
      def({ key: "budget", fieldType: "NUMBER" }),
    ];
    const stored = {
      hearing_date: "2026-09-01",
      urgent: true,
      tags: ["green", "blue"],
      budget: 1250.75,
    };
    const headers = ["title", "cf_hearing_date", "cf_urgent", "cf_tags", "cf_budget"];
    const mapping = {
      title: "title",
      cf_hearing_date: "custom.hearing_date",
      cf_urgent: "custom.urgent",
      cf_tags: "custom.tags",
      cf_budget: "custom.budget",
    };
    const cells = [
      "ok",
      formatCustomExportValue("DATE", stored.hearing_date),
      formatCustomExportValue("BOOLEAN", stored.urgent),
      formatCustomExportValue("MULTI_SELECT", stored.tags),
      formatCustomExportValue("NUMBER", stored.budget),
    ];

    const out = validateImportRows(headers, [cells], mapping, defs, lookups());
    expect(out.errorCount).toBe(0);
    expect(out.rows[0].values?.customValues).toEqual(stored);
  });
});
