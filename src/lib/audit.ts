/**
 * Audit logging — SCAFFOLD STUB.
 *
 * Every mutation in DiscoBall records who changed what, when, into the
 * append-only `audit_log` table. Wired in Phase 1.
 */
import { db, schema } from "@/db";

export interface AuditEntry {
  orgId: string;
  userId?: string | null;
  entity: string;
  entityId?: string | null;
  action: string;
  diff?: Record<string, unknown> | null;
}

/** Anything that can run the audit insert — the db client or a transaction
 *  handle, so mutations can write their audit entry atomically. */
export type AuditExecutor = Pick<typeof db, "insert">;

/** Append an entry to the audit log. Pass the enclosing transaction as
 *  `executor` so the mutation and its audit entry commit (or roll back)
 *  together. */
export async function recordAudit(
  entry: AuditEntry,
  executor: AuditExecutor = db,
): Promise<void> {
  await executor.insert(schema.auditLog).values({
    orgId: entry.orgId,
    userId: entry.userId ?? null,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    diff: entry.diff ?? null,
  });
}

/**
 * Compute a compact before→after diff of changed fields, for storage in the
 * audit log. Only keys whose values differ are included.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      // Coerce undefined to null: JSONB serialization silently drops undefined
      // sides, leaving one-sided objects that break from→to rendering.
      diff[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return diff;
}
