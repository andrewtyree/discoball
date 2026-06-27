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

/** Append an entry to the audit log. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
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
      diff[key] = { from: before[key], to: after[key] };
    }
  }
  return diff;
}
