import { describe, expect, it } from "vitest";

import { heavyDays, summarizeWorkload } from "@/lib/calendar/workload";

const day = (d: string) => `${d}T09:00:00.000Z`;

describe("summarizeWorkload", () => {
  it("groups events by day and sums estimated minutes", () => {
    const summary = summarizeWorkload([
      { startAt: day("2026-07-01"), estimatedMinutes: 120 },
      { startAt: day("2026-07-01"), estimatedMinutes: 60 },
      { startAt: day("2026-07-02"), estimatedMinutes: 30 },
    ]);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({
      date: "2026-07-01",
      eventCount: 2,
      totalMinutes: 180,
    });
  });

  it("classifies load levels against capacity", () => {
    const [d] = summarizeWorkload(
      [{ startAt: day("2026-07-01"), estimatedMinutes: 600 }],
      { capacityMinutes: 480 },
    );
    expect(d.level).toBe("overloaded");
  });

  it("excludes done events by default", () => {
    const summary = summarizeWorkload([
      { startAt: day("2026-07-01"), estimatedMinutes: 100, isDone: true },
    ]);
    expect(summary).toEqual([]);
  });

  it("filters by assignee when provided", () => {
    const summary = summarizeWorkload(
      [
        { startAt: day("2026-07-01"), estimatedMinutes: 100, assigneeId: "u1" },
        { startAt: day("2026-07-01"), estimatedMinutes: 100, assigneeId: "u2" },
      ],
      { assigneeId: "u1" },
    );
    expect(summary[0].totalMinutes).toBe(100);
  });
});

describe("heavyDays", () => {
  it("returns only heavy/overloaded days", () => {
    const summary = summarizeWorkload(
      [
        { startAt: day("2026-07-01"), estimatedMinutes: 60 }, // light
        { startAt: day("2026-07-02"), estimatedMinutes: 460 }, // heavy
        { startAt: day("2026-07-03"), estimatedMinutes: 720 }, // overloaded
      ],
      { capacityMinutes: 480 },
    );
    expect(heavyDays(summary).map((d) => d.date)).toEqual([
      "2026-07-02",
      "2026-07-03",
    ]);
  });
});
