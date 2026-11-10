// Creates the ProseMirror state and view with PaperPad's plugins and keymap.

import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState, Plugin, type Transaction, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as cmd from "./commands.ts";
import { schema } from "./schema.ts";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = isMac ? "Cmd" : "Ctrl";

/**
 * A horizontal rule is a leaf node. If it is the last thing in the document,
 * there is no text position after it, so the caret cannot get past it and
 * the rule is hard to reach. Add a paragraph after it. Lists and quotes
 * contain text, so they need nothing.
 */
function trailingBlock(doc: PMNode): PMNode | null {
  return doc.lastChild?.isLeaf ? schema.nodes.paragraph.create() : null;
}

const keepTrailingParagraph = new Plugin({
  appendTransaction(trs, _oldState, state) {
    if (!trs.some((tr) => tr.docChanged)) return null;
    const para = trailingBlock(state.doc);
    if (!para) return null;
    const tr = state.tr.insert(state.doc.content.size, para);
    // Put the caret in the new paragraph if it was left on the rule.
    if (!state.selection.$from.parent.isTextblock) {
      tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
    }
    return tr;
  },
});

function plugins(): Plugin[] {
  return [
    history({ depth: 500 }),
    keepTrailingParagraph,
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-b": cmd.toggleBold,
      "Mod-i": cmd.toggleItalic,
      "Mod-u": cmd.toggleUnderline,
      "Shift-Mod-x": cmd.toggleStrike,
      "Mod-l": cmd.setAlign("left"),
      "Mod-e": cmd.setAlign("center"),
      "Mod-r": cmd.setAlign("right"),
      "Mod-j": cmd.setAlign("justify"),
      "Shift-Mod-8": cmd.toggleBullets,
      "Shift-Mod-7": cmd.toggleNumbers,
      "Mod-]": cmd.indent,
      "Mod-[": cmd.outdent,
      "Mod-Alt-0": cmd.setBlockStyle("paragraph"),
      "Mod-Alt-1": cmd.setBlockStyle("h1"),
      "Mod-Alt-2": cmd.setBlockStyle("h2"),
      "Mod-Alt-3": cmd.setBlockStyle("h3"),
      "Mod-\\": cmd.clearFormatting,
      "Shift-Enter": chainCommands(exitCode, cmd.insertLineBreak),
      Enter: splitListItem(schema.nodes.list_item),
      // Like a classic word processor: Tab nests list items, otherwise types a tab.
      Tab: chainCommands(sinkListItem(schema.nodes.list_item), cmd.insertTab),
      "Shift-Tab": liftListItem(schema.nodes.list_item),
      ArrowDown: cmd.exitCodeBlock("down"),
      ArrowUp: cmd.exitCodeBlock("up"),
    }),
    keymap(baseKeymap),
  ];
}

export function newState(doc?: PMNode): EditorState {
  // Documents opened from file may end with a rule, so add the paragraph here too.
  const para = doc && trailingBlock(doc);
  if (doc && para) doc = doc.copy(doc.content.append(Fragment.from(para)));
  return EditorState.create({ schema, doc, plugins: plugins() });
}

export function createView(mount: HTMLElement, onTransaction: (tr: Transaction, view: EditorView) => void): EditorView {
  const view: EditorView = new EditorView(mount, {
    state: newState(),
    attributes: {
      class: "doc",
      spellcheck: "true",
      "aria-label": "Document",
      role: "textbox",
      "aria-multiline": "true",
    },
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr));
      onTransaction(tr, view);
    },
  });
  return view;
}
