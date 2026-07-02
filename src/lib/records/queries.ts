/**
 * Record queries — org-scoped reads for the records screens.
 *
 * Every query takes the caller's `orgId` (from the session) and scopes rows to
 * it; nothing here trusts a client-supplied organization. The list query turns
 * a validated `RecordFilter` (see ./filters.ts) into parameterized SQL with the
 * same semantics as the pure in-memory matcher used in tests.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import { db, schema } from "@/db";
import type { RecordFilter } from "./filters";

/** Phase 1 shows one page; server-side pagination arrives with the Phase 2 table. */
export const RECORDS_PAGE_SIZE = 100;

function filterConditions(orgId: string, filter: RecordFilter): SQL[] {
  const conds: (SQL | undefined)[] = [eq(schema.records.orgId, orgId)];

  if (!filter.includeArchived) conds.push(eq(schema.records.isArchived, false));

  // Records without a status count as "active" — only an explicitly CLOSED
  // status closes a record (mirrors recordMatchesFilter).
  if (filter.state === "active") {
    conds.push(
      or(isNull(schema.records.statusId), ne(schema.statuses.category, "CLOSED")),
    );
  } else if (filter.state === "closed") {
    conds.push(eq(schema.statuses.category, "CLOSED"));
  }

  if (filter.recordTypeId) conds.push(eq(schema.records.recordTypeId, filter.recordTypeId));
  if (filter.statusId) conds.push(eq(schema.records.statusId, filter.statusId));
  if (filter.assigneeId) conds.push(eq(schema.records.assigneeId, filter.assigneeId));
  if (filter.dueFrom) conds.push(gte(schema.records.dueDate, filter.dueFrom));
  if (filter.dueTo) conds.push(lte(schema.records.dueDate, filter.dueTo));

  if (filter.search) {
    const needle = `%${filter.search}%`;
    conds.push(
      or(
        ilike(schema.records.reference, needle),
        ilike(schema.records.title, needle),
        ilike(schema.records.subjectName, needle),
      ),
    );
  }

  return conds.filter((c): c is SQL => c !== undefined);
}

export interface RecordListRow {
  id: string;
  reference: string | null;
  title: string;
  subjectName: string | null;
  dueDate: Date | null;
  isArchived: boolean;
  typeName: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusCategory: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "CLOSED" | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
}

/** List records for the org, filtered; returns one page plus the total count. */
export async function listRecords(
  orgId: string,
  filter: RecordFilter,
): Promise<{ rows: RecordListRow[]; total: number }> {
  const where = and(...filterConditions(orgId, filter));

  const rows = await db
    .select({
      id: schema.records.id,
      reference: schema.records.reference,
      title: schema.records.title,
      subjectName: schema.records.subjectName,
      dueDate: schema.records.dueDate,
      isArchived: schema.records.isArchived,
      typeName: schema.recordTypes.name,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      statusCategory: schema.statuses.category,
      assigneeName: schema.users.name,
      assigneeEmail: schema.users.email,
    })
    .from(schema.records)
    .leftJoin(schema.statuses, eq(schema.records.statusId, schema.statuses.id))
    .leftJoin(schema.recordTypes, eq(schema.records.recordTypeId, schema.recordTypes.id))
    .leftJoin(schema.users, eq(schema.records.assigneeId, schema.users.id))
    .where(where)
    .orderBy(asc(schema.records.dueDate), desc(schema.records.updatedAt))
    .limit(RECORDS_PAGE_SIZE);

  // The where clause may reference statuses.category, so the count needs the
  // same join.
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.records)
    .leftJoin(schema.statuses, eq(schema.records.statusId, schema.statuses.id))
    .where(where);

  return { rows, total };
}

/** One record with its type/status/assignee resolved, scoped to the org. */
export async function getRecordDetail(orgId: string, id: string) {
  return db.query.records.findFirst({
    where: and(eq(schema.records.id, id), eq(schema.records.orgId, orgId)),
    with: { recordType: true, status: true, assignee: true },
  });
}

export type RecordDetail = NonNullable<Awaited<ReturnType<typeof getRecordDetail>>>;

/** Options the create/edit form needs: record types, statuses, org members. */
export async function getRecordFormOptions(orgId: string) {
  const [recordTypes, statuses, members] = await Promise.all([
    db
      .select({
        id: schema.recordTypes.id,
        name: schema.recordTypes.name,
      })
      .from(schema.recordTypes)
      .where(and(eq(schema.recordTypes.orgId, orgId), eq(schema.recordTypes.isActive, true)))
      .orderBy(asc(schema.recordTypes.sortOrder), asc(schema.recordTypes.name)),
    db
      .select({
        id: schema.statuses.id,
        name: schema.statuses.name,
        category: schema.statuses.category,
      })
      .from(schema.statuses)
      .where(eq(schema.statuses.orgId, orgId))
      .orderBy(asc(schema.statuses.sortOrder), asc(schema.statuses.name)),
    db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(eq(schema.memberships.orgId, orgId))
      .orderBy(asc(schema.users.name)),
  ]);

  return { recordTypes, statuses, members };
}

export type RecordFormOptions = Awaited<ReturnType<typeof getRecordFormOptions>>;

/** Latest audit entries for one record (who did what, most recent first). */
export async function listRecordActivity(orgId: string, recordId: string, limit = 10) {
  return db
    .select({
      id: schema.auditLog.id,
      action: schema.auditLog.action,
      diff: schema.auditLog.diff,
      at: schema.auditLog.at,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
    .where(
      and(
        eq(schema.auditLog.orgId, orgId),
        eq(schema.auditLog.entity, "record"),
        eq(schema.auditLog.entityId, recordId),
      ),
    )
    .orderBy(desc(schema.auditLog.at))
    .limit(limit);
}
