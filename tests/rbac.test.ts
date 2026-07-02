import { describe, expect, it } from "vitest";

import { assertCan, can, ForbiddenError, type Permission, type Role } from "@/lib/rbac";

describe("can", () => {
  it("VIEWER can read but never mutate", () => {
    expect(can("VIEWER", "record:read")).toBe(true);
    expect(can("VIEWER", "template:read")).toBe(true);
    for (const p of [
      "record:write",
      "record:delete",
      "template:write",
      "generation:run",
      "config:write",
      "member:manage",
      "org:manage",
    ] as Permission[]) {
      expect(can("VIEWER", p), p).toBe(false);
    }
  });

  it("EDITOR can write records/templates but not configure or manage", () => {
    expect(can("EDITOR", "record:write")).toBe(true);
    expect(can("EDITOR", "generation:run")).toBe(true);
    expect(can("EDITOR", "record:delete")).toBe(false);
    expect(can("EDITOR", "config:write")).toBe(false);
    expect(can("EDITOR", "member:manage")).toBe(false);
  });

  it("ADMIN can configure and manage members, but not the org itself", () => {
    expect(can("ADMIN", "record:delete")).toBe(true);
    expect(can("ADMIN", "config:write")).toBe(true);
    expect(can("ADMIN", "member:manage")).toBe(true);
    expect(can("ADMIN", "org:manage")).toBe(false);
  });

  it("OWNER holds every permission", () => {
    for (const p of [
      "record:read",
      "record:write",
      "record:delete",
      "template:read",
      "template:write",
      "generation:run",
      "config:write",
      "member:manage",
      "org:manage",
    ] as Permission[]) {
      expect(can("OWNER", p), p).toBe(true);
    }
  });

  it("permissions strictly widen along VIEWER → EDITOR → ADMIN → OWNER", () => {
    const order: Role[] = ["VIEWER", "EDITOR", "ADMIN", "OWNER"];
    const all: Permission[] = [
      "record:read",
      "record:write",
      "record:delete",
      "template:read",
      "template:write",
      "generation:run",
      "config:write",
      "member:manage",
      "org:manage",
    ];
    for (let i = 1; i < order.length; i++) {
      for (const p of all) {
        if (can(order[i - 1], p)) {
          expect(can(order[i], p), `${order[i]} should keep ${p}`).toBe(true);
        }
      }
    }
  });
});

describe("assertCan", () => {
  it("passes silently when permitted", () => {
    expect(() => assertCan("EDITOR", "record:write")).not.toThrow();
  });

  it("throws a 403 ForbiddenError when not permitted", () => {
    try {
      assertCan("VIEWER", "record:write");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).status).toBe(403);
    }
  });
});
