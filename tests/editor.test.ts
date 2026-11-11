import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TextSelection } from "prosemirror-state";
import { BLOCK_STYLES, EDITOR_ACTIONS, type EditorAction } from "../src/editor/actions.ts";
import { deleteRuleBefore, exitCodeBlock, pageNumbersOn, stats, togglePageNumbers } from "../src/editor/commands.ts";
import { keyLabel, MOD_LABEL } from "../src/ui/keys.ts";
import { parsePrefs, PRESETS, type PresetId, presetOf } from "../src/ui/writing-feel.ts";
import { schema } from "../src/editor/schema.ts";
import { newState } from "../src/editor/setup.ts";
import { toDocxParts } from "../src/export/docx.ts";
import { toRtf } from "../src/export/rtf.ts";

const N = schema.nodes;
const p = (text: string) => N.paragraph.create(null, text ? schema.text(text) : undefined);
const types = (state: { doc: { forEach(f: (n: { type: { name: string } }) => void): void } }) => {
  const out: string[] = [];
  state.doc.forEach((n) => out.push(n.type.name));
  return out;
};

test("a horizontal line at the end of a document gets a paragraph after it", () => {
  const state = newState(N.doc.create(null, [p("a"), N.horizontal_rule.create()]));
  assert.deepEqual(types(state), ["paragraph", "horizontal_rule", "paragraph"]);
});

test("the paragraph is also added when a rule becomes the last node", () => {
  let state = newState(N.doc.create(null, [p("a"), p("b")]));
  const from = state.doc.child(0).nodeSize;
  state = state.apply(state.tr.replaceWith(from, state.doc.content.size, N.horizontal_rule.create()));
  assert.deepEqual(types(state), ["paragraph", "horizontal_rule", "paragraph"]);
});

test("documents ending in a list or quote are left alone", () => {
  const list = N.bullet_list.create(null, [N.list_item.create(null, p("x"))]);
  assert.deepEqual(types(newState(N.doc.create(null, [p("a"), list]))), ["paragraph", "bullet_list"]);
  const quote = N.blockquote.create(null, p("q"));
  assert.deepEqual(types(newState(N.doc.create(null, [p("a"), quote]))), ["paragraph", "blockquote"]);
});

test("backspace after a horizontal line at the end of the document removes it", () => {
  let state = newState(N.doc.create(null, [p("a"), N.horizontal_rule.create()]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  assert.ok(deleteRuleBefore(state, (tr) => (state = state.apply(tr))));
  assert.deepEqual(types(state), ["paragraph", "paragraph"]);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});

test("backspace removes a horizontal line before a paragraph with text and keeps the text", () => {
  let state = newState(N.doc.create(null, [p("a"), N.horizontal_rule.create(), p("b")]));
  const start = state.doc.content.size - 2; // start of "b"
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
  assert.ok(deleteRuleBefore(state, (tr) => (state = state.apply(tr))));
  assert.deepEqual(types(state), ["paragraph", "paragraph"]);
  assert.equal(state.doc.textContent, "ab");
});

test("backspace is left to the default when no horizontal line comes before", () => {
  let state = newState(N.doc.create(null, [p("a"), p("b")]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 2)));
  assert.equal(deleteRuleBefore(state), false);
});

test("arrow down leaves a code block and adds a paragraph when none follows", () => {
  let state = newState(N.doc.create(null, [N.code_block.create(null, schema.text("a\nb"))]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  assert.ok(exitCodeBlock("down")(state, (tr) => (state = state.apply(tr))));
  assert.deepEqual(types(state), ["code_block", "paragraph"]);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});

test("arrow keys stay inside the code block on other lines", () => {
  let state = newState(N.doc.create(null, [N.code_block.create(null, schema.text("a\nb"))]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2))); // after "a"
  assert.equal(exitCodeBlock("down")(state), false, "a line follows");
  assert.equal(exitCodeBlock("up")(state), true, "first line");
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
  assert.equal(exitCodeBlock("up")(state), false, "last line is not the first");
});

test("arrow up leaves a code block at the start of the document", () => {
  let state = newState(N.doc.create(null, [N.code_block.create(null, schema.text("a"))]));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  assert.ok(exitCodeBlock("up")(state, (tr) => (state = state.apply(tr))));
  assert.deepEqual(types(state), ["paragraph", "code_block"]);
  assert.equal(state.selection.$from.parent.type.name, "paragraph");
});

test("the word count includes the selection only when there is one", () => {
  let state = newState(N.doc.create(null, [p("one two three")]));
  assert.equal(stats(state).selectedWords, null);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 8))); // "one two"
  assert.deepEqual([stats(state).words, stats(state).selectedWords], [3, 2]);
});

test("page numbers toggle on the document and reach RTF and DOCX", () => {
  let state = newState(N.doc.create(null, [p("hi")]));
  assert.equal(pageNumbersOn(state), false);
  assert.ok(!toRtf(state.doc).includes("\\chpgn"));
  assert.equal(toDocxParts(state.doc, "t").length, 8);

  togglePageNumbers(state, (tr) => (state = state.apply(tr)));
  assert.equal(pageNumbersOn(state), true);
  assert.ok(toRtf(state.doc).includes("{\\footer"));
  const parts = toDocxParts(state.doc, "t");
  const part = (name: string) => parts.find((x) => x.name === name)!.content;
  assert.match(part("word/document.xml"), /<w:footerReference [^>]*r:id="rId3"/);
  assert.match(part("word/footer1.xml"), / PAGE /);
  assert.match(part("[Content_Types].xml"), /\/word\/footer1\.xml/);
  assert.match(part("word/_rels/document.xml.rels"), /Id="rId3"[^>]*footer1\.xml/);

  togglePageNumbers(state, (tr) => (state = state.apply(tr)));
  assert.equal(pageNumbersOn(state), false);
});

test("every key is bound to one action at most", () => {
  const keys = [...(Object.values(EDITOR_ACTIONS) as EditorAction[]).flatMap((a) => a.keys ?? []), ...BLOCK_STYLES.flatMap((b) => (b.key ? [b.key] : []))];
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});

test("shortcut labels read like menu shortcuts", () => {
  assert.equal(keyLabel("Shift-Mod-x"), `${MOD_LABEL}+Shift+X`);
  assert.equal(keyLabel("Mod-Alt-1"), `${MOD_LABEL}+Alt+1`);
  assert.equal(keyLabel("Mod--"), `${MOD_LABEL}+-`);
  assert.equal(keyLabel("Mod-+"), `${MOD_LABEL}++`);
  assert.equal(keyLabel("F1"), "F1");
});

test("writing feel presets are told apart and stored settings are checked", () => {
  for (const id of Object.keys(PRESETS) as PresetId[]) assert.equal(presetOf(PRESETS[id].prefs), id);
  assert.equal(presetOf({ ...PRESETS.smooth.prefs, shape: "underscore" }), null, "custom");
  assert.deepEqual(parsePrefs(null, false), PRESETS.smooth.prefs);
  assert.deepEqual(parsePrefs("not json", true), PRESETS.classic.prefs, "reduced motion");
  const stored = parsePrefs(JSON.stringify({ movement: "smoother", blink: "nope", shape: "underscore", smoothScroll: "yes" }), false);
  assert.deepEqual(stored, { ...PRESETS.smooth.prefs, movement: "smoother", shape: "underscore" });
});

test("every DOCX part is allowed by the Rust export command", () => {
  const rust = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
  // The list ends at the "];" line (part names such as "[Content_Types].xml" contain brackets).
  const allowed = /const DOCX_PARTS[^=]*=\s*&\[([\s\S]*?)\n\];/.exec(rust)![1]!.match(/"[^"]+"/g)!.map((s) => s.slice(1, -1));
  const doc = N.doc.create({ pageNumbers: true }, [p("hi")]);
  assert.deepEqual(toDocxParts(doc, "t").map((x) => x.name).filter((n) => !allowed.includes(n)), []);
});
