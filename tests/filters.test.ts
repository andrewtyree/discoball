import { describe, expect, it } from "vitest";

import {
  compareRecordsBy,
  DEFAULT_PAGE_SIZE,
  parseRecordFilter,
  recordFilterFromSearchParams,
  recordFilterToSearchParams,
  recordMatchesFilter,
} from "@/lib/records/filters";

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
    expect(f.sort).toBe("dueDate");
    expect(f.dir).toBe("asc");
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("recordFilterFromSearchParams", () => {
  it("reads filter, sort, and pagination params", () => {
    const f = recordFilterFromSearchParams({
      search: "acme",
      state: "closed",
      sort: "title",
      dir: "desc",
      page: "3",
      pageSize: "50",
      archived: "1",
    });
    expect(f.search).toBe("acme");
    expect(f.state).toBe("closed");
    expect(f.sort).toBe("title");
    expect(f.dir).toBe("desc");
    expect(f.page).toBe(3);
    expect(f.pageSize).toBe(50);
    expect(f.includeArchived).toBe(true);
  });

  it("collapses repeated params to the first value", () => {
    const f = recordFilterFromSearchParams({ search: ["a", "b"], page: ["2", "9"] });
    expect(f.search).toBe("a");
    expect(f.page).toBe(2);
  });

  it("degrades invalid values to defaults instead of throwing", () => {
    const f = recordFilterFromSearchParams({
      type: "not-a-uuid",
      state: "bogus",
      sort: "nope",
      dir: "sideways",
      page: "-4",
      pageSize: "33",
      dueFrom: "not-a-date",
    });
    expect(f.recordTypeId).toBeUndefined();
    expect(f.state).toBe("active");
    expect(f.sort).toBe("dueDate");
    expect(f.dir).toBe("asc");
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(f.dueFrom).toBeUndefined();
  });

  it("round-trips through recordFilterToSearchParams", () => {
    const f = recordFilterFromSearchParams({
      search: "acme",
      state: "all",
      sort: "assignee",
      dir: "desc",
      page: "2",
    });
    const back = recordFilterFromSearchParams(
      Object.fromEntries(recordFilterToSearchParams(f).entries()),
    );
    expect(back).toEqual(f);
  });

  it("omits defaults when serializing", () => {
    const params = recordFilterToSearchParams(parseRecordFilter({}));
    expect(params.toString()).toBe("");
  });
});

describe("compareRecordsBy", () => {
  const rows = [
    { title: "Beta", dueDate: "2026-07-10" },
    { title: "Alpha", dueDate: null },
    { title: "Gamma", dueDate: "2026-07-01" },
  ];

  it("sorts by a string column in both directions", () => {
    const asc = [...rows].sort(compareRecordsBy("title", "asc")).map((r) => r.title);
    expect(asc).toEqual(["Alpha", "Beta", "Gamma"]);
    const desc = [...rows].sort(compareRecordsBy("title", "desc")).map((r) => r.title);
    expect(desc).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("places nulls last ascending and first descending (Postgres semantics)", () => {
    const asc = [...rows].sort(compareRecordsBy("dueDate", "asc")).map((r) => r.title);
    expect(asc).toEqual(["Gamma", "Beta", "Alpha"]);
    const desc = [...rows].sort(compareRecordsBy("dueDate", "desc")).map((r) => r.title);
    expect(desc).toEqual(["Alpha", "Beta", "Gamma"]);
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
