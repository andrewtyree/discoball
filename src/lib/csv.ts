/**
 * CSV parsing and serialization (RFC 4180).
 *
 * The import wizard and the records export share this one implementation so
 * an exported file always re-imports byte-for-byte. Deliberately dependency-
 * free and pure — the whole module is unit-testable without I/O.
 *
 * Dialect notes:
 * - Fields containing commas, quotes, or line breaks are quoted; a quote
 *   inside a quoted field is escaped by doubling (`""`).
 * - The parser accepts CRLF, LF, and bare-CR line endings, strips a leading
 *   UTF-8 BOM, and skips zero-length lines (Excel loves trailing ones). A
 *   line of just commas is NOT empty — it is a row of empty fields.
 * - The serializer emits CRLF line endings and prepends a BOM so Excel
 *   detects UTF-8; `parseCsv` round-trips both.
 * - Malformed quoting (an unterminated quote, or content after a closing
 *   quote) throws `CsvParseError` with the 1-based line number, rather than
 *   silently mangling data.
 */

export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = "CsvParseError";
  }
}

/** Prepended by `serializeCsv`; stripped by `parseCsv`. */
export const CSV_BOM = "﻿";

/** Parse CSV text into rows of fields. Rows may have differing lengths. */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldCount = 0; // fields completed on the current line, to detect empty lines
  let inQuotes = false;
  let line = 1;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
    fieldCount += 1;
  };
  const endRow = () => {
    endField();
    // A zero-length line parses as one empty field and nothing else — skip it.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    fieldCount = 0;
  };

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
          const next = input[i];
          if (next !== undefined && next !== "," && next !== "\r" && next !== "\n") {
            throw new CsvParseError(`Unexpected character after closing quote: "${next}"`, line);
          }
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      if (field.length > 0) {
        throw new CsvParseError("Quote in the middle of an unquoted field", line);
      }
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      endField();
      i += 1;
    } else if (ch === "\r" || ch === "\n") {
      // Treat CRLF as one terminator; lone CR and lone LF also terminate.
      endRow();
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
      line += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (inQuotes) throw new CsvParseError("Unterminated quoted field", line);
  // Final row without a trailing newline.
  if (field.length > 0 || fieldCount > 0) endRow();
  return rows;
}

/** Quote a single field only when the dialect requires it. */
export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Serialize rows to CSV text: BOM + CRLF line endings + trailing newline. */
export function serializeCsv(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  return CSV_BOM + body + (rows.length > 0 ? "\r\n" : "");
}
