/**
 * Placeholder → data resolution: every source path, date/boolean/multi-select
 * formatting, empty-value ("missing") detection, the mapping-source catalog,
 * and output-filename resolution.
 */
import { describe, expect, it } from "vitest";

import type { CustomFieldDef } from "@/lib/records/custom-fields";
import {
  buildRenderData,
  contentDispositionAttachment,
  customSourcePath,
  formatHumanDate,
  MAPPING_SOURCES,
  mappingSourcesFor,
  resolveOutputName,
  resolveSourceValue,
  sanitizeFileName,
  uniqueFileName,
  type GenerationRecord,
} from "@/lib/templates/resolve";

function def(key: string, fieldType: CustomFieldDef["fieldType"]): Pick<CustomFieldDef, "key" | "fieldType"> {
  return { key, fieldType };
}

const record: GenerationRecord = {
  title: "Quarterly review",
  reference: "BLK-0007",
  subjectName: "Ada Lovelace",
  openedDate: new Date("2026-01-05T00:00:00Z"),
  dueDate: "2026-03-12",
  statusName: "In progress",
  recordTypeName: "Case",
  assigneeName: "Grace Hopper",
  assigneeEmail: "grace@example.com",
  orgName: "Discoball Inc",
  customValues: {
    hearing_date: "2026-03-12",
    urgent: true,
    closed_flag: false,
    tags: ["red", "blue"],
    amount: 1500,
    note: "hello",
  },
};

const defs = [
  def("hearing_date", "DATE"),
  def("urgent", "BOOLEAN"),
  def("closed_flag", "BOOLEAN"),
  def("tags", "MULTI_SELECT"),
  def("amount", "NUMBER"),
  def("note", "TEXT"),
];

describe("formatHumanDate", () => {
  it("formats dates as '12 Mar 2026'", () => {
    expect(formatHumanDate("2026-03-12")).toBe("12 Mar 2026");
    expect(formatHumanDate(new Date("2026-01-05T00:00:00Z"))).toBe("5 Jan 2026");
  });

  it("returns empty for null/invalid input", () => {
    expect(formatHumanDate(null)).toBe("");
    expect(formatHumanDate(undefined)).toBe("");
    expect(formatHumanDate("not a date")).toBe("");
  });
});

describe("resolveSourceValue", () => {
  const today = new Date("2026-07-02T10:00:00Z");

  it.each([
    ["title", "Quarterly review"],
    ["reference", "BLK-0007"],
    ["subjectName", "Ada Lovelace"],
    ["dueDate", "12 Mar 2026"],
    ["openedDate", "5 Jan 2026"],
    ["status.name", "In progress"],
    ["recordType.name", "Case"],
    ["assignee.name", "Grace Hopper"],
    ["assignee.email", "grace@example.com"],
    ["org.name", "Discoball Inc"],
    ["today", "2 Jul 2026"],
  ])("resolves %s", (path, expected) => {
    expect(resolveSourceValue(record, defs, path, today)).toBe(expected);
  });

  it("formats custom DATE fields human-readably", () => {
    expect(resolveSourceValue(record, defs, "custom.hearing_date")).toBe("12 Mar 2026");
  });

  it("formats custom booleans as Yes/No", () => {
    expect(resolveSourceValue(record, defs, "custom.urgent")).toBe("Yes");
    expect(resolveSourceValue(record, defs, "custom.closed_flag")).toBe("No");
  });

  it("joins multi-selects with a comma", () => {
    expect(resolveSourceValue(record, defs, "custom.tags")).toBe("red, blue");
  });

  it("stringifies numbers and text", () => {
    expect(resolveSourceValue(record, defs, "custom.amount")).toBe("1500");
    expect(resolveSourceValue(record, defs, "custom.note")).toBe("hello");
  });

  it("returns empty for unknown sources and absent custom values", () => {
    expect(resolveSourceValue(record, defs, "no.such.path")).toBe("");
    expect(resolveSourceValue(record, defs, "custom.nonexistent")).toBe("");
  });
});

describe("buildRenderData", () => {
  it("resolves every mapped placeholder into flat string data", () => {
    const { data, missing } = buildRenderData(record, defs, {
      ref: "reference",
      who: "subjectName",
      due: "dueDate",
      hearing: "custom.hearing_date",
    });
    expect(data).toEqual({
      ref: "BLK-0007",
      who: "Ada Lovelace",
      due: "12 Mar 2026",
      hearing: "12 Mar 2026",
    });
    expect(missing).toEqual([]);
  });

  it("lists placeholders whose value resolved empty (still rendered as \"\")", () => {
    const bare: GenerationRecord = {
      ...record,
      subjectName: null,
      dueDate: null,
      statusName: null,
    };
    const { data, missing } = buildRenderData(bare, defs, {
      who: "subjectName",
      due: "dueDate",
      st: "status.name",
      ref: "reference",
    });
    expect(missing.sort()).toEqual(["due", "st", "who"]);
    expect(data.who).toBe("");
    expect(data.ref).toBe("BLK-0007");
  });

  it("counts a false boolean as present (No), not missing", () => {
    const { data, missing } = buildRenderData(record, defs, { c: "custom.closed_flag" });
    expect(data.c).toBe("No");
    expect(missing).toEqual([]);
  });
});

describe("MAPPING_SOURCES catalog", () => {
  it("contains every fixed source path", () => {
    const paths = MAPPING_SOURCES.map((s) => s.path);
    expect(paths).toEqual([
      "title",
      "reference",
      "subjectName",
      "dueDate",
      "openedDate",
      "status.name",
      "recordType.name",
      "assignee.name",
      "assignee.email",
      "org.name",
      "today",
    ]);
  });

  it("appends custom.<key> entries for a record type's fields", () => {
    const sources = mappingSourcesFor([
      { key: "hearing_date", label: "Hearing date" },
      { key: "urgent", label: "Urgent" },
    ]);
    const custom = sources.slice(MAPPING_SOURCES.length);
    expect(custom).toEqual([
      { path: "custom.hearing_date", label: "Hearing date (custom field)" },
      { path: "custom.urgent", label: "Urgent (custom field)" },
    ]);
    expect(customSourcePath("hearing_date")).toBe("custom.hearing_date");
  });
});

describe("output filenames", () => {
  it("resolves the pattern with source-path tokens", () => {
    expect(resolveOutputName("{reference}_{subjectName}", record, defs)).toBe(
      "BLK-0007_Ada Lovelace",
    );
  });

  it("defaults to {reference}", () => {
    expect(resolveOutputName(null, record, defs)).toBe("BLK-0007");
    expect(resolveOutputName("  ", record, defs)).toBe("BLK-0007");
  });

  it("resolves custom tokens and leaves empty for unknowns", () => {
    expect(resolveOutputName("{custom.hearing_date}-{nope}", record, defs)).toBe(
      "12 Mar 2026-",
    );
  });

  it("sanitizeFileName strips filesystem-hostile characters", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(sanitizeFileName("  .. leading dots and spaces .. ")).toBe("leading dots and spaces");
    expect(sanitizeFileName("")).toBe("");
    expect(sanitizeFileName("plain name")).toBe("plain name");
  });
});

describe("uniqueFileName", () => {
  it("dedupes repeated bases with -2, -3 suffixes", () => {
    const used = new Set<string>();
    expect(uniqueFileName("Report", "fb", used)).toBe("Report");
    expect(uniqueFileName("Report", "fb", used)).toBe("Report-2");
    expect(uniqueFileName("Report", "fb", used)).toBe("Report-3");
  });

  it("never collides with a literal base equal to an earlier deduped name", () => {
    // The old base-count dedupe emitted ["Report", "Report-2", "Report-2"],
    // silently overwriting a zip entry — every name must be unique.
    const used = new Set<string>();
    const names = ["Report", "Report", "Report-2"].map((b) =>
      uniqueFileName(b, "fb", used),
    );
    expect(names).toEqual(["Report", "Report-2", "Report-2-2"]);
    expect(new Set(names).size).toBe(3);
  });

  it("compares case-insensitively (zip extraction on Windows/macOS)", () => {
    const used = new Set<string>();
    expect(uniqueFileName("report", "fb", used)).toBe("report");
    expect(uniqueFileName("Report", "fb", used)).toBe("Report-2");
  });

  it("uses the fallback when the base is empty, still deduped", () => {
    const used = new Set<string>();
    expect(uniqueFileName("", "record-abc123", used)).toBe("record-abc123");
    expect(uniqueFileName("", "record-abc123", used)).toBe("record-abc123-2");
  });
});

describe("contentDispositionAttachment", () => {
  it("passes plain ASCII names through both parameters", () => {
    expect(contentDispositionAttachment("report.docx")).toBe(
      `attachment; filename="report.docx"; filename*=UTF-8''report.docx`,
    );
  });

  it("ASCII-folds the quoted fallback and RFC 5987-encodes the real name", () => {
    const header = contentDispositionAttachment("Contract — 2026.docx");
    expect(header).toContain('filename="Contract _ 2026.docx"');
    expect(header).toContain("filename*=UTF-8''Contract%20%E2%80%94%202026.docx");
  });

  it("emits only ByteString-safe characters (undici rejects > 0xFF)", () => {
    for (const name of ["Michał.docx", "田中太郎.pdf", "emoji 📄.zip", "Contract — 2026.docx"]) {
      const header = contentDispositionAttachment(name);
      expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    }
  });

  it("neutralizes quotes and backslashes in the quoted fallback", () => {
    const header = contentDispositionAttachment('a"b\\c.docx');
    expect(header).toContain('filename="a_b_c.docx"');
  });
});
