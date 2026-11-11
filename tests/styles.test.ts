import assert from "node:assert/strict";
import { test } from "node:test";
import { toDocxParts } from "../src/export/docx.ts";
import { toRtf } from "../src/export/rtf.ts";
import { DEFAULT_STYLES, normalizeStyles, resolveStyles, styleVars } from "../src/editor/styles.ts";
import { sampleDoc } from "./fixture.ts";

test("documents without styles use the defaults, in the document's font", () => {
  const st = resolveStyles({ font: "georgia", styles: null });
  assert.equal(st.normal.font.key, "georgia");
  assert.equal(st.h2.font.key, "georgia", "headings follow Normal's font");
  assert.equal(st.code.font.key, "courier");
  assert.equal(st.h1.size, 24);
  assert.equal(st.h2.size, 18);
  assert.equal(st.h3.size, 14);
  assert.equal(st.normal.lineHeight, 1.45);
});

test("stored styles keep only known values", () => {
  assert.equal(normalizeStyles(null), null);
  assert.equal(normalizeStyles([1]), null);
  const st = normalizeStyles({
    normal: { font: "times", size: 14 },
    h2: { size: 24, color: "navy", italic: true, font: "georgia", before: 32 },
    h3: { size: 13, color: "red;background:url(x)", font: "Papyrus", lineHeight: 9, after: -1 },
  })!;
  assert.equal(st.normal.font, "same", "Normal's font is the document's font attribute");
  assert.equal(st.normal.size, 14);
  assert.deepEqual(st.h2, { ...DEFAULT_STYLES.h2, size: 24, color: "navy", italic: true, font: "georgia", before: 32 });
  assert.deepEqual(st.h3, DEFAULT_STYLES.h3, "unknown values fall back to the defaults");
  assert.deepEqual(st.quote, DEFAULT_STYLES.quote);
});

test("style variables carry only values from the fixed lists", () => {
  const vars = new Map(styleVars({ font: "arial", styles: { h2: { size: 24, color: "navy" }, quote: {} } }));
  assert.equal(vars.get("--s-h2-size"), "24pt");
  assert.equal(vars.get("--s-h2-color"), "#3A4FA8");
  assert.equal(vars.get("--s-h1-color"), "inherit");
  assert.equal(vars.get("--s-quote-color"), "var(--soft)");
  assert.match(vars.get("--s-h2-font")!, /^Arial,/);
});

test("exports follow the document's styles", () => {
  const sample = sampleDoc();
  const styled = sample.type.create({ ...sample.attrs, styles: { h1: { size: 36, color: "navy", font: "georgia", bold: false } } }, sample.content);
  const styles = toDocxParts(styled, "t").find((p) => p.name === "word/styles.xml")!.content;
  assert.match(styles, /w:styleId="Heading1">.*?<w:rFonts w:ascii="Georgia".*?<w:b w:val="0"\/>.*?<w:color w:val="3A4FA8"\/><w:sz w:val="72"\/>/);
  assert.match(styles, /w:styleId="Heading2">.*?<w:b\/>.*?<w:sz w:val="36"\/>/, "other styles keep the defaults");
  const rtf = toRtf(styled);
  assert.match(rtf, /\{\\f3\\fs72\\cf7 Letter to Ada\}/, "the heading is Georgia 36 in navy, not bold");
  assert.doesNotMatch(toRtf(sample), /\\fs72/);
  assert.match(toRtf(sample), /\{\\f0\\fs48\\b Letter to Ada\}/, "the default heading is 24 pt bold");
});

test("headings and quotes lose hand-set font, size and color, but keep emphasis", async () => {
  const { EditorState } = await import("prosemirror-state");
  const { schema } = await import("../src/editor/schema.ts");
  const { lockTransaction, lockedRole } = await import("../src/editor/roles.ts");
  const m = schema.marks;
  const marked = [m.font.create({ key: "georgia" }), m.size.create({ key: "28" }), m.color.create({ key: "red" }), m.strong.create()];
  const doc = schema.node("doc", null, [
    schema.node("heading", { level: 2 }, [schema.text("Title", marked)]),
    schema.node("paragraph", null, [schema.text("Body", marked)]),
    schema.node("blockquote", null, [schema.node("paragraph", null, [schema.text("Quoted", marked)])]),
  ]);
  const state = EditorState.create({ doc });
  const next = state.apply(lockTransaction(state)!);
  const marksOf = (i: number) => {
    let names: string[] = [];
    next.doc.child(i).descendants((n) => void (n.isText && (names = n.marks.map((x) => x.type.name))));
    return names;
  };
  assert.deepEqual(marksOf(0), ["strong"], "the heading keeps only bold");
  assert.deepEqual(marksOf(1), ["font", "size", "color", "strong"], "Normal text keeps everything");
  assert.deepEqual(marksOf(2), ["strong"], "quoted text keeps only bold");
  assert.equal(lockTransaction(next), null);
  const { TextSelection } = await import("prosemirror-state");
  assert.equal(lockedRole(next.apply(next.tr.setSelection(TextSelection.create(next.doc, 2)))), "h2");
  assert.equal(lockedRole(next.apply(next.tr.setSelection(TextSelection.create(next.doc, 9)))), null);
  assert.equal(lockedRole(next.apply(next.tr.setSelection(TextSelection.create(next.doc, 2, 10)))), null, "a selection with Normal text is not locked");
});
