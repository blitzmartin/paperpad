// The two icon toolbars: the standard bar (files, clipboard, history) and
// the format bar (styles, fonts, character and paragraph formatting).
// Buttons are built from the shared actions, so labels, shortcuts and
// pressed states match the menus.

import type { MarkType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import type { AppActions } from "../app.ts";
import { BLOCK_STYLES } from "../editor/actions.ts";
import * as cmd from "../editor/commands.ts";
import { COLORS, type ColorDef, DEFAULT_SIZE, docFont, FONTS, HIGHLIGHTS, SIZES } from "../editor/palette.ts";
import { schema } from "../editor/schema.ts";
import { type Action, shortcutText } from "./action.ts";
import { dismissable, h, placeBelow } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { type MenuEntry, openMenu } from "./menu.ts";

export interface ToolbarDeps {
  actions: AppActions;
  run(command: Command): void;
  focus(): void;
  exportItems(): MenuEntry[];
  onThemeChange(fn: () => void): void;
}

export function buildToolbar(root: HTMLElement, deps: ToolbarDeps): (state: EditorState) => void {
  const updaters: ((state: EditorState) => void)[] = [];
  const { actions: A, run } = deps;
  const M = schema.marks;

  const button = (name: IconName, label: string, shortcut: string, onClick: (btn: HTMLButtonElement) => void) => {
    const btn = h("button", { class: "tb", type: "button", title: shortcut ? `${label} (${shortcut})` : label, "aria-label": label }, icon(name));
    // Keep the caret in the document when clicking a tool.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => onClick(btn));
    return btn;
  };

  /** A button for an action. Menu labels drop their "..." in tooltips. */
  const tool = (a: Action, name: IconName) => {
    const btn = button(name, a.label.replace(/\.\.\.$/, ""), shortcutText(a), () => a.run());
    const { checked, enabled, visible } = a;
    if (checked) {
      btn.setAttribute("aria-pressed", "false");
      updaters.push(() => btn.setAttribute("aria-pressed", String(checked())));
    }
    if (enabled) updaters.push(() => (btn.disabled = !enabled()));
    if (visible) updaters.push(() => (btn.hidden = !visible()));
    return btn;
  };

  const sep = () => h("span", { class: "tb-sep", role: "separator" });
  const group = (...children: HTMLElement[]) => h("div", { class: "tb-group" }, ...children);

  // ---- standard bar -----------------------------------------------------------

  const exportBtn = button("export", "Export", "", (btn) => void openMenu(btn, deps.exportItems()));
  exportBtn.append(icon("caret"));
  exportBtn.classList.add("has-caret");

  // The theme button shows what a click switches to.
  const themeBtn = button("moon", "", "", () => A.darkMode.run());
  const syncTheme = () => {
    const dark = A.darkMode.checked!();
    const label = dark ? "Light mode" : "Dark mode";
    themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
    themeBtn.title = `${label} (${shortcutText(A.darkMode)})`;
    themeBtn.setAttribute("aria-label", label);
  };
  syncTheme();
  deps.onThemeChange(syncTheme);

  const standard = h(
    "div",
    { class: "tb-row" },
    group(tool(A.newDocument, "new"), tool(A.open, "open"), tool(A.save, "save")),
    sep(),
    group(tool(A.print, "print"), exportBtn),
    sep(),
    group(tool(A.cut, "cut"), tool(A.copy, "copy"), tool(A.paste, "paste")),
    sep(),
    group(tool(A.undo, "undo"), tool(A.redo, "redo")),
    sep(),
    group(tool(A.find, "find"), tool(A.pageNumbers, "pageNumbers")),
    h("span", { class: "tb-spacer" }),
    group(themeBtn),
  );

  // ---- format bar ---------------------------------------------------------------

  const select = (label: string, cls: string, options: [string, string][], onChange: (v: string) => void, read: (s: EditorState) => string) => {
    const el = h("select", { class: `tb-select ${cls}`, title: label, "aria-label": label });
    for (const [value, text] of options) el.append(h("option", { value, text }));
    el.addEventListener("change", () => {
      onChange(el.value);
      deps.focus();
    });
    updaters.push((s) => {
      const v = read(s);
      if (el.value !== v) el.value = v;
    });
    return el;
  };

  const styleSelect = select(
    "Paragraph style",
    "w-style",
    BLOCK_STYLES.map((b): [string, string] => [b.style, b.label]),
    (v) => run(cmd.setBlockStyle(v as cmd.BlockStyle)),
    cmd.currentBlockStyle,
  );

  const fontSelect = select(
    "Font",
    "w-font",
    [["", "Default"], ...FONTS.map((f): [string, string] => [f.key, f.label])],
    (v) => run(cmd.setKeyedMark(M.font, v || null)),
    (s) => cmd.markKey(s, M.font) ?? "",
  );
  for (const opt of Array.from(fontSelect.options)) if (opt.value) opt.classList.add(`ff-${opt.value}`);
  // "Default" is the document's own font, chosen in View, Options.
  const defaultOption = fontSelect.options[0]!;
  updaters.push((s) => {
    const f = docFont(s.doc.attrs.font);
    defaultOption.text = `Default (${f.label})`;
    defaultOption.className = `ff-${f.key}`;
  });

  const sizeSelect = select(
    "Font size",
    "w-size",
    SIZES.map((n): [string, string] => [String(n), String(n)]),
    (v) => run(cmd.setKeyedMark(M.size, Number(v) === DEFAULT_SIZE ? null : v)),
    (s) => cmd.markKey(s, M.size) ?? String(DEFAULT_SIZE),
  );

  const colorPicker = (name: IconName, title: string, type: MarkType, list: readonly ColorDef[], noneLabel: string, prefix: string) => {
    const bar = h("span", { class: "color-bar" });
    const btn = button(name, title, "", () => {
      const popup = h("div", { class: "window swatches", role: "dialog", "aria-label": title });
      let undismiss = () => {};
      const close = () => {
        undismiss();
        popup.remove();
      };
      const pick = (key: string | null) => {
        close();
        run(cmd.setKeyedMark(type, key));
      };
      const none = h("button", { class: "btn swatch-none", type: "button", text: noneLabel, on: { click: () => pick(null) } });
      const grid = h("div", { class: "swatch-grid" });
      for (const c of list) {
        const s = h("button", { class: `swatch sw-${prefix}${c.key}`, type: "button", title: c.label, "aria-label": c.label, on: { click: () => pick(c.key) } });
        s.addEventListener("mousedown", (e) => e.preventDefault());
        grid.append(s);
      }
      popup.append(none, grid);
      placeBelow(popup, btn);
      undismiss = dismissable(popup, close, [btn]);
      (grid.firstElementChild as HTMLElement | null)?.focus();
    });
    btn.classList.add("has-bar");
    btn.append(bar);
    updaters.push((s) => {
      const key = cmd.markKey(s, type);
      bar.className = `color-bar${key ? ` sw-${prefix}${key}` : ""}`;
    });
    return btn;
  };

  const format = h(
    "div",
    { class: "tb-row" },
    group(styleSelect, fontSelect, sizeSelect),
    sep(),
    group(tool(A.bold, "bold"), tool(A.italic, "italic"), tool(A.underline, "underline"), tool(A.strike, "strike")),
    sep(),
    group(
      colorPicker("color", "Text color", M.color, COLORS, "Automatic", "c-"),
      colorPicker("highlight", "Highlight", M.highlight, HIGHLIGHTS, "No highlight", "hl-"),
    ),
    sep(),
    group(tool(A.alignLeft, "alignLeft"), tool(A.alignCenter, "alignCenter"), tool(A.alignRight, "alignRight"), tool(A.alignJustify, "alignJustify")),
    sep(),
    group(tool(A.bullets, "bullets"), tool(A.numbers, "numbers"), tool(A.outdent, "outdent"), tool(A.indent, "indent")),
    sep(),
    group(tool(A.rule, "rule"), tool(A.codeBlock, "code"), tool(A.clearFormatting, "clear")),
  );

  root.append(standard, format);
  return (state) => {
    for (const u of updaters) u(state);
  };
}
