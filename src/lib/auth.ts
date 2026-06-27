/**
 * Authentication (Auth.js / NextAuth v5) — SCAFFOLD STUB.
 *
 * Phase 1 wires this up fully: a Credentials provider (email + hashed password)
 * plus an optional Google OAuth provider, backed by the Drizzle adapter so
 * sessions and accounts persist in Postgres. Identity is a real `users` row
 * resolved to an active org membership and role.
 *
 * Kept import-light on purpose so the rest of the scaffold builds before the
 * auth dependencies are configured.
 */

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  /** Active organization + role, resolved from `memberships`. */
  orgId: string;
  role: import("./rbac").Role;
}

/**
 * Returns the current signed-in user for a request, or null.
 *
 * TODO(Phase 1): implement with `auth()` from the NextAuth v5 handler and the
 * DrizzleAdapter; resolve the active membership/role. For now this returns null
 * so server components can render an unauthenticated shell.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  return null;
}
