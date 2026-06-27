/**
 * Seed script — loads demo data so a fresh clone has something to look at.
 * Run with `npm run db:seed`. All names, references, and codes are invented for
 * demonstration.
 *
 * The demo models a generic "client matters" workspace — deliberately neutral
 * so it reads naturally whether you think of records as cases, files, or
 * projects.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { db, schema } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "..", "data", "seed");

type DemoData = {
  organization: { name: string; slug: string };
  users: { email: string; name: string; role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" }[];
  recordTypes: { name: string; description: string; referencePrefix: string }[];
  statuses: { name: string; category: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "CLOSED"; color: string }[];
  contacts: {
    type: "COUNTERPARTY" | "WITNESS" | "COLLABORATOR" | "VENDOR" | "OTHER";
    displayName: string;
    fullName?: string;
    email?: string;
  }[];
  records: {
    reference: string;
    title: string;
    subjectName: string;
    recordType: string;
    status: string;
    assigneeEmail: string;
    dueInDays: number;
  }[];
};

/** Minimal CSV parser for the demo codes file (no quoted-comma edge cases). */
function parseCsv(text: string): Record<string, string>[] {
  // Strip a UTF-8 BOM (a leading BOM is not whitespace and would corrupt the
  // first header key, e.g. if the file is re-saved by a spreadsheet app).
  const [headerLine, ...lines] = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

async function main() {
  console.log("Seeding DiscoBall with fictional demo data…");

  const demo: DemoData = JSON.parse(readFileSync(join(seedDir, "demo-data.json"), "utf8"));
  const codeRows = parseCsv(readFileSync(join(seedDir, "codes.csv"), "utf8"));

  // Organization
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: demo.organization.name, slug: demo.organization.slug })
    .returning();

  // Users + memberships
  const usersByEmail = new Map<string, string>();
  for (const u of demo.users) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: u.email, name: u.name })
      .returning();
    usersByEmail.set(u.email, user.id);
    await db
      .insert(schema.memberships)
      .values({ orgId: org.id, userId: user.id, role: u.role });
  }

  // Record types
  const typesByName = new Map<string, string>();
  for (const [i, rt] of demo.recordTypes.entries()) {
    const [row] = await db
      .insert(schema.recordTypes)
      .values({
        orgId: org.id,
        name: rt.name,
        description: rt.description,
        referencePrefix: rt.referencePrefix,
        sortOrder: i,
      })
      .returning();
    typesByName.set(rt.name, row.id);
  }

  // Statuses
  const statusByName = new Map<string, string>();
  for (const [i, s] of demo.statuses.entries()) {
    const [row] = await db
      .insert(schema.statuses)
      .values({
        orgId: org.id,
        name: s.name,
        category: s.category,
        color: s.color,
        isDefault: i === 0,
        sortOrder: i,
      })
      .returning();
    statusByName.set(s.name, row.id);
  }

  // Codes / controlled vocabulary (generic, fictional)
  if (codeRows.length > 0) {
    await db.insert(schema.codes).values(
      codeRows.map((c) => ({
        orgId: org.id,
        groupName: c.group || null,
        code: c.code,
        description: c.description || null,
        shortLabel: c.shortLabel,
      })),
    );
  }

  // Contacts
  for (const c of demo.contacts) {
    await db.insert(schema.contacts).values({
      orgId: org.id,
      type: c.type,
      displayName: c.displayName,
      fullName: c.fullName ?? null,
      email: c.email ?? null,
    });
  }

  // Records
  const now = Date.now();
  for (const r of demo.records) {
    await db.insert(schema.records).values({
      orgId: org.id,
      recordTypeId: typesByName.get(r.recordType)!,
      statusId: statusByName.get(r.status) ?? null,
      assigneeId: usersByEmail.get(r.assigneeEmail) ?? null,
      reference: r.reference,
      title: r.title,
      subjectName: r.subjectName,
      openedDate: new Date(now),
      dueDate: new Date(now + r.dueInDays * 24 * 60 * 60 * 1000),
    });
  }

  console.log(
    `Seed complete: org "${org.name}", ${demo.users.length} users, ` +
      `${demo.records.length} records, ${codeRows.length} codes.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
