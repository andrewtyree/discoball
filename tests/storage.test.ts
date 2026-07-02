/**
 * Local object storage: key sanitization (traversal/absolute keys must be
 * rejected before any filesystem call) and the put/get/delete round trip.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertSafeKey,
  deleteObject,
  getObject,
  objectPath,
  putObject,
  StorageKeyError,
} from "@/lib/storage";

let dir: string;
let previousStorageDir: string | undefined;

beforeAll(async () => {
  previousStorageDir = process.env.STORAGE_DIR;
  dir = await mkdtemp(path.join(tmpdir(), "discoball-storage-"));
  process.env.STORAGE_DIR = dir;
});

afterAll(async () => {
  if (previousStorageDir === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorageDir;
  await rm(dir, { recursive: true, force: true });
});

describe("storage key validation", () => {
  const badKeys = [
    "",
    ".",
    "..",
    "../evil.docx",
    "templates/../../evil.docx",
    "templates/..",
    "/etc/passwd",
    "/templates/a.docx",
    "C:/windows/system32",
    "c:foo",
    "C:\\windows\\system32",
    "templates\\a.docx",
    "templates//a.docx",
    "templates/.hidden",
    ".hidden/a.docx",
    "templates/./a.docx",
    "a".repeat(600),
  ];

  it.each(badKeys)("rejects %j", (key) => {
    expect(() => assertSafeKey(key)).toThrow(StorageKeyError);
    expect(() => objectPath(key)).toThrow(StorageKeyError);
  });

  const goodKeys = [
    "templates/1f2e3d4c.docx",
    "runs/abc-123.zip",
    "a/b/c/d.txt",
    "file.docx",
    "UPPER_case-1.2.3.pdf",
  ];

  it.each(goodKeys)("accepts %j", (key) => {
    expect(() => assertSafeKey(key)).not.toThrow();
  });

  it("resolves keys inside the storage root", () => {
    const p = objectPath("templates/a.docx");
    expect(p.startsWith(path.resolve(dir) + path.sep)).toBe(true);
    expect(p.endsWith(path.join("templates", "a.docx"))).toBe(true);
  });
});

describe("storage round trip", () => {
  it("puts, gets, and deletes an object", async () => {
    const key = "templates/roundtrip.docx";
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

    await putObject(key, bytes);
    const readBack = await getObject(key);
    expect(Array.from(readBack)).toEqual(Array.from(bytes));

    await deleteObject(key);
    await expect(getObject(key)).rejects.toThrow();
  });

  it("deleteObject is a no-op for a missing key", async () => {
    await expect(deleteObject("runs/never-existed.zip")).resolves.toBeUndefined();
  });

  it("creates nested directories as needed", async () => {
    const key = "runs/deep/nested/artifact.zip";
    await putObject(key, new Uint8Array([9, 9]));
    expect(Array.from(await getObject(key))).toEqual([9, 9]);
  });
});
