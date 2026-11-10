// Editing commands used by the toolbar, the menus and the keymap.
// Every command follows the ProseMirror signature: (state, dispatch?) => boolean.
// Calling it without dispatch only asks "can this run right now?".

import { lift, setBlockType, toggleMark } from "prosemirror-commands";
import type { Attrs, MarkType, Node as PMNode, NodeType } from "prosemirror-model";
import { liftListItem, sinkListItem, wrapInList } from "prosemirror-schema-list";
import { type Command, type EditorState, TextSelection } from "prosemirror-state";
import { type Align, MAX_INDENT, schema } from "./schema.ts";

const { marks: M, nodes: N } = schema;

export const toggleBold = toggleMark(M.strong);
export const toggleItalic = toggleMark(M.em);
export const toggleUnderline = toggleMark(M.underline);
export const toggleStrike = toggleMark(M.strike);

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
    if (tr && dispatch) dispatch(tr);
    return true;
  };
}

function inList(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.list_item) return true;
  return false;
}

/** Indent: nests list items, otherwise shifts paragraphs right. */
export const indent: Command = (state, dispatch) => {
  if (inList(state)) return sinkListItem(N.list_item)(state, dispatch);
  const tr = updateTextblocks(state, (a) => (a.indent < MAX_INDENT ? { indent: a.indent + 1 } : null));
  if (!tr) return false;
  if (dispatch) dispatch(tr);
  return true;
};

export const outdent: Command = (state, dispatch) => {
  if (inList(state)) return liftListItem(N.list_item)(state, dispatch);
  const tr = updateTextblocks(state, (a) => (a.indent > 0 ? { indent: a.indent - 1 } : null));
  if (!tr) return false;
  if (dispatch) dispatch(tr);
  return true;
};

export type BlockStyle = "paragraph" | "h1" | "h2" | "h3" | "quote" | "code";

export function setBlockStyle(style: BlockStyle): Command {
  return (state, dispatch) => {
    const { align = "left", indent = 0 } = state.selection.$from.parent.attrs;
    // Leave a quote first, so "Normal" really means a plain paragraph.
    const unquote: Command = (s, d) => {
      const { $from } = s.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        if ($from.node(depth).type === N.blockquote) return lift(s, d);
      }
      return false;
    };
    switch (style) {
      case "paragraph":
        if (unquote(state, dispatch)) return true;
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
        if (dispatch) {
          const tr = state.tr.wrap(range, [{ type: N.blockquote }]);
          dispatch(tr.scrollIntoView());
        }
        return true;
      }
    }
  };
}

/** Toggles a list: wraps, unwraps or converts between bullet and numbered. */
export function toggleList(listType: NodeType): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type === N.bullet_list || node.type === N.ordered_list) {
        if (node.type === listType) return liftListItem(N.list_item)(state, dispatch);
        if (dispatch) dispatch(state.tr.setNodeMarkup($from.before(d), listType));
        return true;
      }
    }
    return wrapInList(listType)(state, dispatch);
  };
}

export const toggleBullets = toggleList(N.bullet_list);
export const toggleNumbers = toggleList(N.ordered_list);

export const insertRule: Command = (state, dispatch) => {
  // The plugin in setup.ts adds a paragraph after a rule that ends the document.
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.horizontal_rule.create()).scrollIntoView());
  return true;
};

/**
 * Arrow keys leave a code block, as in chat apps: Down on the last line moves
 * into the paragraph after it (adding one if needed), Up on the first line
 * moves into the paragraph before it. Otherwise the arrow moves within the code.
 */
export const exitCodeBlock = (dir: "up" | "down"): Command => (state, dispatch) => {
  const { $head, empty } = state.selection;
  if (!empty || $head.parent.type !== N.code_block) return false;
  const code = $head.parent;
  if (dir === "down") {
    if (code.textBetween($head.parentOffset, code.content.size).includes("\n")) return false;
    const after = $head.after();
    if (dispatch) {
      const next = state.doc.nodeAt(after);
      let tr = state.tr;
      let target = after + 1;
      if (next && next.isTextblock) {
        // Caret goes to the start of the following paragraph.
      } else {
        tr = tr.insert(after, N.paragraph.create());
      }
      dispatch(tr.setSelection(TextSelection.create(tr.doc, target)).scrollIntoView());
    }
    return true;
  }
  if (code.textBetween(0, $head.parentOffset).includes("\n")) return false;
  const before = $head.before();
  if (dispatch) {
    const prev = state.doc.resolve(before).nodeBefore;
    let tr = state.tr;
    if (!(prev && prev.isTextblock)) tr = tr.insert(before, N.paragraph.create());
    // The new paragraph (or the existing one before) ends right at `before`.
    const endOfPrev = tr.mapping.map(before) - 1;
    dispatch(tr.setSelection(TextSelection.create(tr.doc, endOfPrev)).scrollIntoView());
  }
  return true;
};

/** Turns the current paragraph into a code block, or back into a normal paragraph. */
export const toggleCodeBlock: Command = (state, dispatch) =>
  setBlockStyle(state.selection.$from.parent.type === N.code_block ? "paragraph" : "code")(state, dispatch);

/** Shows or hides the page number that print and export add to each page. */
export const togglePageNumbers: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setDocAttribute("pageNumbers", !state.doc.attrs.pageNumbers));
  return true;
};

export const pageNumbersOn = (state: EditorState): boolean => !!state.doc.attrs.pageNumbers;

export const insertLineBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView());
  return true;
};

export const insertTab: Command = (state, dispatch) => {
  if (state.selection.$from.parent.type.spec.code) return false;
  if (dispatch) dispatch(state.tr.insertText("\t").scrollIntoView());
  return true;
};

export const selectAllText: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, 0, state.doc.content.size)));
  return true;
};

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
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type === N.heading) return `h${parent.attrs.level}` as BlockStyle;
  if (parent.type === N.code_block) return "code";
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.blockquote) return "quote";
  return "paragraph";
}

export function currentAlign(state: EditorState): Align {
  return (state.selection.$from.parent.attrs.align as Align) ?? "left";
}

export function currentList(state: EditorState): "bullet" | "ordered" | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === N.bullet_list) return "bullet";
    if (t === N.ordered_list) return "ordered";
  }
  return null;
}

// ---- statistics for the status bar ------------------------------------------

export interface DocStats {
  words: number;
  chars: number;
  paragraph: number;
  column: number;
}

export function stats(state: EditorState): DocStats {
  const text = state.doc.textBetween(0, state.doc.content.size, " ", " ");
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const { $head } = state.selection;
  let paragraph = 0;
  state.doc.descendants((node: PMNode, pos: number) => {
    if (pos > $head.pos) return false;
    if (node.isTextblock) {
      paragraph++;
      return false;
    }
    return true;
  });
  return { words, chars: [...state.doc.textContent].length, paragraph: Math.max(1, paragraph), column: $head.parentOffset + 1 };
}
