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
  assert.equal(st.code.font.key, "jetbrains", "code is JetBrains Mono, which comes with the app");
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

test("underline is a style option and reaches the editor, Word and RTF", () => {
  const styles = normalizeStyles({ h1: { underline: true }, normal: { underline: "yes" } })!;
  assert.equal(styles.h1.underline, true);
  assert.equal(styles.normal.underline, false, "only true or false");
  const vars = new Map(styleVars({ styles }));
  assert.equal(vars.get("--s-h1-deco"), "underline");
  assert.equal(vars.get("--s-normal-deco"), "none");
  const sample = sampleDoc();
  const doc = sample.type.create({ ...sample.attrs, styles }, sample.content);
  const word = toDocxParts(doc, "t").find((p) => p.name === "word/styles.xml")!.content;
  assert.match(word, /w:styleId="Heading1">.*?<w:u w:val="single"\/><\/w:rPr>/);
  assert.match(word, /w:styleId="Heading2">.*?<w:u w:val="none"\/><\/w:rPr>/);
  assert.match(toRtf(doc), /\{\\f\d+\\fs48\\b\\ul Letter to Ada\}/);
});

test("the horizontal rule style is checked and reaches the editor, Word and RTF", () => {
  assert.deepEqual(normalizeStyles({})!.rule, DEFAULT_STYLES.rule, "documents with older styles get the default rule");
  const rule = normalizeStyles({ rule: { color: "red", thickness: 3, line: "dashed", width: 50, before: 6, after: 20 } })!.rule;
  assert.deepEqual(rule, { color: "red", thickness: 3, line: "dashed", width: 50, before: 6, after: 20 });
  const bad = normalizeStyles({ rule: { color: "red;x", thickness: 7, line: "groove", width: 33, before: -1 } })!.rule;
  assert.deepEqual(bad, DEFAULT_STYLES.rule);

  const styles = { rule };
  const vars = new Map(styleVars({ styles }));
  assert.deepEqual(
    ["color", "opacity", "thick", "line", "width", "before"].map((k) => vars.get(`--s-rule-${k}`)),
    ["#D43B3B", "1", "3pt", "dashed", "50%", "6pt"],
  );
  assert.equal(new Map(styleVars({})).get("--s-rule-color"), "var(--rule-auto)", "automatic follows the theme");

  const sample = sampleDoc();
  const doc = sample.type.create({ ...sample.attrs, styles }, sample.content);
  const xml = toDocxParts(doc, "t").find((p) => p.name === "word/document.xml")!.content;
  assert.match(xml, /<w:pBdr><w:bottom w:val="dashed" w:sz="24" w:space="1" w:color="D43B3B"\/><\/w:pBdr><w:spacing w:before="120" w:after="400"[^>]*\/><w:ind w:left="2257" w:right="2257"\/>/);
  assert.match(toRtf(doc), /\\pard\\plain\\sb120\\sa400\\li2257\\ri2257\\brdrb\\brdrdash\\brdrw60\\brdrcf1\\brsp20\\fs2 \\par/);
  const plain = toDocxParts(sampleDoc(), "t").find((p) => p.name === "word/document.xml")!.content;
  assert.match(plain, /<w:bottom w:val="single" w:sz="12" w:space="1" w:color="auto"\/>/, "the default is 1.5 pt, in the text color");
});

test("Enter keeps the font and size picked for Normal text, but not after a heading", async () => {
  const { EditorState, TextSelection } = await import("prosemirror-state");
  const { schema } = await import("../src/editor/schema.ts");
  const { enter } = await import("../src/editor/setup.ts");
  const m = schema.marks;
  const georgia = [m.font.create({ key: "georgia" }), m.size.create({ key: "16" })];
  const press = (state: InstanceType<typeof EditorState>) => {
    let next = state;
    assert.ok(enter(state, (tr) => (next = state.apply(tr))));
    return next;
  };
  const keys = (marks: readonly { type: { name: string }; attrs: { key?: unknown } }[] | null) => (marks ?? []).map((x) => `${x.type.name}:${x.attrs.key ?? ""}`);

  // Typed text, caret at its end: the new paragraph starts in Georgia 16.
  const typed = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Hello", [...georgia, m.code.create()])])]);
  let state = EditorState.create({ doc: typed, selection: TextSelection.create(typed, 6) });
  state = press(state);
  assert.equal(state.selection.$from.parent.content.size, 0, "the caret is in the new paragraph");
  assert.deepEqual(keys(state.storedMarks), ["font:georgia", "size:16"], "inline code does not carry over");
  // Pressing Enter again on the empty line still keeps them.
  assert.deepEqual(keys(press(state).storedMarks), ["font:georgia", "size:16"]);

  // A font picked on an empty line (stored marks) survives Enter before typing.
  const empty = schema.node("doc", null, [schema.node("paragraph")]);
  state = EditorState.create({ doc: empty }).apply(EditorState.create({ doc: empty }).tr.setStoredMarks(georgia));
  assert.deepEqual(keys(press(state).storedMarks), ["font:georgia", "size:16"]);

  // List items keep them too.
  const list = schema.node("doc", null, [schema.node("bullet_list", null, [schema.node("list_item", null, [schema.node("paragraph", null, [schema.text("Item", georgia)])])])]);
  state = press(EditorState.create({ doc: list, selection: TextSelection.create(list, 7) }));
  assert.equal(state.doc.firstChild!.childCount, 2, "a new list item");
  assert.deepEqual(keys(state.storedMarks), ["font:georgia", "size:16"]);

  // After a heading, the next paragraph starts clean.
  const heading = schema.node("doc", null, [schema.node("heading", { level: 1 }, [schema.text("Title", [m.strong.create()])])]);
  state = press(EditorState.create({ doc: heading, selection: TextSelection.create(heading, 6) }));
  assert.equal(state.selection.$from.parent.type, schema.nodes.paragraph);
  assert.deepEqual(keys(state.storedMarks), []);
});

test("Update Normal to match copies font and size into Normal and drops marks that became redundant", async () => {
  const { EditorState, TextSelection } = await import("prosemirror-state");
  const { schema } = await import("../src/editor/schema.ts");
  const { updateNormalToMatch } = await import("../src/editor/commands.ts");
  const m = schema.marks;
  const georgia16 = [m.font.create({ key: "georgia" }), m.size.create({ key: "16" })];
  const doc = schema.node("doc", { font: "trebuchet" }, [
    schema.node("paragraph", null, [schema.text("Here", georgia16)]),
    schema.node("paragraph", null, [schema.text("Also", [m.font.create({ key: "georgia" })]), schema.text("Times", [m.font.create({ key: "times" })])]),
    schema.node("heading", { level: 1 }, [schema.text("Title")]),
  ]);
  const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
  let next = state;
  assert.ok(updateNormalToMatch(state, (tr) => (next = state.apply(tr))));
  assert.equal(next.doc.attrs.font, "georgia");
  assert.equal(resolveStyles(next.doc.attrs).normal.size, 16);
  assert.equal(resolveStyles(next.doc.attrs).h1.size, 24, "other styles are untouched");
  const marksOf = (text: string) => {
    let out: string[] = [];
    next.doc.descendants((n) => void (n.isText && n.text === text && (out = n.marks.map((x) => `${x.type.name}:${x.attrs.key}`))));
    return out;
  };
  assert.deepEqual(marksOf("Here"), [], "the text now follows Normal");
  assert.deepEqual(marksOf("Also"), [], "so does other text in the same font");
  assert.deepEqual(marksOf("Times"), ["font:times"], "other fonts stay");
  assert.ok(next.doc.attrs.styles, "the document now stores its styles");

  // Not in a heading: there font and size come from the heading's style.
  const inHeading = EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 2) });
  assert.equal(updateNormalToMatch(inHeading), false);
});
