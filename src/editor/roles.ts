// Paragraph roles and the style lock.
//
// Every text block has a role: Normal, a heading, Quote (text inside a
// quote) or Code. In every role but Normal, the font, size and color come
// from the role's style only (see styles.ts), so changing a style always
// reaches every paragraph with that role. The guard plugin below removes
// font, size and color marks from those blocks, whatever put them there:
// pasting, typing with stored marks or turning formatted text into a heading.
// Emphasis (bold, italic, underline, strikethrough, highlight) stays free.

import type { Node as PMNode } from "prosemirror-model";
import { type EditorState, Plugin, type Transaction } from "prosemirror-state";
import { schema } from "./schema.ts";
import type { StyleId } from "./styles.ts";

const N = schema.nodes;
const M = schema.marks;

/** The marks a paragraph style decides in every role but Normal. */
export const STYLE_MARKS = [M.font, M.size, M.color];

/** The role of a text block, given whether it sits inside a quote. Headings keep theirs in quotes. */
export function roleOf(node: PMNode, inQuote: boolean): StyleId {
  if (node.type === N.heading) return `h${node.attrs.level}` as StyleId;
  if (node.type === N.code_block) return "code";
  return inQuote ? "quote" : "normal";
}

function inQuoteAt(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type === N.blockquote) return true;
  return false;
}

/** The roles of the text blocks the selection touches. */
export function selectionRoles(state: EditorState): Set<StyleId> {
  const roles = new Set<StyleId>();
  const { from, to, $from } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    roles.add(roleOf(node, inQuoteAt(state.doc, pos)));
    return false;
  });
  if (!roles.size) roles.add(roleOf($from.parent, inQuoteAt(state.doc, $from.pos)));
  return roles;
}

/**
 * The role whose style decides font, size and color for the selection, or
 * null when the selection touches Normal text (then those tools change the
 * Normal parts only).
 */
export function lockedRole(state: EditorState): StyleId | null {
  const roles = selectionRoles(state);
  return roles.has("normal") ? null : roles.values().next().value!;
}

/** Content ranges of locked blocks that carry font, size or color marks. */
function lockedMarkRanges(doc: PMNode): [number, number][] {
  const ranges: [number, number][] = [];
  const walk = (node: PMNode, pos: number, quote: boolean) => {
    node.forEach((child, offset) => {
      const at = pos + offset;
      if (child.isTextblock) {
        if (roleOf(child, quote) === "normal") return;
        let marked = false;
        child.forEach((c) => (marked ||= c.marks.some((m) => STYLE_MARKS.includes(m.type))));
        if (marked) ranges.push([at + 1, at + 1 + child.content.size]);
      } else if (!child.isLeaf) {
        walk(child, at + 1, quote || child.type === N.blockquote);
      }
    });
  };
  walk(doc, 0, false);
  return ranges;
}

/** A transaction that removes style marks from locked blocks, or null when there are none. */
export function lockTransaction(state: EditorState): Transaction | null {
  const ranges = lockedMarkRanges(state.doc);
  const stored = state.storedMarks?.filter((m) => !STYLE_MARKS.includes(m.type));
  const clearStored = stored && stored.length !== state.storedMarks!.length && lockedRole(state) !== null;
  if (!ranges.length && !clearStored) return null;
  const tr = state.tr;
  for (const [from, to] of ranges) for (const type of STYLE_MARKS) tr.removeMark(from, to, type);
  if (clearStored) tr.setStoredMarks(stored!);
  return tr;
}

/** Keeps the lock after every change. The removal joins the change in the undo history. */
export const styleLockPlugin = new Plugin({
  appendTransaction(trs, _old, state) {
    if (!trs.some((tr) => tr.docChanged || tr.storedMarksSet)) return null;
    return lockTransaction(state);
  },
});
