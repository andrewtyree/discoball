/**
 * Bulk seed — piles thousands of extra fictional records onto the demo org so
 * the Phase 2 list-performance target (filter/search across thousands of rows,
 * p95 < 200 ms) can be measured against something real.
 *
 * Idempotent-ish: bulk records are recognizable by their `BLK-` reference
 * prefix and are deleted and regenerated on each run. The base seed
 * (`npm run db:seed`) must have run first.
 *
 *   npm run db:seed:bulk            # default 5,000 records
 *   npm run db:seed:bulk -- 12000   # custom count
 */
import { asc, eq, like } from "drizzle-orm";

import { db, schema } from "./index";

const count = Number(process.argv[2] ?? 5000);
if (!Number.isInteger(count) || count < 1 || count > 200_000) {
  console.error(`Invalid record count: ${process.argv[2]}`);
  process.exit(1);
}

/** Deterministic PRNG (mulberry32) so reruns produce identical data. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xd15c0);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** All names below are invented for demonstration. */
const VERBS = [
  "Onboarding", "Renewal", "Review", "Audit", "Migration", "Assessment",
  "Filing", "Inspection", "Settlement", "Rollout", "Upgrade", "Transfer",
];
const TOPICS = [
  "vendor agreement", "service contract", "compliance report", "license",
  "insurance claim", "site survey", "equipment lease", "records request",
  "budget proposal", "safety plan", "data export", "maintenance window",
];
const SUBJECT_FIRST = [
  "Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Wonka",
  "Tyrell", "Cyberdyne", "Hooli", "Vandelay", "Prestige",
];
const SUBJECT_SECOND = [
  "Industries", "Logistics", "Holdings", "Partners", "Labs", "Worldwide",
  "Manufacturing", "Consulting", "Ventures", "Group", "Supply Co.", "Systems",
];

async function main() {
  console.log(`Bulk-seeding ${count.toLocaleString()} fictional records…`);

  const org = await db.query.organizations.findFirst({
    orderBy: [asc(schema.organizations.createdAt)],
  });
  if (!org) {
    console.error("No organization found — run `npm run db:seed` first.");
    process.exit(1);
  }

  const [types, statuses, members] = await Promise.all([
    db.select().from(schema.recordTypes).where(eq(schema.recordTypes.orgId, org.id)),
    db.select().from(schema.statuses).where(eq(schema.statuses.orgId, org.id)),
    db.select().from(schema.memberships).where(eq(schema.memberships.orgId, org.id)),
  ]);
  if (types.length === 0) {
    console.error("The org has no record types — run `npm run db:seed` first.");
    process.exit(1);
  }

  const removed = await db
    .delete(schema.records)
    .where(like(schema.records.reference, "BLK-%"))
    .returning({ id: schema.records.id });
  if (removed.length > 0) {
    console.log(`Removed ${removed.length.toLocaleString()} bulk records from a previous run.`);
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  type NewRecord = typeof schema.records.$inferInsert;
  const batch: NewRecord[] = [];
  let inserted = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await db.insert(schema.records).values(batch);
    inserted += batch.length;
    batch.length = 0;
    process.stdout.write(`\r  inserted ${inserted.toLocaleString()} / ${count.toLocaleString()}`);
  };

  for (let i = 1; i <= count; i++) {
    // Spread openings over the past year; due dates cluster around "soon",
    // with ~15% having no due date at all.
    const openedDaysAgo = Math.floor(rand() * 365);
    const dueInDays = rand() < 0.15 ? null : Math.floor(rand() * 240) - 60;

    batch.push({
      orgId: org.id,
      recordTypeId: pick(types).id,
      statusId: rand() < 0.05 ? null : pick(statuses).id,
      assigneeId: rand() < 0.1 ? null : pick(members).userId,
      reference: `BLK-${String(i).padStart(6, "0")}`,
      title: `${pick(VERBS)} — ${pick(TOPICS)} #${i}`,
      subjectName: `${pick(SUBJECT_FIRST)} ${pick(SUBJECT_SECOND)}`,
      openedDate: new Date(now - openedDaysAgo * DAY),
      dueDate: dueInDays === null ? null : new Date(now + dueInDays * DAY),
      isArchived: rand() < 0.06,
      archivedReason: null,
    });

    if (batch.length >= 500) await flush();
  }
  await flush();

  console.log(`\nBulk seed complete: ${inserted.toLocaleString()} records in org "${org.name}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bulk seed failed:", err);
  process.exit(1);
});
