/**
 * Role-based access control.
 *
 * Explicit, enforceable permissions per organization role. The matrix below is
 * the single source of truth; the API authorization layer (Phase 1) calls
 * `can()` before every mutation.
 */
export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type Permission =
  | "record:read"
  | "record:write"
  | "record:delete"
  | "template:read"
  | "template:write"
  | "generation:run"
  | "config:write" // record types, custom fields, statuses, codes
  | "member:manage"
  | "org:manage";

const MATRIX: Record<Role, Permission[]> = {
  VIEWER: ["record:read", "template:read"],
  EDITOR: [
    "record:read",
    "record:write",
    "template:read",
    "template:write",
    "generation:run",
  ],
  ADMIN: [
    "record:read",
    "record:write",
    "record:delete",
    "template:read",
    "template:write",
    "generation:run",
    "config:write",
    "member:manage",
  ],
  OWNER: [
    "record:read",
    "record:write",
    "record:delete",
    "template:read",
    "template:write",
    "generation:run",
    "config:write",
    "member:manage",
    "org:manage",
  ],
};

/** Does the given role hold the given permission? */
export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

/** Throw a typed error if a role lacks a permission (used by the API layer). */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new ForbiddenError(`Role ${role} lacks permission ${permission}`);
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
