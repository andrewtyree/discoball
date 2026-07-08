import { describe, expect, it } from "vitest";

import {
  buildExportColumns,
  exportRecordToJson,
  exportRowsToCsv,
  formatCustomExportValue,
  FIXED_EXPORT_COLUMNS,
  MULTI_SELECT_SEPARATOR,
  type ExportRecordRow,
} from "@/lib/export/columns";
import type { CustomFieldDef } from "@/lib/records/custom-fields";

const MATTER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

function def(overrides: Partial<CustomFieldDef> & Pick<CustomFieldDef, "key" | "fieldType" | "recordTypeId">): CustomFieldDef {
  return {
    id: `${overrides.key}-id`,
    label: overrides.key,
    options: [],
    required: false,
    ...overrides,
  };
}

function row(overrides: Partial<ExportRecordRow>): ExportRecordRow {
  return {
    id: "r1",
    recordTypeId: MATTER,
    typeName: "Matter",
    reference: "MAT-0001",
    title: "Test matter",
    subjectName: null,
    statusName: null,
    assigneeEmail: null,
    openedDate: null,
    dueDate: null,
    isArchived: false,
    customValues: {},
    ...overrides,
  };
}

const DEFS = new Map<string, CustomFieldDef[]>([
  [
    MATTER,
    [
      def({ key: "court_room", fieldType: "TEXT", recordTypeId: MATTER }),
      def({ key: "hearing_date", fieldType: "DATE", recordTypeId: MATTER }),
      def({ key: "tags", fieldType: "MULTI_SELECT", recordTypeId: MATTER, options: ["a", "b", "c"] }),
    ],
  ],
  [
    PROJECT,
    [
      def({ key: "budget", fieldType: "NUMBER", recordTypeId: PROJECT }),
      // Same key on a second type must NOT create a duplicate column.
      def({ key: "court_room", fieldType: "TEXT", recordTypeId: PROJECT }),
    ],
  ],
]);

describe("formatCustomExportValue", () => {
  it("keeps DATE as the stored yyyy-mm-dd string", () => {
    expect(formatCustomExportValue("DATE", "2026-03-12")).toBe("2026-03-12");
  });

  it("joins MULTI_SELECT with the import separator", () => {
    expect(formatCustomExportValue("MULTI_SELECT", ["a", "b"])).toBe(`a${MULTI_SELECT_SEPARATOR}b`);
  });

  it("renders BOOLEAN as true/false, treating absent as false", () => {
    expect(formatCustomExportValue("BOOLEAN", true)).toBe("true");
    expect(formatCustomExportValue("BOOLEAN", false)).toBe("false");
    expect(formatCustomExportValue("BOOLEAN", undefined)).toBe("false");
  });

  it("renders NUMBER as a plain decimal string", () => {
    expect(formatCustomExportValue("NUMBER", 42.5)).toBe("42.5");
  });

  it("renders absent non-boolean values as empty", () => {
    expect(formatCustomExportValue("TEXT", undefined)).toBe("");
    expect(formatCustomExportValue("TEXT", null)).toBe("");
  });
});

describe("buildExportColumns", () => {
  it("appends the union of custom keys as cf_ columns, sorted, deduped", () => {
    const headers = buildExportColumns(DEFS).map((c) => c.header);
    expect(headers).toEqual([
      ...FIXED_EXPORT_COLUMNS.map((c) => c.header),
      "cf_budget",
      "cf_court_room",
      "cf_hearing_date",
      "cf_tags",
    ]);
  });

  it("formats a cell through the row's own record type definition", () => {
    const columns = buildExportColumns(DEFS);
    const tags = columns.find((c) => c.header === "cf_tags")!;
    const matter = row({ customValues: { tags: ["a", "c"] } });
    expect(tags.value(matter)).toBe(`a${MULTI_SELECT_SEPARATOR}c`);
  });

  it("leaves cells blank when the field does not exist on the row's type", () => {
    const columns = buildExportColumns(DEFS);
    const budget = columns.find((c) => c.header === "cf_budget")!;
    // A Matter row has no "budget" definition even if stray data exists.
    expect(budget.value(row({ customValues: { budget: 99 } }))).toBe("");
    expect(budget.value(row({ recordTypeId: PROJECT, typeName: "Project", customValues: { budget: 99 } }))).toBe("99");
  });
});

describe("exportRowsToCsv", () => {
  it("emits a header row then one row per record, aligned to columns", () => {
    const columns = buildExportColumns(DEFS);
    const rows = exportRowsToCsv(columns, [
      row({
        subjectName: "Reyes, Jordan",
        statusName: "Intake",
        assigneeEmail: "casey.editor@example.com",
        dueDate: new Date("2026-08-01T00:00:00Z"),
        customValues: { court_room: "4B", hearing_date: "2026-08-15" },
      }),
    ]);
    expect(rows).toHaveLength(2);
    const record = Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i]]));
    expect(record.recordType).toBe("Matter");
    expect(record.reference).toBe("MAT-0001");
    expect(record.subjectName).toBe("Reyes, Jordan");
    expect(record.status).toBe("Intake");
    expect(record.assignee).toBe("casey.editor@example.com");
    expect(record.dueDate).toBe("2026-08-01");
    expect(record.openedDate).toBe("");
    expect(record.archived).toBe("false");
    expect(record.cf_court_room).toBe("4B");
    expect(record.cf_hearing_date).toBe("2026-08-15");
    expect(record.cf_tags).toBe("");
    expect(record.cf_budget).toBe("");
  });
});

describe("exportRecordToJson", () => {
  it("keeps customValues nested and dates as yyyy-mm-dd", () => {
    const json = exportRecordToJson(
      row({
        openedDate: new Date("2026-01-05T00:00:00Z"),
        customValues: { court_room: "4B" },
      }),
    );
    expect(json).toEqual({
      id: "r1",
      recordType: "Matter",
      reference: "MAT-0001",
      title: "Test matter",
      subjectName: null,
      status: null,
      assignee: null,
      openedDate: "2026-01-05",
      dueDate: null,
      archived: false,
      customValues: { court_room: "4B" },
    });
  });
});
