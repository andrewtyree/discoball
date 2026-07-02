/**
 * Record filtering, sorting & pagination.
 *
 * A typed, validated filter that the API turns into parameterized Drizzle
 * conditions. Pure, in-memory equivalents (a matcher and a comparator) are
 * included so the same semantics can be unit-tested without a database
 * (see tests/filters.test.ts).
 *
 * Every field falls back to its default on invalid input (`.catch`) so a
 * hand-edited URL degrades to a sensible list instead of a 500.
 */
import { z } from "zod";

/** Columns the list can sort by; maps to SQL in src/lib/records/queries.ts. */
export const RECORD_SORT_FIELDS = [
  "reference",
  "title",
  "type",
  "status",
  "assignee",
  "openedDate",
  "dueDate",
  "updatedAt",
] as const;

export type RecordSortField = (typeof RECORD_SORT_FIELDS)[number];

/** Page sizes the UI offers; anything else falls back to the default. */
export const RECORD_PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .catch(() => undefined);

const optionalDate = z.coerce
  .date()
  .optional()
  .catch(() => undefined);

export const recordFilterSchema = z
  .object({
    /** Free-text search across reference / title / subjectName. */
    search: z
      .string()
      .trim()
      .optional()
      .catch(() => undefined),
    recordTypeId: optionalUuid,
    statusId: optionalUuid,
    assigneeId: optionalUuid,
    /** Open/closed convenience toggle, independent of the specific status. */
    state: z.enum(["active", "closed", "all"]).catch("active").default("active"),
    dueFrom: optionalDate,
    dueTo: optionalDate,
    includeArchived: z.boolean().catch(false).default(false),
    sort: z.enum(RECORD_SORT_FIELDS).catch("dueDate").default("dueDate"),
    dir: z.enum(["asc", "desc"]).catch("asc").default("asc"),
    page: z.coerce.number().int().min(1).catch(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((n): n is (typeof RECORD_PAGE_SIZES)[number] =>
        RECORD_PAGE_SIZES.includes(n as (typeof RECORD_PAGE_SIZES)[number]),
      )
      .catch(DEFAULT_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export type RecordFilter = z.infer<typeof recordFilterSchema>;

/** A repeated query param (?search=a&search=b) arrives as an array. */
function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Build a validated filter from raw page search params. Unknown keys are
 * ignored, repeated params collapse to their first value, and empty strings
 * (an unfilled form control) count as absent.
 */
export function recordFilterFromSearchParams(raw: {
  [key: string]: string | string[] | undefined;
}): RecordFilter {
  const pick = (key: string): string | undefined => {
    const v = first(raw[key])?.trim();
    return v ? v : undefined;
  };

  return recordFilterSchema.parse({
    search: pick("search"),
    recordTypeId: pick("type"),
    statusId: pick("status"),
    assigneeId: pick("assignee"),
    state: pick("state"),
    dueFrom: pick("dueFrom"),
    dueTo: pick("dueTo"),
    includeArchived: pick("archived") === "1",
    sort: pick("sort"),
    dir: pick("dir"),
    page: pick("page"),
    pageSize: pick("pageSize"),
  });
}

/**
 * The inverse of `recordFilterFromSearchParams`: serialize a filter back to
 * URL search params, omitting defaults so URLs stay short and shareable.
 */
export function recordFilterToSearchParams(filter: RecordFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.search) params.set("search", filter.search);
  if (filter.recordTypeId) params.set("type", filter.recordTypeId);
  if (filter.statusId) params.set("status", filter.statusId);
  if (filter.assigneeId) params.set("assignee", filter.assigneeId);
  if (filter.state !== "active") params.set("state", filter.state);
  if (filter.dueFrom) params.set("dueFrom", filter.dueFrom.toISOString().slice(0, 10));
  if (filter.dueTo) params.set("dueTo", filter.dueTo.toISOString().slice(0, 10));
  if (filter.includeArchived) params.set("archived", "1");
  if (filter.sort !== "dueDate") params.set("sort", filter.sort);
  if (filter.dir !== "asc") params.set("dir", filter.dir);
  if (filter.page !== 1) params.set("page", String(filter.page));
  if (filter.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(filter.pageSize));
  return params;
}

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

/** The sortable projection of a list row (subset of RecordListRow). */
export interface SortableRecord {
  reference?: string | null;
  title?: string | null;
  typeName?: string | null;
  statusName?: string | null;
  assigneeName?: string | null;
  openedDate?: Date | string | null;
  dueDate?: Date | string | null;
  updatedAt?: Date | string | null;
}

function sortKey(rec: SortableRecord, field: RecordSortField): string | number | null {
  switch (field) {
    case "reference":
      return rec.reference ?? null;
    case "title":
      return rec.title ?? null;
    case "type":
      return rec.typeName ?? null;
    case "status":
      return rec.statusName ?? null;
    case "assignee":
      return rec.assigneeName ?? null;
    case "openedDate":
      return asDate(rec.openedDate)?.getTime() ?? null;
    case "dueDate":
      return asDate(rec.dueDate)?.getTime() ?? null;
    case "updatedAt":
      return asDate(rec.updatedAt)?.getTime() ?? null;
  }
}

/**
 * Pure comparator mirroring the SQL ORDER BY, including PostgreSQL's null
 * placement (nulls sort as the largest value: last for asc, first for desc).
 */
export function compareRecordsBy(
  field: RecordSortField,
  dir: "asc" | "desc",
): (a: SortableRecord, b: SortableRecord) => number {
  const sign = dir === "asc" ? 1 : -1;
  return (a, b) => {
    const ka = sortKey(a, field);
    const kb = sortKey(b, field);
    if (ka === null && kb === null) return 0;
    // Nulls are "largest" regardless of direction, matching Postgres.
    if (ka === null) return dir === "asc" ? 1 : -1;
    if (kb === null) return dir === "asc" ? -1 : 1;
    if (typeof ka === "string" && typeof kb === "string") {
      return sign * ka.localeCompare(kb);
    }
    return sign * (ka < kb ? -1 : ka > kb ? 1 : 0);
  };
}

/** Parse + default raw query params into a validated filter. */
export function parseRecordFilter(input: unknown): RecordFilter {
  return recordFilterSchema.parse(input ?? {});
}
