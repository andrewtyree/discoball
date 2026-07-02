/**
 * Phase 2 perf acceptance: filter/search across thousands of records must stay
 * under 200 ms p95 (ROADMAP §4). Exercises the real listRecords query layer
 * against the live database over a spread of filter/sort/search shapes.
 *
 *   npm run db:seed:bulk   # thousands of records first
 *   npx tsx scripts/perf-records.ts
 */
import { asc } from "drizzle-orm";

import { db, schema } from "@/db";
import { parseRecordFilter } from "@/lib/records/filters";
import { listRecords } from "@/lib/records/queries";

async function main() {
  const org = await db.query.organizations.findFirst({
    orderBy: [asc(schema.organizations.createdAt)],
  });
  if (!org) throw new Error("No organization — seed the database first.");

  const shapes: Record<string, unknown>[] = [
    {},
    { search: "Onboarding" },
    { search: "acme" },
    { state: "closed" },
    { state: "all", includeArchived: true, sort: "updatedAt", dir: "desc" },
    { sort: "title", dir: "asc", page: 3 },
    { sort: "assignee", dir: "desc", pageSize: 100 },
    { search: "vendor", state: "all", sort: "reference", dir: "desc" },
    { dueFrom: "2026-07-01", dueTo: "2026-09-30" },
    { search: "BLK-00", sort: "dueDate", dir: "desc", page: 5 },
  ];

  // Warm-up round (connection pool, plan cache).
  for (const s of shapes) await listRecords(org.id, parseRecordFilter(s));

  const times: number[] = [];
  for (const s of shapes) {
    const ms: number[] = [];
    let total = 0;
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      const r = await listRecords(org.id, parseRecordFilter(s));
      ms.push(performance.now() - t0);
      total = r.total;
    }
    times.push(...ms);
    const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
    console.log(`  ${JSON.stringify(s)}  total=${total}  avg=${avg.toFixed(1)}ms`);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  console.log(
    `samples=${sorted.length}  p50=${p(0.5).toFixed(1)}ms  p95=${p(0.95).toFixed(1)}ms  max=${sorted[
      sorted.length - 1
    ].toFixed(1)}ms`,
  );
  const pass = p(0.95) < 200;
  console.log(pass ? "PASS: p95 < 200ms" : "FAIL: p95 >= 200ms");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
