// Creates the ProseMirror state and view with PaperPad's plugins and keymap.

import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState, type Plugin, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as cmd from "./commands.ts";
import { schema } from "./schema.ts";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = isMac ? "Cmd" : "Ctrl";

function plugins(): Plugin[] {
  return [
    history({ depth: 500 }),
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
    }),
    keymap(baseKeymap),
  ];
}

export function newState(doc?: PMNode): EditorState {
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
