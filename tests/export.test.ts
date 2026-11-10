import assert from "node:assert/strict";
import { test } from "node:test";
import { toDocxParts, xmlEscape } from "../src/export/docx.ts";
import { fromMarkdown, toMarkdown } from "../src/export/markdown.ts";
import { rtfEscape, toRtf } from "../src/export/rtf.ts";
import { toPlainText } from "../src/export/text.ts";
import { sampleDoc } from "./fixture.ts";

test("markdown export keeps structure and drops styling", () => {
  const md = toMarkdown(sampleDoc());
  assert.match(md, /^# Letter to Ada/);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /~~struck~~/);
  assert.match(md, /^- First$/m);
  assert.match(md, /^ {2}3\. Nested three$/m);
  assert.match(md, /^> A quote$/m);
  assert.doesNotMatch(md, /ff-|<span|class=/);
});

test("markdown round trip", () => {
  const doc = fromMarkdown("# Title\n\nSome **bold** and ~~gone~~ [link](http://x) ![img](y.png)\n\n1. one\n2. two\n\n#### deep\n");
  assert.equal(doc.child(0).type.name, "heading");
  assert.equal(doc.child(doc.childCount - 1).attrs.level, 3, "h4 clamps to h3");
  const text = doc.textContent;
  assert.match(text, /link/);
  assert.doesNotMatch(text, /http/);
  assert.match(toMarkdown(doc), /~~gone~~/);
});

test("markdown import treats raw html as literal text", () => {
  const doc = fromMarkdown("<script>alert(1)</script>\n\nhello <b onclick=x>there</b>");
  const json = JSON.stringify(doc.toJSON());
  assert.doesNotMatch(json, /"marks"/, "no markup is interpreted");
  assert.match(doc.textContent, /<script>alert\(1\)<\/script>/);
});

test("rtf escaping", () => {
  assert.equal(rtfEscape("a{b}\\c"), "a\\{b\\}\\\\c");
  assert.equal(rtfEscape("è"), "\\u232?");
  assert.equal(rtfEscape("\u{1F33F}"), "\\u-10180?\\u-8385?");
});

test("rtf document is balanced and uses the font and color tables", () => {
  const rtf = toRtf(sampleDoc());
  assert.ok(rtf.startsWith("{\\rtf1"));
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    if (rtf[i] === "\\") i++;
    else if (rtf[i] === "{") depth++;
    else if (rtf[i] === "}") depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth, 0);
  assert.match(rtf, /\\qc/);
  assert.match(rtf, /\\fs36/);
  assert.match(rtf, /\\cf1/);
});

test("plain text", () => {
  const txt = toPlainText(sampleDoc());
  assert.match(txt, /^- First$/m);
  assert.match(txt, /^ {4}3\. Nested three$/m);
  assert.match(txt, /^> A quote$/m);
});

test("docx parts are escaped and complete", () => {
  const parts = toDocxParts(sampleDoc(), 'A "title" & more');
  const names = parts.map((p) => p.name);
  assert.ok(names.includes("[Content_Types].xml") && names.includes("word/document.xml"));
  const doc = parts.find((p) => p.name === "word/document.xml")!.content;
  assert.match(doc, /&lt;tags&gt; &amp;/);
  assert.match(doc, /<w:jc w:val="center"\/>/);
  assert.match(doc, /<w:numId w:val="2"\/>/);
  const numbering = parts.find((p) => p.name === "word/numbering.xml")!.content;
  assert.match(numbering, /<w:startOverride w:val="3"\/>/);
  assert.equal(xmlEscape("a\u0001b"), "ab");
});
