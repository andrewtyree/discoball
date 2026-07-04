import { describe, expect, it } from "vitest";

import {
  calendarItemId,
  combineDateTime,
  fromExclusiveAllDayEnd,
  monthGridRange,
  parseMonth,
  recordDueTitle,
  shiftItemTimes,
  stripItemId,
  toExclusiveAllDayEnd,
  toWorkloadEvents,
  type CalendarItem,
} from "@/lib/calendar/items";
import { summarizeWorkload } from "@/lib/calendar/workload";

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    id: "event:e1",
    kind: "event",
    title: "Prep hearing bundle",
    type: "TASK",
    start: new Date("2026-07-06T09:00:00.000Z"),
    end: null,
    allDay: false,
    assigneeId: "u1",
    assigneeName: "Ada",
    estimatedMinutes: 120,
    isDone: false,
    recordId: null,
    recordReference: null,
    recordTitle: null,
    recordVersion: null,
    notes: null,
    ...overrides,
  };
}

describe("calendar item ids", () => {
  it("namespaces per kind and strips back to the raw id", () => {
    expect(calendarItemId("event", "abc")).toBe("event:abc");
    expect(calendarItemId("record-due", "abc")).toBe("record:abc");
    expect(stripItemId("event:abc")).toBe("abc");
    expect(stripItemId("record:abc")).toBe("abc");
  });

  it("passes bare ids through unchanged", () => {
    expect(stripItemId("abc-123")).toBe("abc-123");
  });
});

describe("recordDueTitle", () => {
  it("prefixes the reference when present", () => {
    expect(recordDueTitle("BLK-0007", "Blocked drain")).toBe("BLK-0007 — Blocked drain");
  });

  it("falls back to the bare title", () => {
    expect(recordDueTitle(null, "Blocked drain")).toBe("Blocked drain");
  });
});

describe("toWorkloadEvents", () => {
  it("maps the workload-relevant fields", () => {
    const [ev] = toWorkloadEvents([item()]);
    expect(ev).toEqual({
      startAt: new Date("2026-07-06T09:00:00.000Z"),
      estimatedMinutes: 120,
      assigneeId: "u1",
      isDone: false,
    });
  });

  it("record due dates count toward eventCount but not minutes", () => {
    const summary = summarizeWorkload(
      toWorkloadEvents([
        item({ estimatedMinutes: 90 }),
        item({
          id: "record:r1",
          kind: "record-due",
          type: "DEADLINE",
          estimatedMinutes: null,
          allDay: true,
        }),
      ]),
    );
    expect(summary).toEqual([
      expect.objectContaining({
        date: "2026-07-06",
        eventCount: 2,
        totalMinutes: 90,
      }),
    ]);
  });
});

describe("monthGridRange", () => {
  it("pads July 2026 to whole Sunday-start weeks", () => {
    // 2026-07-01 is a Wednesday; the grid runs Sun Jun 28 → Sat Aug 1.
    const { from, to } = monthGridRange(2026, 7);
    expect(from.toISOString()).toBe("2026-06-28T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-02T00:00:00.000Z"); // exclusive
  });

  it("respects a Monday week start", () => {
    const { from, to } = monthGridRange(2026, 7, 1);
    expect(from.toISOString()).toBe("2026-06-29T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("adds no padding when the month already fits whole weeks", () => {
    // February 2026: Sun Feb 1 → Sat Feb 28, exactly four weeks.
    const { from, to } = monthGridRange(2026, 2);
    expect(from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("parseMonth", () => {
  it("parses yyyy-mm", () => {
    expect(parseMonth("2026-07")).toEqual({ year: 2026, month: 7 });
  });

  it("rejects malformed or out-of-range values", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-00")).toBeNull();
    expect(parseMonth("2026-7")).toBeNull();
    expect(parseMonth("July 2026")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
});

describe("combineDateTime", () => {
  it("treats a bare date as UTC midnight", () => {
    expect(combineDateTime("2026-07-06")?.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    expect(combineDateTime("2026-07-06", "")?.toISOString()).toBe(
      "2026-07-06T00:00:00.000Z",
    );
  });

  it("combines date and time as a UTC instant", () => {
    expect(combineDateTime("2026-07-06", "14:30")?.toISOString()).toBe(
      "2026-07-06T14:30:00.000Z",
    );
  });

  it("rejects malformed input and impossible dates", () => {
    expect(combineDateTime("06/07/2026")).toBeNull();
    expect(combineDateTime("2026-07-06", "25:00")).toBeNull();
    expect(combineDateTime("2026-02-30")).toBeNull();
  });
});

describe("all-day end conversion", () => {
  // The DB stores an all-day event's end as the INCLUSIVE last covered day;
  // FullCalendar treats all-day ends as EXCLUSIVE.
  it("adds a day for the calendar's exclusive convention", () => {
    expect(toExclusiveAllDayEnd(new Date("2026-07-08T00:00:00.000Z")).toISOString()).toBe(
      "2026-07-09T00:00:00.000Z",
    );
  });

  it("round-trips an inclusive end through the exclusive form", () => {
    const start = new Date("2026-07-06T00:00:00.000Z");
    const inclusiveEnd = new Date("2026-07-08T00:00:00.000Z");
    expect(
      fromExclusiveAllDayEnd(toExclusiveAllDayEnd(inclusiveEnd), start).toISOString(),
    ).toBe(inclusiveEnd.toISOString());
  });

  it("clamps a single-day exclusive end back to the start, never before it", () => {
    const start = new Date("2026-07-06T00:00:00.000Z");
    // FullCalendar's exclusive end for a one-day all-day event is start + 1.
    expect(
      fromExclusiveAllDayEnd(new Date("2026-07-07T00:00:00.000Z"), start).toISOString(),
    ).toBe("2026-07-06T00:00:00.000Z");
    // A degenerate end at/before the start clamps to the start.
    expect(
      fromExclusiveAllDayEnd(new Date("2026-07-06T00:00:00.000Z"), start).toISOString(),
    ).toBe("2026-07-06T00:00:00.000Z");
  });
});

describe("shiftItemTimes", () => {
  const startAt = new Date("2026-07-06T09:00:00.000Z");
  const endAt = new Date("2026-07-06T10:30:00.000Z");

  it("preserves the duration when only the start moves", () => {
    const moved = shiftItemTimes({ startAt, endAt }, new Date("2026-07-08T13:00:00.000Z"));
    expect(moved.startAt.toISOString()).toBe("2026-07-08T13:00:00.000Z");
    expect(moved.endAt?.toISOString()).toBe("2026-07-08T14:30:00.000Z");
  });

  it("uses an explicit new end when the drag resized the event", () => {
    const moved = shiftItemTimes(
      { startAt, endAt },
      new Date("2026-07-08T13:00:00.000Z"),
      new Date("2026-07-08T17:00:00.000Z"),
    );
    expect(moved.endAt?.toISOString()).toBe("2026-07-08T17:00:00.000Z");
  });

  it("keeps open-ended events open-ended", () => {
    const moved = shiftItemTimes(
      { startAt, endAt: null },
      new Date("2026-07-08T13:00:00.000Z"),
    );
    expect(moved.endAt).toBeNull();
  });
});
