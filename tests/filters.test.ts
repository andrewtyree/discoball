import { describe, expect, it } from "vitest";

import { parseRecordFilter, recordMatchesFilter } from "@/lib/records/filters";

const base = {
  title: "Acme onboarding",
  reference: "REC-1001",
  subjectName: "Acme Industries",
  statusCategory: "OPEN" as const,
  isArchived: false,
};

describe("parseRecordFilter", () => {
  it("applies defaults", () => {
    const f = parseRecordFilter({});
    expect(f.state).toBe("active");
    expect(f.includeArchived).toBe(false);
  });
});

describe("recordMatchesFilter", () => {
  it("hides archived records unless requested", () => {
    const f = parseRecordFilter({});
    expect(recordMatchesFilter({ ...base, isArchived: true }, f)).toBe(false);
    expect(
      recordMatchesFilter({ ...base, isArchived: true }, parseRecordFilter({ includeArchived: true })),
    ).toBe(true);
  });

  it("active state excludes CLOSED records", () => {
    const f = parseRecordFilter({ state: "active" });
    expect(recordMatchesFilter({ ...base, statusCategory: "CLOSED" }, f)).toBe(false);
    expect(recordMatchesFilter(base, f)).toBe(true);
  });

  it("matches free-text search across reference/title/subject", () => {
    const f = parseRecordFilter({ search: "acme" });
    expect(recordMatchesFilter(base, f)).toBe(true);
    expect(recordMatchesFilter({ ...base, subjectName: "Globex" , title: "Other"}, f)).toBe(false);
  });

  it("applies a due-date window", () => {
    const f = parseRecordFilter({ dueFrom: "2026-07-01", dueTo: "2026-07-31" });
    expect(recordMatchesFilter({ ...base, dueDate: "2026-07-15" }, f)).toBe(true);
    expect(recordMatchesFilter({ ...base, dueDate: "2026-08-15" }, f)).toBe(false);
    expect(recordMatchesFilter({ ...base, dueDate: null }, f)).toBe(false);
  });
});
