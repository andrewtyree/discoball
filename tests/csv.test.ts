import { describe, expect, it } from "vitest";

import { CSV_BOM, CsvParseError, csvField, parseCsv, serializeCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF, LF, and bare-CR line endings", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f\rg,h")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
      ["g", "h"],
    ]);
  });

  it("parses quoted fields containing commas and quotes", () => {
    expect(parseCsv('"Reyes, Jordan","He said ""hi""",plain')).toEqual([
      ['Reyes, Jordan', 'He said "hi"', "plain"],
    ]);
  });

  it("keeps line breaks inside quoted fields", () => {
    expect(parseCsv('"line one\nline two",b\r\nnext,row')).toEqual([
      ["line one\nline two", "b"],
      ["next", "row"],
    ]);
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv(`${CSV_BOM}a,b`)).toEqual([["a", "b"]]);
  });

  it("treats empty fields as empty strings and keeps comma-only lines", () => {
    expect(parseCsv("a,,c\n,,")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("skips zero-length lines and a trailing newline", () => {
    expect(parseCsv("a,b\n\n\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("parses an empty quoted field", () => {
    expect(parseCsv('"",b')).toEqual([["", "b"]]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\r\n")).toEqual([]);
  });

  it("throws with the line number on an unterminated quote", () => {
    expect(() => parseCsv('a,b\nc,"broken')).toThrowError(CsvParseError);
    try {
      parseCsv('a,b\nc,"broken');
      expect.unreachable();
    } catch (err) {
      expect((err as CsvParseError).line).toBe(2);
    }
  });

  it("throws on content after a closing quote", () => {
    expect(() => parseCsv('"ok"stray,b')).toThrowError(CsvParseError);
  });

  it("throws on a quote opened mid-field", () => {
    expect(() => parseCsv('ab"cd,e')).toThrowError(CsvParseError);
  });

  it("counts quoted embedded newlines when reporting error lines", () => {
    try {
      parseCsv('"one\ntwo\nthree",ok\nx,"bad');
      expect.unreachable();
    } catch (err) {
      expect((err as CsvParseError).line).toBe(4);
    }
  });
});

describe("csvField", () => {
  it("leaves plain values unquoted", () => {
    expect(csvField("hello")).toBe("hello");
    expect(csvField("")).toBe("");
  });

  it("quotes values with commas, quotes, or line breaks", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField("cr\rhere")).toBe('"cr\rhere"');
  });
});

describe("serializeCsv", () => {
  it("emits BOM, CRLF endings, and a trailing newline", () => {
    expect(serializeCsv([["a", "b"], ["1", "2"]])).toBe(`${CSV_BOM}a,b\r\n1,2\r\n`);
  });

  it("serializes empty input to just the BOM", () => {
    expect(serializeCsv([])).toBe(CSV_BOM);
  });

  it("round-trips awkward data through parseCsv", () => {
    const rows = [
      ["reference", "subject name", "notes"],
      ["MAT-0001", "Reyes, Jordan", 'quoted "value"'],
      ["MAT-0002", "multi\nline", ""],
      ["MAT-0003", "", "trailing,comma,"],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
});
