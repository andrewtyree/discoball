/**
 * Decompression-bomb guard: the 10 MB upload cap limits COMPRESSED size only
 * (deflate reaches ~1000:1), so template processing verifies the cumulative
 * inflated size — with a bounded inflate, since declared sizes are
 * forgeable — before anything unzips the archive in memory.
 */
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { discoverTemplatePlaceholders, InvalidTemplateError } from "@/lib/templates/discover";
import {
  assertSafeInflatedSize,
  InflatedSizeError,
  MAX_INFLATED_TEMPLATE_BYTES,
} from "@/lib/templates/zip-guard";

/** Build a zip, then reload it from bytes so entries carry real compressed
 *  data (the shape uploaded templates arrive in). */
function loadedZip(entries: Record<string, string>): PizZip {
  const zip = new PizZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  const bytes = zip.generate({ type: "uint8array", compression: "DEFLATE" }) as Uint8Array;
  return new PizZip(bytes);
}

describe("assertSafeInflatedSize", () => {
  it("accepts a normal small archive", () => {
    const zip = loadedZip({
      "word/document.xml": "<w:document>hello {name}</w:document>",
    });
    expect(() => assertSafeInflatedSize(zip)).not.toThrow();
    expect(() => assertSafeInflatedSize(zip, 1024)).not.toThrow();
  });

  it("rejects when a single entry inflates past the ceiling", () => {
    // 1 MB of one repeated character compresses to ~1 KB — the exact shape
    // of a decompression bomb, just smaller.
    const zip = loadedZip({ "word/document.xml": " ".repeat(1024 * 1024) });
    expect(() => assertSafeInflatedSize(zip, 64 * 1024)).toThrow(InflatedSizeError);
  });

  it("rejects on the CUMULATIVE inflated size across entries", () => {
    const zip = loadedZip({
      "word/document.xml": "x".repeat(40 * 1024),
      "word/header1.xml": "y".repeat(40 * 1024),
    });
    expect(() => assertSafeInflatedSize(zip, 64 * 1024)).toThrow(InflatedSizeError);
    expect(() => assertSafeInflatedSize(zip, 128 * 1024)).not.toThrow();
  });

  it("ships a 50 MB default ceiling", () => {
    expect(MAX_INFLATED_TEMPLATE_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("discoverTemplatePlaceholders bomb gate", () => {
  it("rejects an over-inflating docx as an invalid template (friendly path)", () => {
    // Keep the test fast: ~60 MB inflated from a few KB compressed crosses
    // the real 50 MB ceiling without materialising the payload.
    const zip = new PizZip();
    zip.file("word/document.xml", "<w:document/>");
    zip.file("word/media/bomb.xml", " ".repeat(60 * 1024 * 1024));
    const bytes = zip.generate({ type: "uint8array", compression: "DEFLATE" }) as Uint8Array;
    expect(() => discoverTemplatePlaceholders(bytes)).toThrow(InvalidTemplateError);
    expect(() => discoverTemplatePlaceholders(bytes)).toThrow(/unreasonable size/);
  });
});
