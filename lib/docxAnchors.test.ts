/** Purpose: unit tests for reading picture anchors from word/document.xml (lib/docxAnchors.ts). */
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import PizZip from "pizzip";
import { NO_HYPHENS_CSS, parseAnchors } from "./docxAnchors";

const anchored = (h: string, v: string, wrap = "<wp:wrapSquare wrapText=\"bothSides\"/>") =>
  `<w:drawing><wp:anchor simplePos="0"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="${h}"><wp:posOffset>4352925</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="${v}"><wp:posOffset>19051</wp:posOffset></wp:positionV>${wrap}<pic:pic></pic:pic></wp:anchor></w:drawing>`;

test("a picture anchored to column/paragraph with square wrapping gets its offsets", () => {
  assert.deepEqual(parseAnchors(anchored("column", "paragraph")), [{ leftEmu: 4352925, topEmu: 19051 }]);
});

test("inline pictures, other anchoring and non-pictures give null / are skipped", () => {
  assert.deepEqual(parseAnchors(`<w:drawing><wp:inline><pic:pic></pic:pic></wp:inline></w:drawing>`), [null]);
  assert.deepEqual(parseAnchors(anchored("page", "paragraph")), [null]);
  assert.deepEqual(parseAnchors(anchored("column", "page")), [null]);
  assert.deepEqual(parseAnchors(`<w:drawing><wp:inline></wp:inline></w:drawing>`), []);
});

test("the real internal and external templates each anchor exactly one picture in the body, top right", () => {
  for (const id of ["internal", "external"]) {
    const xml = new PizZip(fs.readFileSync(`public/templates/${id}.docx`)).file("word/document.xml")!.asText();
    const a = parseAnchors(xml);
    assert.equal(a.length, 1, `${id}: one body picture`);
    assert.ok(a[0] && a[0].leftEmu > 0, `${id}: anchored with an offset`);
  }
});

test("hyphenation is switched off for the rendered pages", () => {
  assert.match(NO_HYPHENS_CSS, /hyphens:\s*manual\s*!important/);
});
