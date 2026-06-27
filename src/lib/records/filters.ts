/**
 * Record filtering.
 *
 * A typed, validated filter that the API turns into parameterized Drizzle
 * conditions. A pure, in-memory matcher is included so the same filter
 * semantics can be unit-tested without a database (see tests/filters.test.ts).
 */
import { z } from "zod";

export const recordFilterSchema = z
  .object({
    /** Free-text search across reference / title / subjectName. */
    search: z.string().trim().optional(),
    recordTypeId: z.string().uuid().optional(),
    statusId: z.string().uuid().optional(),
    assigneeId: z.string().uuid().optional(),
    /** Open/closed convenience toggle, independent of the specific status. */
    state: z.enum(["active", "closed", "all"]).default("active"),
    dueFrom: z.coerce.date().optional(),
    dueTo: z.coerce.date().optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict();

export type RecordFilter = z.infer<typeof recordFilterSchema>;

/** A minimal shape the in-memory matcher understands (subset of a DB record). */
export interface MatchableRecord {
  reference?: string | null;
  title: string;
  subjectName?: string | null;
  recordTypeId?: string | null;
  statusId?: string | null;
  statusCategory?: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "CLOSED" | null;
  assigneeId?: string | null;
  dueDate?: Date | string | null;
  isArchived?: boolean;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return typeof v === "string" ? new Date(v) : v;
}

/**
 * Pure predicate: does a record satisfy the filter? Used in tests and any
 * client-side refinement; the server builds the equivalent SQL.
 */
export function recordMatchesFilter(rec: MatchableRecord, filter: RecordFilter): boolean {
  if (!filter.includeArchived && rec.isArchived) return false;

  if (filter.state === "active" && rec.statusCategory === "CLOSED") return false;
  if (filter.state === "closed" && rec.statusCategory !== "CLOSED") return false;

  if (filter.recordTypeId && rec.recordTypeId !== filter.recordTypeId) return false;
  if (filter.statusId && rec.statusId !== filter.statusId) return false;
  if (filter.assigneeId && rec.assigneeId !== filter.assigneeId) return false;

  const due = asDate(rec.dueDate);
  if (filter.dueFrom && (!due || due < filter.dueFrom)) return false;
  if (filter.dueTo && (!due || due > filter.dueTo)) return false;

  if (filter.search) {
    const needle = filter.search.toLowerCase();
    const haystack = [rec.reference, rec.title, rec.subjectName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

/** Parse + default raw query params into a validated filter. */
export function parseRecordFilter(input: unknown): RecordFilter {
  return recordFilterSchema.parse(input ?? {});
}
