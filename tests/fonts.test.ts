import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { FONTS } from "../src/editor/palette.ts";
import { schema } from "../src/editor/schema.ts";
import { toDocxParts } from "../src/export/docx.ts";
import { toRtf } from "../src/export/rtf.ts";

const root = new URL("../", import.meta.url);
const css = readFileSync(new URL("src/styles/fonts.css", root), "utf8");
const main = readFileSync(new URL("src/styles/main.css", root), "utf8");

test("every bundled font has its four styles, its files and its license", () => {
  const bundled = FONTS.filter((f) => f.bundled);
  assert.deepEqual(bundled.map((f) => f.name), ["Atkinson Hyperlegible", "Inter", "Literata", "JetBrains Mono"]);
  for (const f of bundled) {
    const rules = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]!).filter((r) => r.includes(`font-family: "${f.name}";`));
    const styles = new Set(rules.map((r) => `${/font-weight: (\d+)/.exec(r)![1]} ${/font-style: (\w+)/.exec(r)![1]}`));
    assert.deepEqual([...styles].sort(), ["400 italic", "400 normal", "700 italic", "700 normal"], f.name);
    assert.ok(f.stack.startsWith(f.name.includes(" ") ? `"${f.name}"` : f.name), "the stack starts with the bundled font");
    for (const r of rules) {
      const url = /url\("\/(fonts\/[^"]+)"\)/.exec(r)![1]!;
      assert.ok(existsSync(new URL(`public/${url}`, root)), url);
      const license = new URL(`public/${url.replace(/[^/]+$/, "OFL.txt")}`, root);
      assert.match(readFileSync(license, "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/, `${url} ships with its license`);
    }
  }
});

test("the fonts are loaded before any other rule and only from the app itself", () => {
  assert.ok(main.indexOf('@import "./fonts.css";') < main.indexOf("{"), "@import must come first");
  assert.doesNotMatch(css, /url\("?(https?:|\/\/)/);
});

test("code, in a block or inside a line, uses the Code style's font", () => {
  const line = schema.node("paragraph", null, [schema.text("x = 1", [schema.marks.code.create()])]);
  const doc = schema.node("doc", null, [line]);
  const xml = toDocxParts(doc, "t").find((p) => p.name === "word/document.xml")!.content;
  assert.match(xml, /<w:rFonts w:ascii="JetBrains Mono"[^>]*\/><\/w:rPr><w:t xml:space="preserve">x = 1/);
  const jetbrains = FONTS.findIndex((f) => f.key === "jetbrains");
  assert.ok(toRtf(doc).includes(`{\\f${jetbrains}\\fs24 x = 1}`), "RTF writes the code in JetBrains Mono");
  const courier = doc.type.create({ styles: { code: { font: "courier" } } }, doc.content);
  assert.match(toDocxParts(courier, "t").find((p) => p.name === "word/document.xml")!.content, /w:ascii="Courier New"/, "a chosen Code font wins");
});
