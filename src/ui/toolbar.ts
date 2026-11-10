// The two icon toolbars: the standard bar (files, clipboard, history) and
// the format bar (styles, fonts, character and paragraph formatting).

import { redoDepth, undoDepth } from "prosemirror-history";
import type { MarkType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import * as cmd from "../editor/commands.ts";
import { COLORS, type ColorDef, DEFAULT_SIZE, FONTS, HIGHLIGHTS, SIZES } from "../editor/palette.ts";
import { schema } from "../editor/schema.ts";
import { MOD_LABEL } from "../editor/setup.ts";
import type { AppApi } from "../app.ts";
import { dismissable, h, placeBelow } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { openMenu } from "./menu.ts";

interface Updater {
  (state: EditorState): void;
}

export function buildToolbar(root: HTMLElement, app: AppApi): (state: EditorState) => void {
  const updaters: Updater[] = [];
  const M = schema.marks;
  const mod = (k: string) => `${MOD_LABEL}+${k}`;

  const button = (name: IconName, title: string, onClick: (btn: HTMLButtonElement) => void, opts: { shortcut?: string; label?: string } = {}) => {
    const tip = opts.shortcut ? `${title} (${opts.shortcut})` : title;
    const btn = h("button", { class: "tb", type: "button", title: tip, "aria-label": title }, icon(name));
    if (opts.label) btn.append(h("span", { class: "tb-label", text: opts.label }));
    // Keep the caret in the document when clicking a tool.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => onClick(btn));
    return btn;
  };

  const commandButton = (name: IconName, title: string, command: Command, shortcut?: string, isActive?: (s: EditorState) => boolean) => {
    const btn = button(name, title, () => app.run(command), { shortcut });
    if (isActive) {
      btn.setAttribute("aria-pressed", "false");
      updaters.push((s) => btn.setAttribute("aria-pressed", String(isActive(s))));
    }
    return btn;
  };

  const markButton = (name: IconName, title: string, type: MarkType, command: Command, shortcut: string) =>
    commandButton(name, title, command, shortcut, (s) => cmd.markActive(s, type));

  const sep = () => h("span", { class: "tb-sep", role: "separator" });
  const group = (...children: HTMLElement[]) => h("div", { class: "tb-group" }, ...children);

  // ---- standard bar -----------------------------------------------------------

  const undoBtn = button("undo", "Undo", () => app.undo(), { shortcut: mod("Z") });
  const redoBtn = button("redo", "Redo", () => app.redo(), { shortcut: mod("Y") });
  updaters.push((s) => {
    undoBtn.disabled = undoDepth(s) === 0;
    redoBtn.disabled = redoDepth(s) === 0;
  });

  const exportBtn = button(
    "export",
    "Export",
    (btn) =>
      void openMenu(btn, [
        { label: "PDF (print to PDF)...", run: () => app.exportAs("pdf") },
        { label: "Word document (.docx)...", run: () => app.exportAs("docx") },
        { label: "Rich Text (.rtf)...", run: () => app.exportAs("rtf") },
        { label: "Markdown (.md)...", run: () => app.exportAs("md") },
        { label: "Plain text (.txt)...", run: () => app.exportAs("txt") },
      ]),
  );
  exportBtn.append(icon("caret"));
  exportBtn.classList.add("has-caret");

  const themeBtn = button("moon", "Dark mode", () => app.toggleTheme(), { shortcut: mod("Shift+D") });
  const syncTheme = () => {
    const dark = app.theme() === "dark";
    themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
    const label = dark ? "Light mode" : "Dark mode";
    themeBtn.title = `${label} (${mod("Shift+D")})`;
    themeBtn.setAttribute("aria-label", label);
  };
  syncTheme();
  app.onThemeChange(syncTheme);

  const standard = h(
    "div",
    { class: "tb-row" },
    group(
      button("new", "New", () => app.newDocument(), { shortcut: mod("N") }),
      button("open", "Open", () => app.open(), { shortcut: mod("O") }),
      button("save", "Save", () => app.save(), { shortcut: mod("S") }),
    ),
    sep(),
    group(button("print", "Print", () => app.print(), { shortcut: mod("P") }), exportBtn),
    sep(),
    group(
      button("cut", "Cut", () => app.clipboard("cut"), { shortcut: mod("X") }),
      button("copy", "Copy", () => app.clipboard("copy"), { shortcut: mod("C") }),
      button("paste", "Paste", () => app.clipboard("paste"), { shortcut: mod("V") }),
    ),
    sep(),
    group(undoBtn, redoBtn),
    sep(),
    group(
      button("find", "Find and replace", () => app.find(), { shortcut: mod("F") }),
      commandButton("pages", "Page numbers", cmd.togglePageNumbers, undefined, cmd.pageNumbersOn),
    ),
    h("span", { class: "tb-spacer" }),
    group(themeBtn),
  );

  // ---- format bar ---------------------------------------------------------------

  const select = (label: string, options: [string, string][], onChange: (v: string) => void, read: (s: EditorState) => string, cls = "") => {
    const el = h("select", { class: `tb-select ${cls}`, title: label, "aria-label": label });
    for (const [value, text] of options) el.append(h("option", { value, text }));
    el.addEventListener("change", () => {
      onChange(el.value);
      app.focus();
    });
    updaters.push((s) => {
      const v = read(s);
      if (el.value !== v) el.value = v;
    });
    return el;
  };

  const styleSelect = select(
    "Paragraph style",
    [["paragraph", "Normal"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["quote", "Quote"], ["code", "Code"]],
    (v) => app.run(cmd.setBlockStyle(v as cmd.BlockStyle)),
    (s) => cmd.currentBlockStyle(s),
    "w-style",
  );

  const fontSelect = select(
    "Font",
    [["", "Default (Arial)"], ...FONTS.map((f): [string, string] => [f.key, f.label])],
    (v) => app.run(cmd.setKeyedMark(M.font, v || null)),
    (s) => cmd.markKey(s, M.font) ?? "",
    "w-font",
  );
  for (const opt of Array.from(fontSelect.options)) if (opt.value) opt.classList.add(`ff-${opt.value}`);

  const sizeSelect = select(
    "Font size",
    SIZES.map((n): [string, string] => [String(n), String(n)]),
    (v) => app.run(cmd.setKeyedMark(M.size, Number(v) === DEFAULT_SIZE ? null : v)),
    (s) => cmd.markKey(s, M.size) ?? String(DEFAULT_SIZE),
    "w-size",
  );

  const colorPicker = (name: IconName, title: string, type: MarkType, list: readonly ColorDef[], noneLabel: string, prefix: string) => {
    const bar = h("span", { class: "color-bar" });
    const btn = button(name, title, () => {
      const popup = h("div", { class: "window swatches", role: "dialog", "aria-label": title });
      let undismiss = () => {};
      const close = () => {
        undismiss();
        popup.remove();
      };
      const pick = (key: string | null) => {
        close();
        app.run(cmd.setKeyedMark(type, key));
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

  const alignButton = (name: IconName, title: string, align: "left" | "center" | "right" | "justify", key: string) =>
    commandButton(name, title, cmd.setAlign(align), mod(key), (s) => cmd.currentAlign(s) === align);

  const format = h(
    "div",
    { class: "tb-row" },
    group(styleSelect, fontSelect, sizeSelect),
    sep(),
    group(
      markButton("bold", "Bold", M.strong, cmd.toggleBold, mod("B")),
      markButton("italic", "Italic", M.em, cmd.toggleItalic, mod("I")),
      markButton("underline", "Underline", M.underline, cmd.toggleUnderline, mod("U")),
      markButton("strike", "Strikethrough", M.strike, cmd.toggleStrike, mod("Shift+X")),
    ),
    sep(),
    group(
      colorPicker("color", "Text color", M.color, COLORS, "Automatic", "c-"),
      colorPicker("highlight", "Highlight", M.highlight, HIGHLIGHTS, "No highlight", "hl-"),
    ),
    sep(),
    group(
      alignButton("alignLeft", "Align left", "left", "L"),
      alignButton("alignCenter", "Center", "center", "E"),
      alignButton("alignRight", "Align right", "right", "R"),
      alignButton("alignJustify", "Justify", "justify", "J"),
    ),
    sep(),
    group(
      commandButton("bullets", "Bulleted list", cmd.toggleBullets, mod("Shift+8"), (s) => cmd.currentList(s) === "bullet"),
      commandButton("numbers", "Numbered list", cmd.toggleNumbers, mod("Shift+7"), (s) => cmd.currentList(s) === "ordered"),
      commandButton("outdent", "Decrease indent", cmd.outdent, mod("[")),
      commandButton("indent", "Increase indent", cmd.indent, mod("]")),
    ),
    sep(),
    group(
      commandButton("rule", "Horizontal line", cmd.insertRule),
      commandButton("code", "Code block", cmd.toggleCodeBlock, undefined, (s) => cmd.currentBlockStyle(s) === "code"),
      commandButton("clear", "Clear formatting", cmd.clearFormatting, mod("\\")),
    ),
  );

  root.append(standard, format);
  return (state) => {
    for (const u of updaters) u(state);
  };
}
