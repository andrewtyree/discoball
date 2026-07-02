/**
 * Discovery + render round trip on real (minimal) .docx files built in-test
 * with pizzip: discover tags — including Word run-split tags a regex can't
 * see — render with data, unzip the output, and assert the merged text and
 * the missing-tag report. No Gotenberg (PDF) here; toPdf needs the service.
 */
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { renderDocx } from "@/lib/templates/engine";
import {
  discoverTemplatePlaceholders,
  InvalidTemplateError,
} from "@/lib/templates/discover";
import { discoverPlaceholders } from "@/lib/templates/placeholders";

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

/** Build a minimal real .docx whose body is the given WordprocessingML. */
function makeDocx(bodyXml: string): Uint8Array {
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${bodyXml}</w:body></w:document>`;
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", document);
  return zip.generate({ type: "uint8array" });
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;

describe("discoverTemplatePlaceholders", () => {
  it("discovers simple tags", () => {
    const docx = makeDocx(para(run("Dear {subjectName}, re {reference}.")));
    expect(discoverTemplatePlaceholders(docx)).toEqual(["subjectName", "reference"]);
  });

  it("reassembles tags Word split across runs (regex would miss these)", () => {
    const docx = makeDocx(para(run("Dear {sub"), run("jectName}, re {refer"), run("ence}.")));
    expect(discoverTemplatePlaceholders(docx)).toEqual(["subjectName", "reference"]);
  });

  it("matches placeholders.ts semantics for loops and inverted sections", () => {
    const text = "{#items}{name}{/items}{^empty}none{/empty} {dueDate}";
    const docx = makeDocx(para(run(text)));
    expect(discoverTemplatePlaceholders(docx)).toEqual(discoverPlaceholders(text));
    expect(discoverTemplatePlaceholders(docx)).toEqual([
      "items",
      "name",
      "empty",
      "dueDate",
    ]);
  });

  it("rejects a buffer that is not a zip", () => {
    const notZip = new TextEncoder().encode("definitely not a word file");
    expect(() => discoverTemplatePlaceholders(notZip)).toThrow(InvalidTemplateError);
    expect(() => discoverTemplatePlaceholders(notZip)).toThrow(/doesn't look like a \.docx/);
  });

  it("rejects a zip without word/document.xml", () => {
    const zip = new PizZip();
    zip.file("hello.txt", "hi");
    const bytes = zip.generate({ type: "uint8array" }) as Uint8Array;
    expect(() => discoverTemplatePlaceholders(bytes)).toThrow(InvalidTemplateError);
  });
});

describe("renderDocx round trip", () => {
  it("merges data into the document and reports tags that had no value", async () => {
    const docx = makeDocx(
      para(run("Dear {sub"), run("jectName}, your case {reference} is due {dueDate}.")),
    );

    const { bytes, missingTags } = await renderDocx(docx, {
      data: { subjectName: "Ada Lovelace", reference: "BLK-0007" },
    });

    const out = new PizZip(bytes);
    const xml = out.file("word/document.xml")!.asText();
    // The tag was split across two runs, so the merged sentence is too —
    // compare the plain text with markup stripped.
    const text = xml.replace(/<[^>]+>/g, "");
    expect(text).toContain("Dear Ada Lovelace, your case BLK-0007 is due .");
    expect(text).not.toContain("{subjectName}");
    expect(missingTags).toEqual(["dueDate"]);
  });

  it("reports no missing tags when every tag has a value", async () => {
    const docx = makeDocx(para(run("{a} and {b}")));
    const { bytes, missingTags } = await renderDocx(docx, {
      data: { a: "one", b: "two" },
    });
    expect(missingTags).toEqual([]);
    const text = new PizZip(bytes).file("word/document.xml")!.asText();
    expect(text).toContain("one and two");
  });

  it("renders loops without flagging loop tags as missing", async () => {
    const docx = makeDocx(para(run("{#items}[{name}]{/items}")));
    const { bytes, missingTags } = await renderDocx(docx, {
      data: { items: [{ name: "x" }, { name: "y" }] },
    });
    expect(missingTags).toEqual([]);
    const text = new PizZip(bytes).file("word/document.xml")!.asText();
    expect(text).toContain("[x][y]");
  });

  it("throws a friendly error on a malformed template", async () => {
    const docx = makeDocx(para(run("{unclosed")));
    await expect(renderDocx(docx, { data: {} })).rejects.toThrow(/Template rendering failed/);
  });
});
