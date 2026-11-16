// Entry of the mobile shell (mobile.html): a touch layout over the shared core.
//
// - Top bar: main menu, document name, undo, redo and save.
// - Formatting bar at the bottom: with the viewport's interactive-widget
//   setting it sits right above the on-screen keyboard, where the thumbs are.
// - Continuous view only: an A4 page does not fit a tablet held upright.
//
// Touch rules (ANDROID.md, "Requisiti touch"): buttons are at least 48 px and
// never take the focus from the editor, so the keyboard stays open; no native
// <select> and no handler on contextmenu, so long-press keeps the system
// selection handles and Gboard's menu.

import "prosemirror-view/style/prosemirror.css";
import { type Command, type EditorState, Selection } from "prosemirror-state";
import { EDITOR_ACTIONS, type EditorAction } from "../editor/actions.ts";
import * as cmd from "../editor/commands.ts";
import { setPageView } from "../editor/pages.ts";
import { createView } from "../editor/setup.ts";
import { inApp } from "../io/backend.ts";
import { VERSION } from "../version.ts";
import { h } from "../ui-kit/dom.ts";
import { icon, type IconName } from "../ui-kit/icons.ts";
import { alertBox, isModalOpen } from "../ui-kit/modal.ts";
import { currentTheme, initTheme, toggleTheme } from "../ui-kit/theme.ts";
import { createSession, type Session } from "./session.ts";

initTheme();
setPageView(false);

const topBar = document.getElementById("topbar")!;
const formatBar = document.getElementById("format")!;
const page = document.getElementById("page")!;

// ---- messages ---------------------------------------------------------------------

const toast = h("div", { class: "m-toast", role: "status", "aria-live": "polite", hidden: true });
document.body.append(toast);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const notify = (text: string, ms = 4000) => {
  clearTimeout(toastTimer);
  toast.textContent = text;
  toast.hidden = !text;
  toastTimer = setTimeout(() => (toast.hidden = true), ms);
};

// ---- editor and document ------------------------------------------------------------

/** Updates every button's pressed and enabled state. */
const updaters: ((state: EditorState) => void)[] = [];
let session: Session | undefined;

const refresh = (state: EditorState) => {
  for (const update of updaters) update(state);
  session?.changed();
};

const view = createView(page, refresh);
// Spelling and autocorrect come from Gboard; the webview's own check only underlines.
view.dom.setAttribute("spellcheck", "true");

const title = h("span", { class: "m-title-name" });
const dirtyMark = h("span", { class: "m-dirty", text: "*", "aria-label": "Unsaved changes", hidden: true });

const showFile = () => {
  if (!session) return;
  const { name } = session.file();
  title.textContent = name;
  dirtyMark.hidden = !session.isDirty();
  document.title = `${name} - PaperPad`;
};
updaters.push(showFile);

session = createSession(view, notify, () => {
  showFile();
  refresh(view.state);
});
const S = session;

// ---- buttons ----------------------------------------------------------------------------

/** A button that never takes the focus, so tapping it keeps the keyboard open. */
const button = (content: Node | string, label: string, onTap: () => void, extraClass = "") => {
  const btn = h("button", { class: `tb ${extraClass}`.trim(), type: "button", "aria-label": label, title: label }, content);
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", onTap);
  return btn;
};

/** Runs an editor command. No view.focus(): it would reopen a keyboard the user closed. */
const run = (command: Command) => command(view.state, view.dispatch);

const tool = (content: Node | string, label: string, command: Command, pressed?: (s: EditorState) => boolean, enabled?: (s: EditorState) => boolean) => {
  const btn = button(content, label, () => run(command), typeof content === "string" ? "m-text-tool" : "");
  if (pressed) updaters.push((s) => btn.setAttribute("aria-pressed", String(pressed(s))));
  if (enabled) updaters.push((s) => (btn.disabled = !enabled(s)));
  return btn;
};

const action = (a: EditorAction, name: IconName) => tool(icon(name), a.label, a.command, a.active, a.enabled);

const blockStyle = (text: string, label: string, style: cmd.BlockStyle) =>
  tool(text, label, cmd.setBlockStyle(style), (s) => cmd.currentBlockStyle(s) === style);

const sep = () => h("span", { class: "tb-sep", role: "separator" });

// ---- main menu ----------------------------------------------------------------------------

const menuButton = button(icon("menu"), "Menu", () => toggleMenu());
menuButton.setAttribute("aria-haspopup", "menu");
menuButton.setAttribute("aria-expanded", "false");

const menu = h("div", { class: "window m-menu", role: "menu", hidden: true });
const backdrop = h("div", { class: "m-backdrop", hidden: true });
backdrop.addEventListener("click", () => closeMenu());
document.body.append(backdrop, menu);

const closeMenu = () => {
  menu.hidden = backdrop.hidden = true;
  menuButton.setAttribute("aria-expanded", "false");
};

const toggleMenu = () => {
  if (!menu.hidden) return closeMenu();
  darkItem.setAttribute("aria-checked", String(currentTheme() === "dark"));
  menu.hidden = backdrop.hidden = false;
  menuButton.setAttribute("aria-expanded", "true");
};

const menuItem = (name: IconName | null, label: string, onTap: () => void, role = "menuitem") => {
  const item = h("button", { class: "m-item", type: "button", role }, name ? icon(name) : h("span", { class: "m-item-gap" }), h("span", { text: label }));
  item.addEventListener("mousedown", (e) => e.preventDefault());
  item.addEventListener("click", () => {
    closeMenu();
    onTap();
  });
  return item;
};

const about = () =>
  void alertBox(
    "About PaperPad",
    h(
      "div",
      { class: "about" },
      h("img", { src: "/icon.png", alt: "", width: "64", height: "64" }),
      h(
        "div",
        {},
        h("p", {}, h("strong", { text: `PaperPad ${VERSION}` })),
        h("p", { text: "A fast, light and local-first word processor." }),
        h("p", { text: "Copyright © 2026 Paper Board Labs." }),
        h("p", { text: "Free for personal and other noncommercial use under the PolyForm Noncommercial License 1.0.0." }),
        h("p", { text: "Includes the fonts Atkinson Hyperlegible, Inter, Literata and JetBrains Mono, under the SIL Open Font License 1.1." }),
      ),
    ),
  );

const darkItem = menuItem("moon", "Dark mode", toggleTheme, "menuitemcheckbox");
menu.append(
  menuItem("new", "New", () => void S.newDocument()),
  menuItem("open", "Open...", () => void S.open()),
  menuItem("save", "Save", () => void S.save()),
  menuItem("save", "Save as...", () => void S.saveAs()),
  h("hr", { class: "m-menu-sep" }),
  menuItem("image", "Add image...", () => void S.addImage()),
  h("hr", { class: "m-menu-sep" }),
  darkItem,
  menuItem(null, "About PaperPad", about),
);

// ---- bars -------------------------------------------------------------------------------------

const A = EDITOR_ACTIONS;

topBar.append(
  menuButton,
  h("div", { class: "m-title" }, title, dirtyMark),
  action(A.undo, "undo"),
  action(A.redo, "redo"),
  button(icon("save"), "Save", () => void S.save()),
);

formatBar.append(
  action(A.bold, "bold"),
  action(A.italic, "italic"),
  action(A.underline, "underline"),
  action(A.strike, "strike"),
  action(A.clearFormatting, "clear"),
  sep(),
  blockStyle("¶", "Normal", "paragraph"),
  blockStyle("H1", "Heading 1", "h1"),
  blockStyle("H2", "Heading 2", "h2"),
  blockStyle("H3", "Heading 3", "h3"),
  tool("❝", "Quote", cmd.toggleQuote, (s) => cmd.currentBlockStyle(s) === "quote"),
  action(A.codeBlock, "code"),
  sep(),
  action(A.bullets, "bullets"),
  action(A.numbers, "numbers"),
  action(A.outdent, "outdent"),
  action(A.indent, "indent"),
  sep(),
  action(A.alignLeft, "alignLeft"),
  action(A.alignCenter, "alignCenter"),
  action(A.alignRight, "alignRight"),
  sep(),
  action(A.rule, "rule"),
  button(icon("image"), "Add image", () => void S.addImage()),
);

// The desk around the sheet is outside the editor: a tap there puts the caret
// at the end of the document and opens the keyboard, as a tap on the sheet does.
document.getElementById("workspace")!.addEventListener("click", (e) => {
  if (view.dom.contains(e.target as Node)) return;
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
  view.focus();
});

// ---- lifecycle ------------------------------------------------------------------------------

// Android has no close event: leaving the app is the last chance to save.
// Coming back, the file may have changed on another device.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") S.leaving();
  else void S.reloadIfChanged();
});

// A webview reloads on F5 or Ctrl+R (with a hardware keyboard), which would
// throw away unsaved work. Ctrl+S saves, as on desktop.
window.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || isModalOpen()) return;
  const key = e.key.toLowerCase();
  if (e.key === "F5" || (e.ctrlKey && key === "r")) e.preventDefault();
  if (e.ctrlKey && key === "s") {
    e.preventDefault();
    void (e.shiftKey ? S.saveAs() : S.save());
  }
});

showFile();
refresh(view.state);
if (!inApp) notify("Browser preview: open and save need the app", 10000);
void S.offerRecovery().catch(() => {});
