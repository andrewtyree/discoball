/**
 * Database backup — `npm run db:backup`.
 *
 * Runs pg_dump (custom format, -Fc) inside the compose Postgres container
 * and writes ./backups/discoball-<timestamp>.dump, then prunes to the newest
 * 14 dumps. Portable Node instead of a shell script so the same command
 * works on Windows and POSIX. Restore procedure: scripts/db-restore.mjs and
 * docs/ops.md.
 *
 * NOTE: uploaded files (STORAGE_DIR, default ./data/uploads) are NOT in the
 * database — back that directory up separately (see docs/ops.md).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const CONTAINER = process.env.DB_CONTAINER ?? "discoball-db";
const DB_USER = process.env.DB_USER ?? "discoball";
const DB_NAME = process.env.DB_NAME ?? "discoball";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15); // yyyymmdd-hhmmss
const outPath = join(BACKUP_DIR, `discoball-${stamp}.dump`);

await mkdir(BACKUP_DIR, { recursive: true });

console.log(`Backing up ${DB_NAME} from container ${CONTAINER} → ${outPath}`);

const dump = spawn(
  "docker",
  ["exec", CONTAINER, "pg_dump", "-U", DB_USER, "-d", DB_NAME, "-Fc"],
  { stdio: ["ignore", "pipe", "inherit"] },
);
const out = createWriteStream(outPath);
dump.stdout.pipe(out);

const code = await new Promise((resolve) => dump.on("close", resolve));
await new Promise((resolve) => out.close(resolve));

if (code !== 0) {
  await unlink(outPath).catch(() => {});
  console.error(`pg_dump failed (exit ${code}). Is the ${CONTAINER} container running?`);
  process.exit(1);
}

const { size } = await stat(outPath);
console.log(`Backup complete: ${outPath} (${(size / 1024).toFixed(0)} KB)`);

// Retention: keep the newest KEEP dumps.
const dumps = (await readdir(BACKUP_DIR))
  .filter((f) => /^discoball-.*\.dump$/.test(f))
  .sort()
  .reverse();
for (const old of dumps.slice(KEEP)) {
  await unlink(join(BACKUP_DIR, old));
  console.log(`Pruned old backup: ${old}`);
}
