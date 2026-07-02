/**
 * Optimistic concurrency for record edits.
 *
 * Every record carries a `version` integer that is bumped on each successful
 * write. An edit form submits the version it loaded; the UPDATE's WHERE clause
 * only matches while the row is still at that version, so a stale form matches
 * zero rows instead of silently clobbering the other writer (see
 * ./actions.ts). This predicate is the check's pure core, used for the
 * fast-path detection and unit-tested without a database.
 */

/** Has the row moved on since the edit was loaded? */
export function isStaleWrite(currentVersion: number, expectedVersion: number): boolean {
  return currentVersion !== expectedVersion;
}
