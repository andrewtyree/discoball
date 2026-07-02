/**
 * Local object storage — the minimal storage abstraction behind uploaded
 * templates and generated artifacts.
 *
 * Objects live under STORAGE_DIR (default ./data/uploads, gitignored) and are
 * addressed by forward-slash relative keys like "templates/<uuid>.docx" or
 * "runs/<uuid>.zip". The key grammar is deliberately strict — every segment
 * must start with an alphanumeric and may only contain [A-Za-z0-9._-] — so
 * traversal ("../"), absolute paths, drive letters, and backslashes are
 * rejected before any filesystem call (unit-tested in tests/storage.test.ts).
 *
 * Swapping this for S3/GCS later only means reimplementing these four
 * functions; callers never touch paths directly.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Thrown when a key is unsafe (traversal, absolute, bad characters). */
export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = "StorageKeyError";
  }
}

/** One key segment: starts alphanumeric, then alphanumerics, ".", "_", "-".
 *  A leading dot is disallowed, which also rejects "." and ".." outright. */
const KEY_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validate a storage key; throws StorageKeyError on anything suspicious. */
export function assertSafeKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) {
    throw new StorageKeyError(key);
  }
  // Backslashes, absolute paths, and drive letters are never valid keys.
  if (key.includes("\\") || key.startsWith("/") || /^[A-Za-z]:/.test(key)) {
    throw new StorageKeyError(key);
  }
  for (const segment of key.split("/")) {
    if (!KEY_SEGMENT_RE.test(segment)) throw new StorageKeyError(key);
  }
}

/** Resolved at call time so tests can point STORAGE_DIR at a temp dir. */
function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR ?? "./data/uploads");
}

/** Absolute filesystem path for a key (validating the key first). */
export function objectPath(key: string): string {
  assertSafeKey(key);
  const root = storageRoot();
  const abs = path.resolve(root, key);
  // Belt-and-braces: even a key that passed the grammar must resolve inside
  // the storage root.
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new StorageKeyError(key);
  }
  return abs;
}

/** Write an object, creating parent directories as needed. */
export async function putObject(key: string, bytes: Uint8Array): Promise<void> {
  const filePath = objectPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

/** Read an object's bytes. Rejects if the object does not exist. */
export async function getObject(key: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(objectPath(key)));
}

/** Delete an object. Missing objects are a no-op (idempotent cleanup). */
export async function deleteObject(key: string): Promise<void> {
  await rm(objectPath(key), { force: true });
}
