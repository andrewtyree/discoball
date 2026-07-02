/**
 * Decompression-bomb guard for uploaded .docx archives.
 *
 * The upload size check caps only the COMPRESSED bytes; deflate ratios reach
 * ~1000:1, so a 10 MB upload can inflate to ~10 GB the moment
 * pizzip/docxtemplater unzips it — a synchronous, multi-GB allocation that
 * blocks the event loop and can OOM the shared multi-tenant server process.
 * Before any template is compiled or rendered we verify the cumulative
 * inflated size stays under a hard ceiling. The zip's declared uncompressed
 * sizes are attacker-controlled (forgeable), so after the cheap declared-size
 * gate we do a BOUNDED inflate (zlib `maxOutputLength`) that aborts as soon
 * as the ceiling is crossed instead of materialising the payload.
 */
import { inflateRawSync } from "node:zlib";

import type PizZip from "pizzip";

/** Cumulative inflated-size ceiling for one template archive. */
export const MAX_INFLATED_TEMPLATE_BYTES = 50 * 1024 * 1024; // 50 MB

export class InflatedSizeError extends Error {
  constructor(maxBytes: number) {
    super(
      `Template unpacks to more than ${Math.round(maxBytes / (1024 * 1024))} MB — refusing to process it.`,
    );
    this.name = "InflatedSizeError";
  }
}

/** pizzip's STORE compression magic (js/compressions.js). */
const STORE_MAGIC = "\x00\x00";

/** The private shape pizzip gives a not-yet-inflated entry loaded from a
 *  buffer (js/compressedObject.js + js/zipEntry.js). */
interface RawCompressedData {
  uncompressedSize: number;
  compressionMethod: string;
  getCompressedContent(): unknown;
}

function isCompressedData(d: unknown): d is RawCompressedData {
  return (
    typeof d === "object" &&
    d !== null &&
    typeof (d as RawCompressedData).getCompressedContent === "function"
  );
}

function toBuffer(content: unknown): Buffer {
  if (typeof content === "string") return Buffer.from(content, "binary");
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  return Buffer.from([]);
}

function contentLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (content instanceof Uint8Array) return content.byteLength;
  if (content instanceof ArrayBuffer) return content.byteLength;
  return 0;
}

/**
 * Throw `InflatedSizeError` when the archive's entries would decompress to
 * more than `maxBytes` in total. Never allocates more than `maxBytes` while
 * checking. Entries that fail to inflate at all are skipped — pizzip or
 * docxtemplater will surface their own (friendlier) error for those.
 */
export function assertSafeInflatedSize(
  zip: PizZip,
  maxBytes: number = MAX_INFLATED_TEMPLATE_BYTES,
): void {
  let remaining = maxBytes;
  for (const entry of Object.values(zip.files)) {
    const data = (entry as unknown as { _data: unknown })._data;
    if (data == null) continue;
    if (!isCompressedData(data)) {
      // Already-inflated content (in-memory zips): its size is its length.
      remaining -= contentLength(data);
    } else if (data.compressionMethod === STORE_MAGIC) {
      // Stored entries can't inflate: actual size == stored size.
      remaining -= contentLength(data.getCompressedContent());
    } else {
      // Cheap gate on the declared size first, then the bounded inflate —
      // the declared central-directory size can be forged low.
      if (data.uncompressedSize > remaining) throw new InflatedSizeError(maxBytes);
      try {
        const inflated = inflateRawSync(toBuffer(data.getCompressedContent()), {
          maxOutputLength: Math.max(remaining, 1),
        });
        remaining -= inflated.byteLength;
      } catch (err) {
        if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
          throw new InflatedSizeError(maxBytes);
        }
        continue; // not inflatable — let the template engine report it
      }
    }
    if (remaining < 0) throw new InflatedSizeError(maxBytes);
  }
}
