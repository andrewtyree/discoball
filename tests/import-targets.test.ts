import { describe, expect, it } from "vitest";

import {
  columnMappingProblem,
  FIXED_IMPORT_TARGETS,
  guessColumnMapping,
  importTargetsFor,
} from "@/lib/import/targets";

const DEFS = [
  { key: "court_room", label: "Court room" },
  { key: "priority_band", label: "Priority band" },
];

const TARGETS = importTargetsFor(DEFS);

describe("importTargetsFor", () => {
  it("appends custom.<key> targets after the fixed ones", () => {
    expect(TARGETS.map((t) => t.path)).toEqual([
      ...FIXED_IMPORT_TARGETS.map((t) => t.path),
      "custom.court_room",
      "custom.priority_band",
    ]);
  });

  it("marks only title as required", () => {
    expect(TARGETS.filter((t) => t.required).map((t) => t.path)).toEqual(["title"]);
  });
});

describe("guessColumnMapping", () => {
  it("maps the records-export header set with zero manual clicks", () => {
    const exportHeaders = [
      "recordType",
      "reference",
      "title",
      "subjectName",
      "status",
      "assignee",
      "openedDate",
      "dueDate",
      "archived",
      "cf_court_room",
    ];
    expect(guessColumnMapping(exportHeaders, TARGETS)).toEqual({
      recordType: "", // no target — imports are single-type
      reference: "reference",
      title: "title",
      subjectName: "subjectName",
      status: "status",
      assignee: "assignee",
      openedDate: "openedDate",
      dueDate: "dueDate",
      archived: "", // no target
      cf_court_room: "custom.court_room",
    });
  });

  it("matches messy human headers case- and punctuation-insensitively", () => {
    const mapping = guessColumnMapping(
      ["Title", "Subject Name", "Due Date", "Assignee Email", "COURT ROOM"],
      TARGETS,
    );
    expect(mapping["Title"]).toBe("title");
    expect(mapping["Subject Name"]).toBe("subjectName");
    expect(mapping["Due Date"]).toBe("dueDate");
    expect(mapping["Assignee Email"]).toBe("assignee");
    expect(mapping["COURT ROOM"]).toBe("custom.court_room");
  });

  it("gives a target to the first matching header only", () => {
    const mapping = guessColumnMapping(["title", "Title"], TARGETS);
    expect(mapping["title"]).toBe("title");
    expect(mapping["Title"]).toBe("");
  });

  it("leaves unknown headers ignored", () => {
    expect(guessColumnMapping(["mystery_column"], TARGETS)).toEqual({ mystery_column: "" });
  });
});

describe("columnMappingProblem", () => {
  it("accepts a minimal valid mapping", () => {
    expect(columnMappingProblem({ a: "title", b: "" }, TARGETS)).toBeNull();
  });

  it("requires a column mapped to title", () => {
    expect(columnMappingProblem({ a: "reference" }, TARGETS)).toMatch(/Title/);
  });

  it("rejects two columns on one target", () => {
    const problem = columnMappingProblem({ a: "title", b: "title" }, TARGETS);
    expect(problem).toMatch(/only one column/);
  });

  it("rejects unknown target paths", () => {
    expect(columnMappingProblem({ a: "title", b: "custom.nope" }, TARGETS)).toMatch(/Unknown/);
  });
});
