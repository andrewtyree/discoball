/**
 * Database restore drill — `npm run db:restore [-- --file <dump>] [--keep]`.
 *
 * SAFE BY DEFAULT: restores the newest ./backups dump into a SCRATCH
 * database (discoball_restore_check) inside the compose container, prints
 * row counts from the restored copy next to the live database's counts, and
 * drops the scratch DB — the live database is never touched. This is the
 * documented way to prove a backup actually restores.
 *
 * Options:
 *   --file <path>   restore a specific dump (default: newest in ./backups)
 *   --target <db>   scratch database name (default discoball_restore_check)
 *   --keep          keep the scratch database for inspection
 *
 * Restoring OVER the live database is deliberately not automated — the
 * exact commands are documented in docs/ops.md ("Restoring for real").
 */
import { spawn } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

const CONTAINER = process.env.DB_CONTAINER ?? "discoball-db";
const DB_USER = process.env.DB_USER ?? "discoball";
const LIVE_DB = process.env.DB_NAME ?? "discoball";
const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const target = argValue("--target") ?? "discoball_restore_check";
const keep = args.includes("--keep");

if (target === LIVE_DB) {
  console.error(
    `Refusing to restore over the live database "${LIVE_DB}" — see docs/ops.md for the manual procedure.`,
  );
  process.exit(1);
}

let file = argValue("--file");
if (!file) {
  const dumps = (await readdir(BACKUP_DIR).catch(() => []))
    .filter((f) => /^discoball-.*\.dump$/.test(f))
    .sort()
    .reverse();
  if (dumps.length === 0) {
    console.error(`No dumps found in ${BACKUP_DIR} — run \`npm run db:backup\` first.`);
    process.exit(1);
  }
  file = join(BACKUP_DIR, dumps[0]);
}

function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "inherit"], ...opts });
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${cmd} ${cmdArgs.join(" ")} → exit ${code}`)),
    );
  });
}

const psql = (db, sql) =>
  run("docker", ["exec", CONTAINER, "psql", "-U", DB_USER, "-d", db, "-tAc", sql]);

console.log(`Restore drill: ${file} → scratch database "${target}" in ${CONTAINER}`);

// Fresh scratch DB.
await psql(LIVE_DB, `DROP DATABASE IF EXISTS ${target}`);
await psql(LIVE_DB, `CREATE DATABASE ${target}`);

// Feed the dump to pg_restore over stdin (the file lives on the host).
const dumpFile = await open(file, "r");
const restore = spawn(
  "docker",
  ["exec", "-i", CONTAINER, "pg_restore", "-U", DB_USER, "-d", target, "--no-owner"],
  { stdio: [dumpFile.createReadStream(), "inherit", "inherit"] },
);
const code = await new Promise((resolve) => restore.on("close", resolve));
if (code !== 0) {
  console.error(`pg_restore failed (exit ${code}).`);
  process.exit(1);
}

// Spot-check: row counts in the restored copy vs the live database.
const COUNT_SQL =
  "SELECT (SELECT count(*) FROM records) || '|' || (SELECT count(*) FROM audit_log) || '|' || (SELECT count(*) FROM users) || '|' || (SELECT count(*) FROM templates)";
const [restored, live] = await Promise.all([psql(target, COUNT_SQL), psql(LIVE_DB, COUNT_SQL)]);
const label = (s) => {
  const [records, audit, users, templates] = s.trim().split("|");
  return `records=${records} audit_log=${audit} users=${users} templates=${templates}`;
};
console.log(`Restored copy:  ${label(restored)}`);
console.log(`Live database:  ${label(live)}`);
console.log(
  restored.trim() === live.trim()
    ? "Counts match — the backup restores cleanly. ✓"
    : "Counts differ — expected if data changed since the dump was taken.",
);

if (keep) {
  console.log(`Scratch database "${target}" kept (--keep). Drop it with:`);
  console.log(`  docker exec ${CONTAINER} psql -U ${DB_USER} -d ${LIVE_DB} -c "DROP DATABASE ${target}"`);
} else {
  await psql(LIVE_DB, `DROP DATABASE ${target}`);
  console.log(`Scratch database dropped. Live database untouched.`);
}
