/**
 * Workload aggregation for the calendar view.
 *
 * DiscoBall sums each day's estimated effort per assignee and classifies the
 * load, so the calendar can visually flag days that are over capacity — making
 * heavy days easy to see coming.
 *
 * Pure functions only — fully unit-tested (see tests/workload.test.ts).
 */

export interface WorkloadEvent {
  startAt: Date | string;
  /** Estimated effort in minutes. Missing/0 contributes only to the count. */
  estimatedMinutes?: number | null;
  assigneeId?: string | null;
  isDone?: boolean;
}

export type LoadLevel = "light" | "moderate" | "heavy" | "overloaded";

export interface DayWorkload {
  /** ISO date (YYYY-MM-DD) in UTC. */
  date: string;
  eventCount: number;
  totalMinutes: number;
  level: LoadLevel;
}

export interface WorkloadOptions {
  /** A standard working day's capacity in minutes (default 8h = 480). */
  capacityMinutes?: number;
  /** Only include events for this assignee, if provided. */
  assigneeId?: string;
  /** Exclude events already marked done (default true). */
  excludeDone?: boolean;
}

function toIsoDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function classify(totalMinutes: number, capacity: number): LoadLevel {
  const ratio = totalMinutes / capacity;
  if (ratio <= 0.5) return "light";
  if (ratio <= 0.85) return "moderate";
  if (ratio <= 1.0) return "heavy";
  return "overloaded";
}

/**
 * Group events by calendar day and compute the load level for each day.
 * Returns one entry per day that has at least one matching event, sorted by date.
 */
export function summarizeWorkload(
  events: WorkloadEvent[],
  options: WorkloadOptions = {},
): DayWorkload[] {
  const capacity = options.capacityMinutes ?? 480;
  const excludeDone = options.excludeDone ?? true;

  const byDay = new Map<string, { count: number; minutes: number }>();

  for (const ev of events) {
    if (excludeDone && ev.isDone) continue;
    if (options.assigneeId && ev.assigneeId !== options.assigneeId) continue;

    const day = toIsoDate(ev.startAt);
    const bucket = byDay.get(day) ?? { count: 0, minutes: 0 };
    bucket.count += 1;
    bucket.minutes += ev.estimatedMinutes ?? 0;
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .map(([date, { count, minutes }]) => ({
      date,
      eventCount: count,
      totalMinutes: minutes,
      level: classify(minutes, capacity),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Convenience: the days a viewer should be warned about, in date order. */
export function heavyDays(summary: DayWorkload[]): DayWorkload[] {
  return summary.filter((d) => d.level === "heavy" || d.level === "overloaded");
}
