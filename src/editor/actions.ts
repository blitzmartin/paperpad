// Editing actions, each defined once: its label, its key bindings and the
// command it runs. The keymap, the menus and the toolbar all read this table.

import { selectAll, toggleMark } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { MarkType, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import * as cmd from "./commands.ts";
import { type Align, schema } from "./schema.ts";

export interface EditorAction {
  label: string;
  /** ProseMirror key names. The first one is shown in menus and tooltips. */
  keys?: readonly string[];
  command: Command;
  /** Pressed in the toolbar, checked in menus. */
  active?: (state: EditorState) => boolean;
  /** Greyed out unless this returns true. */
  enabled?: (state: EditorState) => boolean;
}

const { marks: M, nodes: N } = schema;

const mark = (label: string, key: string, type: MarkType): EditorAction => ({
  label,
  keys: [key],
  command: toggleMark(type),
  active: (s) => cmd.markActive(s, type),
});

const align = (label: string, key: string, value: Align): EditorAction => ({
  label,
  keys: [key],
  command: cmd.setAlign(value),
  active: (s) => cmd.currentAlign(s) === value,
});

const list = (label: string, key: string, type: NodeType): EditorAction => ({
  label,
  keys: [key],
  command: cmd.toggleList(type),
  active: (s) => cmd.currentList(s) === type,
});

export const EDITOR_ACTIONS = {
  undo: { label: "Undo", keys: ["Mod-z"], command: undo, enabled: undo },
  redo: { label: "Redo", keys: ["Mod-y", "Shift-Mod-z"], command: redo, enabled: redo },
  selectAll: { label: "Select all", keys: ["Mod-a"], command: selectAll },
  bold: mark("Bold", "Mod-b", M.strong),
  italic: mark("Italic", "Mod-i", M.em),
  underline: mark("Underline", "Mod-u", M.underline),
  strike: mark("Strikethrough", "Shift-Mod-x", M.strike),
  alignLeft: align("Align left", "Mod-l", "left"),
  alignCenter: align("Center", "Mod-e", "center"),
  alignRight: align("Align right", "Mod-r", "right"),
  alignJustify: align("Justify", "Mod-j", "justify"),
  bullets: list("Bulleted list", "Shift-Mod-8", N.bullet_list),
  numbers: list("Numbered list", "Shift-Mod-7", N.ordered_list),
  indent: { label: "Increase indent", keys: ["Mod-]"], command: cmd.indent },
  outdent: { label: "Decrease indent", keys: ["Mod-["], command: cmd.outdent },
  rule: { label: "Horizontal rule", command: cmd.insertRule },
  codeBlock: { label: "Code block", command: cmd.toggleCodeBlock, active: (s) => cmd.currentBlockStyle(s) === "code" },
  clearFormatting: { label: "Clear formatting", keys: ["Mod-\\"], command: cmd.clearFormatting },
  updateNormal: { label: "Update Normal to match", command: cmd.updateNormalToMatch, enabled: cmd.updateNormalToMatch },
  pageNumbers: { label: "Page numbers", command: cmd.togglePageNumbers, active: cmd.pageNumbersOn },
} satisfies Record<string, EditorAction>;

export type EditorActionId = keyof typeof EDITOR_ACTIONS;

export const BLOCK_STYLES: readonly { style: cmd.BlockStyle; label: string; key?: string }[] = [
  { style: "paragraph", label: "Normal", key: "Mod-Alt-0" },
  { style: "h1", label: "Heading 1", key: "Mod-Alt-1" },
  { style: "h2", label: "Heading 2", key: "Mod-Alt-2" },
  { style: "h3", label: "Heading 3", key: "Mod-Alt-3" },
  { style: "quote", label: "Quote" },
  { style: "code", label: "Code" },
];

/** The key bindings of every action and paragraph style, for the editor keymap. */
export function actionKeymap(): Record<string, Command> {
  const map: Record<string, Command> = {};
  for (const a of Object.values(EDITOR_ACTIONS) as EditorAction[]) for (const k of a.keys ?? []) map[k] = a.command;
  for (const b of BLOCK_STYLES) if (b.key) map[b.key] = cmd.setBlockStyle(b.style);
  return map;
}
