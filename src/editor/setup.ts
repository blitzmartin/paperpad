// Creates the ProseMirror state and view with PaperPad's plugins and keymap.

import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Fragment, type Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorState, Plugin, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { actionKeymap } from "./actions.ts";
import { caretPlugin } from "./caret.ts";
import * as cmd from "./commands.ts";
import { arrowOverBreak, pagesPlugin } from "./pages.ts";
import { docFont } from "./palette.ts";
import { schema } from "./schema.ts";

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

const listItem = schema.nodes.list_item;

function plugins(): Plugin[] {
  return [
    history({ depth: 500 }),
    keepTrailingParagraph,
    caretPlugin,
    pagesPlugin,
    keymap({
      ...actionKeymap(),
      "Shift-Enter": chainCommands(exitCode, cmd.insertLineBreak),
      Enter: splitListItem(listItem),
      // Like a classic word processor: Tab nests list items, otherwise types a tab.
      Tab: chainCommands(sinkListItem(listItem), cmd.insertTab),
      "Shift-Tab": liftListItem(listItem),
      ArrowDown: chainCommands(cmd.exitCodeBlock("down"), arrowOverBreak("down")),
      ArrowUp: chainCommands(cmd.exitCodeBlock("up"), arrowOverBreak("up")),
      Backspace: cmd.deleteRuleBefore,
    }),
    keymap(baseKeymap),
  ];
}

/** An empty document in the given default font. */
export const blankDoc = (font: string): PMNode => schema.nodes.doc.createAndFill({ font: docFont(font).key })!;

export function newState(doc?: PMNode): EditorState {
  // Documents opened from file may end with a rule, so add the paragraph here too.
  const para = doc && trailingBlock(doc);
  if (doc && para) doc = doc.copy(doc.content.append(Fragment.from(para)));
  return EditorState.create({ schema, doc, plugins: plugins() });
}

export function createView(mount: HTMLElement, onChange: (state: EditorState) => void): EditorView {
  const view: EditorView = new EditorView(mount, {
    state: newState(),
    // No spellcheck here: ProseMirror would reset it on every update.
    // View > Options sets it (see initSpelling in ui/options.ts).
    // The document's default font is a class, like any other font.
    attributes: (state) => ({
      class: `doc ff-${docFont(state.doc.attrs.font).key}`,
      "aria-label": "Document",
      role: "textbox",
      "aria-multiline": "true",
    }),
    dispatchTransaction(tr: Transaction) {
      view.updateState(view.state.apply(tr));
      onChange(view.state);
    },
  });
  return view;
}

/** A one paragraph editor for trying caret settings. Destroy it when done. */
export function createPreview(mount: HTMLElement, text: string): EditorView {
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text(text)));
  return new EditorView(mount, {
    state: EditorState.create({ doc, plugins: [caretPlugin, keymap(baseKeymap)] }),
    attributes: { class: "doc preview", spellcheck: "false", "aria-label": "Caret preview" },
  });
}
