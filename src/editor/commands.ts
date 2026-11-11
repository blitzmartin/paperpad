// Editing commands used by the actions (see actions.ts) and the keymap.
// Every command follows the ProseMirror signature: (state, dispatch?) => boolean.
// Calling it without dispatch only asks "can this run right now?".

import { lift, setBlockType } from "prosemirror-commands";
import type { Attrs, MarkType, Node as PMNode, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { type Command, type EditorState, TextSelection } from "prosemirror-state";
import { type Align, MAX_INDENT, schema } from "./schema.ts";

const { nodes: N } = schema;

const isList = (t: NodeType) => t === N.bullet_list || t === N.ordered_list;

/** Depth of the closest ancestor of the selection start whose type matches, or 0. */
function ancestorDepth(state: EditorState, match: (t: NodeType) => boolean): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (match($from.node(d).type)) return d;
  return 0;
}

// ---- character formatting -------------------------------------------------------

/** Sets (or with null, removes) a keyed mark such as font, size or color. */
export function setKeyedMark(type: MarkType, key: string | null): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr;
      const { empty, ranges } = state.selection;
      if (empty) {
        tr.removeStoredMark(type);
        if (key !== null) tr.addStoredMark(type.create({ key }));
      } else {
        for (const { $from, $to } of ranges) {
          tr.removeMark($from.pos, $to.pos, type);
          if (key !== null) tr.addMark($from.pos, $to.pos, type.create({ key }));
        }
      }
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Removes all character formatting from the selection. */
export const clearFormatting: Command = (state, dispatch) => {
  if (dispatch) {
    const tr = state.tr;
    if (state.selection.empty) tr.setStoredMarks([]);
    else for (const r of state.selection.ranges) tr.removeMark(r.$from.pos, r.$to.pos);
    dispatch(tr);
  }
  return true;
};

// ---- paragraph formatting -------------------------------------------------------

/** Applies a change to every paragraph and heading touched by the selection. */
function updateTextblocks(state: EditorState, change: (attrs: Attrs) => Attrs | null) {
  const tr = state.tr;
  const { from, to } = state.selection;
  let changed = false;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === N.paragraph || node.type === N.heading) {
      const next = change(node.attrs);
      if (next) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
        changed = true;
      }
      return false;
    }
    return true;
  });
  return changed ? tr : null;
}

export function setAlign(align: Align): Command {
  return (state, dispatch) => {
    const tr = updateTextblocks(state, (a) => (a.align === align ? null : { align }));
    if (tr) dispatch?.(tr);
    return true;
  };
}

/** Indent and outdent: nest or lift list items, otherwise shift paragraphs. */
const shiftIndent =
  (delta: 1 | -1, inList: Command): Command =>
  (state, dispatch) => {
    if (ancestorDepth(state, (t) => t === N.list_item)) return inList(state, dispatch);
    const tr = updateTextblocks(state, (a) => {
      const indent = (a.indent as number) + delta;
      return indent >= 0 && indent <= MAX_INDENT ? { indent } : null;
    });
    if (!tr) return false;
    dispatch?.(tr);
    return true;
  };

export const indent = shiftIndent(1, sinkListItem(N.list_item));
export const outdent = shiftIndent(-1, liftListItem(N.list_item));

export type BlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";

export function setBlockStyle(style: BlockStyle): Command {
  return (state, dispatch) => {
    const { align = "left", indent = 0 } = state.selection.$from.parent.attrs;
    switch (style) {
      case "paragraph":
        // Leave a quote first, so "Normal" really means a plain paragraph.
        if (ancestorDepth(state, (t) => t === N.blockquote)) return lift(state, dispatch);
        return setBlockType(N.paragraph, { align, indent })(state, dispatch);
      case "h1":
      case "h2":
      case "h3":
        return setBlockType(N.heading, { level: Number(style[1]), align, indent })(state, dispatch);
      case "code":
        return setBlockType(N.code_block)(state, dispatch);
      case "quote": {
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);
        if (!range) return false;
        dispatch?.(state.tr.wrap(range, [{ type: N.blockquote }]).scrollIntoView());
        return true;
      }
    }
  };
}

/** Turns the current paragraph into a code block, or back into a normal paragraph. */
export const toggleCodeBlock: Command = (state, dispatch) =>
  setBlockStyle(state.selection.$from.parent.type === N.code_block ? "paragraph" : "code")(state, dispatch);

/** Toggles a list: wraps, unwraps or converts between bullet and numbered. */
export function toggleList(listType: NodeType): Command {
  return (state, dispatch) => {
    const depth = ancestorDepth(state, isList);
    if (!depth) return wrapInList(listType)(state, dispatch);
    const { $from } = state.selection;
    if ($from.node(depth).type === listType) return liftListItem(N.list_item)(state, dispatch);
    dispatch?.(state.tr.setNodeMarkup($from.before(depth), listType));
    return true;
  };
}

// ---- insertions and movement ------------------------------------------------------

const insertNode =
  (node: PMNode): Command =>
  (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };

// The plugin in setup.ts adds a paragraph after a rule that ends the document.
export const insertRule = insertNode(N.horizontal_rule.create());
export const insertLineBreak = insertNode(N.hard_break.create());

/**
 * Backspace at the start of a paragraph that follows a rule deletes the rule.
 * The default would delete an empty paragraph and select the rule instead, and
 * when the rule ends the document the plugin in setup.ts puts the paragraph
 * straight back, so the rule could never be removed.
 */
export const deleteRuleBefore: Command = (state, dispatch) => {
  const { $cursor } = state.selection as TextSelection;
  if (!$cursor || $cursor.parentOffset > 0) return false;
  const start = $cursor.before();
  const rule = state.doc.resolve(start).nodeBefore;
  if (rule?.type !== N.horizontal_rule) return false;
  dispatch?.(state.tr.delete(start - rule.nodeSize, start).scrollIntoView());
  return true;
};

export const insertTab: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) return false;
  dispatch?.(state.tr.insertText("\t").scrollIntoView());
  return true;
};

/**
 * Arrow keys leave a code block, as in chat apps: Down on the last line moves
 * into the paragraph after it (adding one if needed), Up on the first line
 * moves into the paragraph before it. Otherwise the arrow moves within the code.
 */
export const exitCodeBlock =
  (dir: "up" | "down"): Command =>
  (state, dispatch) => {
    const { $head, empty } = state.selection;
    if (!empty || $head.parent.type !== N.code_block) return false;
    const code = $head.parent;
    const down = dir === "down";
    const rest = down ? code.textBetween($head.parentOffset, code.content.size) : code.textBetween(0, $head.parentOffset);
    if (rest.includes("\n")) return false;
    if (dispatch) {
      // Reuse the paragraph next to the block, or add one.
      const edge = down ? $head.after() : $head.before();
      const neighbor = down ? state.doc.nodeAt(edge) : state.doc.resolve(edge).nodeBefore;
      const tr = neighbor?.isTextblock ? state.tr : state.tr.insert(edge, N.paragraph.create());
      // Down: start of the next paragraph. Up: end of the previous one.
      const target = down ? edge + 1 : tr.mapping.map(edge) - 1;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, target)).scrollIntoView());
    }
    return true;
  };

// ---- document settings ----------------------------------------------------------

/** Shows or hides the page number that print and export add to each page. */
export const togglePageNumbers: Command = (state, dispatch) => {
  dispatch?.(state.tr.setDocAttribute("pageNumbers", !state.doc.attrs.pageNumbers));
  return true;
};

export const pageNumbersOn = (state: EditorState): boolean => !!state.doc.attrs.pageNumbers;

// ---- queries for the toolbar's pressed and selected states -------------------

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function markKey(state: EditorState, type: MarkType): string | null {
  const { $from, empty } = state.selection;
  const marks = empty ? state.storedMarks || $from.marks() : $from.marksAcross(state.selection.$to) ?? $from.marks();
  const m = type.isInSet(marks);
  return m ? String(m.attrs.key) : null;
}

export function currentBlockStyle(state: EditorState): BlockStyle {
  const parent = state.selection.$from.parent;
  if (parent.type === N.heading) return `h${parent.attrs.level}` as BlockStyle;
  if (parent.type === N.code_block) return "code";
  return ancestorDepth(state, (t) => t === N.blockquote) ? "quote" : "paragraph";
}

export function currentAlign(state: EditorState): Align {
  return (state.selection.$from.parent.attrs.align as Align) ?? "left";
}

/** The type of the closest list around the selection, or null. */
export function currentList(state: EditorState): NodeType | null {
  const depth = ancestorDepth(state, isList);
  return depth ? state.selection.$from.node(depth).type : null;
}

// ---- statistics for the status bar ------------------------------------------

export interface DocStats {
  words: number;
  /** Words in the selection, or null when nothing is selected. */
  selectedWords: number | null;
  chars: number;
  paragraph: number;
  column: number;
}

const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

// Documents are immutable, so whole-document counts are computed once per version.
const docCounts = new WeakMap<PMNode, { words: number; chars: number }>();

function counts(doc: PMNode) {
  let c = docCounts.get(doc);
  if (!c) {
    const text = doc.textBetween(0, doc.content.size, " ", " ");
    c = { words: countWords(text), chars: [...doc.textContent].length };
    docCounts.set(doc, c);
  }
  return c;
}

export function stats(state: EditorState): DocStats {
  const { from, to, empty, $head } = state.selection;
  let paragraph = 0;
  state.doc.nodesBetween(0, $head.pos, (node) => {
    if (!node.isTextblock) return true;
    paragraph++;
    return false;
  });
  return {
    ...counts(state.doc),
    selectedWords: empty ? null : countWords(state.doc.textBetween(from, to, " ", " ")),
    paragraph: Math.max(1, paragraph),
    column: $head.parentOffset + 1,
  };
}
