// The application controller: owns the editor, the current document and
// every user-facing action (files, export, clipboard, view).

import { redo, undo } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as cmd from "./editor/commands.ts";
import { schema } from "./editor/schema.ts";
import { createView, MOD_LABEL, newState } from "./editor/setup.ts";
import { toDocxParts } from "./export/docx.ts";
import { toRtf } from "./export/rtf.ts";
import { toPlainText } from "./export/text.ts";
import { backend, inApp, type OpenedDoc } from "./io/backend.ts";
import { type EditableFormat, parseDocument, serializeDocument, serializeHtml } from "./io/native.ts";
import { h } from "./ui/dom.ts";
import { createFindPanel } from "./ui/find-panel.ts";
import { buildMenubar, type MenuEntry, type TopMenu } from "./ui/menu.ts";
import { alertBox, isModalOpen, showModal } from "./ui/modal.ts";
import { setPrintPageNumbers } from "./ui/page-numbers.ts";
import { createStatusBar } from "./ui/statusbar.ts";
import { currentTheme, loadZoom, onThemeChange, saveZoom, type Theme, toggleTheme, ZOOM_STEPS } from "./ui/theme.ts";
import { buildToolbar } from "./ui/toolbar.ts";

export type ExportKind = "pdf" | "docx" | "rtf" | "md" | "txt";

export interface AppApi {
  run(command: Command): void;
  focus(): void;
  undo(): void;
  redo(): void;
  newDocument(): void;
  open(): void;
  save(): void;
  exportAs(kind: ExportKind): void;
  print(): void;
  clipboard(op: "cut" | "copy" | "paste" | "paste-plain"): void;
  find(replace?: boolean): void;
  toggleTheme(): void;
  theme(): Theme;
  onThemeChange(fn: () => void): void;
}

interface DocInfo {
  token: number | null;
  name: string;
  format: EditableFormat;
  /** The document as last saved; "dirty" means the editor differs from it. */
  saved: PMNode;
}

const FORMAT_LABEL: Record<EditableFormat, string> = { html: "PaperPad", md: "Markdown", txt: "Plain text" };
const RECOVERY_INTERVAL_MS = 15_000;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function startApp() {
  const page = document.getElementById("page")!;
  const status = createStatusBar(document.getElementById("statusbar")!);
  const emptyDoc = newState().doc;

  let info: DocInfo = { token: null, name: "Untitled", format: "html", saved: emptyDoc };
  let lastDirty: boolean | null = null;
  let lastTitle = "";
  let updateToolbar: (s: EditorState) => void = () => {};

  const view: EditorView = createView(page, (_tr, v) => refresh(v.state));
  const isDirty = () => !view.state.doc.eq(info.saved);
  const stem = () => info.name.replace(/\.[^.]+$/, "") || "Untitled";

  function refresh(state: EditorState) {
    updateToolbar(state);
    status.update(state);
    setPrintPageNumbers(cmd.pageNumbersOn(state));
    const dirty = !state.doc.eq(info.saved);
    if (dirty !== lastDirty || info.name !== lastTitle) {
      lastDirty = dirty;
      lastTitle = info.name;
      void backend.setDocumentState(info.name, dirty);
    }
  }

  function loadDoc(doc: PMNode, next: Omit<DocInfo, "saved">, markSaved = true) {
    view.updateState(newState(doc));
    info = { ...next, saved: markSaved ? view.state.doc : emptyDoc };
    status.setFormat(FORMAT_LABEL[info.format]);
    refresh(view.state);
    view.focus();
  }

  const fail = (what: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    void alertBox("PaperPad", `${what}: ${message}`);
  };

  // ---- files ---------------------------------------------------------------------

  /** Returns false when the user cancelled or saving failed. */
  async function save(): Promise<boolean> {
    if (info.token === null) return saveAs();
    try {
      const doc = view.state.doc;
      await backend.save(info.token, await serializeDocument(doc, info.format, stem()));
      info.saved = doc;
      void backend.recoveryClear();
      refresh(view.state);
      status.flash(`Saved ${info.name}`);
      return true;
    } catch (e) {
      fail("Could not save", e);
      return false;
    }
  }

  async function saveAs(): Promise<boolean> {
    try {
      const doc = view.state.doc;
      const saved = await backend.saveAs(serializeHtml(doc, stem()), stem());
      if (!saved) return false;
      info = { token: saved.token, name: saved.name, format: saved.format, saved: doc };
      status.setFormat(FORMAT_LABEL[info.format]);
      void backend.recoveryClear();
      refresh(view.state);
      status.flash(`Saved ${info.name}`);
      return true;
    } catch (e) {
      fail("Could not save", e);
      return false;
    }
  }

  /** Asks what to do with unsaved changes. Resolves true when it is OK to continue. */
  async function confirmDiscard(): Promise<boolean> {
    if (!isDirty()) return true;
    const choice = await showModal({
      title: "PaperPad",
      body: `Save changes to ${info.name}?`,
      buttons: [
        { id: "save", label: "Save", primary: true },
        { id: "discard", label: "Don't Save" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });
    if (choice === "save") return save();
    if (choice === "discard") void backend.recoveryClear();
    return choice === "discard";
  }

  async function openLoaded(d: OpenedDoc) {
    let doc: PMNode;
    try {
      doc = await parseDocument(d.content, d.format);
    } catch (e) {
      return fail(`Could not read ${d.name}`, e);
    }
    loadDoc(doc, { token: d.token, name: d.name, format: d.format });
    void backend.recoveryClear();
    if (d.format !== "html") {
      status.flash(`${FORMAT_LABEL[d.format]} keeps no fonts or colors. Use Save As to keep formatting.`, 8000);
    }
  }

  async function open() {
    if (!(await confirmDiscard())) return;
    try {
      const d = await backend.open();
      if (d) await openLoaded(d);
    } catch (e) {
      fail("Could not open", e);
    }
  }

  async function openRecent(index: number) {
    if (!(await confirmDiscard())) return;
    try {
      await openLoaded(await backend.openRecent(index));
    } catch (e) {
      fail("Could not open", e);
    }
  }

  async function newDocument() {
    if (!(await confirmDiscard())) return;
    loadDoc(emptyDoc, { token: null, name: "Untitled", format: "html" });
  }

  function print() {
    // Print-to-PDF uses the page title as the default file name.
    const previous = document.title;
    document.title = stem();
    window.print();
    document.title = previous;
  }

  async function exportAs(kind: ExportKind) {
    const doc = view.state.doc;
    try {
      let name: string | null;
      switch (kind) {
        case "pdf":
          status.flash('Choose "Save as PDF" or "Microsoft Print to PDF" as the printer.', 8000);
          return print();
        case "docx":
          name = await backend.exportDocx(toDocxParts(doc, stem()), stem());
          break;
        case "rtf":
          name = await backend.exportText("rtf", toRtf(doc), stem());
          break;
        case "md":
          name = await backend.exportText("md", (await import("./export/markdown.ts")).toMarkdown(doc), stem());
          break;
        case "txt":
          name = await backend.exportText("txt", toPlainText(doc), stem());
          break;
      }
      if (name) status.flash(`Exported ${name}`);
    } catch (e) {
      fail("Could not export", e);
    }
  }

  // ---- crash recovery ------------------------------------------------------------------

  let lastRecovered: PMNode | null = null;
  setInterval(() => {
    const doc = view.state.doc;
    if (!isDirty() || doc === lastRecovered) return;
    lastRecovered = doc;
    void backend.recoveryWrite(serializeHtml(doc, stem())).catch(() => {});
  }, RECOVERY_INTERVAL_MS);

  async function offerRecovery() {
    const content = await backend.recoveryRead().catch(() => null);
    if (!content) return;
    const choice = await showModal({
      title: "Document recovery",
      body: "PaperPad closed before a document was saved. Do you want to restore it?",
      buttons: [
        { id: "restore", label: "Restore", primary: true },
        { id: "discard", label: "Discard" },
      ],
      cancelId: "discard",
    });
    if (choice === "restore") {
      // Restored as an unsaved document so the user is asked to save it.
      loadDoc(await parseDocument(content, "html"), { token: null, name: "Recovered", format: "html" }, false);
    } else {
      void backend.recoveryClear();
    }
  }

  // ---- editing helpers ----------------------------------------------------------------------

  const run = (command: Command) => {
    command(view.state, view.dispatch);
    view.focus();
  };

  async function clipboard(op: "cut" | "copy" | "paste" | "paste-plain") {
    view.focus();
    if (op === "cut" || op === "copy") {
      if (!document.execCommand(op)) status.flash(`Use ${MOD_LABEL}+${op === "cut" ? "X" : "C"}`);
      return;
    }
    try {
      if (op === "paste" && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes("text/html")) {
            view.pasteHTML(await (await item.getType("text/html")).text());
            return;
          }
        }
      }
      view.pasteText(await navigator.clipboard.readText());
    } catch {
      status.flash(`Press ${MOD_LABEL}+V to paste${op === "paste-plain" ? " (with Shift for plain text)" : ""}`);
    }
  }

  // ---- zoom -------------------------------------------------------------------------------

  let zoom = loadZoom();
  const applyZoom = () => {
    // CSSOM writes are allowed by the CSP (only style attributes in markup are not).
    page.style.setProperty("zoom", String(zoom));
    status.setZoom(zoom);
  };
  const changeZoom = (dir: -1 | 0 | 1) => {
    if (dir === 0) zoom = 1;
    else {
      const i = ZOOM_STEPS.indexOf(zoom);
      zoom = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]!;
    }
    saveZoom(zoom);
    applyZoom();
  };
  applyZoom();

  // ---- find --------------------------------------------------------------------------------

  const findPanel = createFindPanel(() => view);

  // ---- dialogs ------------------------------------------------------------------------------

  function about() {
    const body = h(
      "div",
      { class: "about" },
      h("img", { src: "/icon.png", alt: "", width: "64", height: "64" }),
      h(
        "div",
        {},
        h("p", {}, h("strong", { text: "PaperPad 0.1.0" })),
        h("p", { text: "A fast, light and local-first word processor." }),
        h("p", { text: "Copyright (c) 2026 Paper Board Labs." }),
        h("p", { text: "Free for personal and other noncommercial use under the PolyForm Noncommercial License 1.0.0." }),
        h("p", { class: "muted", text: "Your documents never leave your computer." }),
      ),
    );
    void showModal({ title: "About PaperPad", body, buttons: [{ id: "ok", label: "OK", primary: true }], cancelId: "ok" });
  }

  function shortcuts() {
    const m = MOD_LABEL;
    const rows: [string, string][] = [
      [`${m}+N / O / S`, "New, open, save"],
      [`${m}+Shift+S`, "Save as"],
      [`${m}+P`, "Print or save as PDF"],
      [`${m}+Z / Y`, "Undo, redo"],
      [`${m}+F / H`, "Find, replace"],
      [`${m}+B / I / U`, "Bold, italic, underline"],
      [`${m}+Shift+X`, "Strikethrough"],
      [`${m}+L / E / R / J`, "Align left, center, right, justify"],
      [`${m}+Shift+8 / 7`, "Bulleted, numbered list"],
      [`${m}+[ / ]`, "Decrease, increase indent"],
      [`Tab / Shift+Tab`, "Nest list item, or type a tab"],
      [`${m}+Alt+0 to 3`, "Normal, heading 1 to 3"],
      [`Shift+Enter`, "Line break"],
      [`${m}+Shift+V`, "Paste as plain text"],
      [`${m}+\\`, "Clear formatting"],
      [`${m}+Shift+D`, "Toggle dark mode"],
      [`${m}+ + / - / 0`, "Zoom in, out, reset"],
    ];
    const table = h("table", { class: "keys" });
    for (const [k, v] of rows) table.append(h("tr", {}, h("td", {}, h("kbd", { text: k })), h("td", { text: v })));
    void showModal({ title: "Keyboard shortcuts", body: table, buttons: [{ id: "ok", label: "OK", primary: true }], cancelId: "ok" });
  }

  // ---- menus ---------------------------------------------------------------------------------

  const mod = (k: string) => `${MOD_LABEL}+${k}`;
  const M = schema.marks;

  const exportItems = (): MenuEntry[] => [
    { label: "PDF (print to PDF)...", run: () => void exportAs("pdf") },
    { label: "Word document (.docx)...", run: () => void exportAs("docx") },
    { label: "Rich Text (.rtf)...", run: () => void exportAs("rtf") },
    { label: "Markdown (.md)...", run: () => void exportAs("md") },
    { label: "Plain text (.txt)...", run: () => void exportAs("txt") },
  ];

  const recentItems = async (): Promise<MenuEntry[]> => {
    const list = await backend.listRecent().catch(() => []);
    if (!list.length) return [{ label: "(empty)", run: () => {}, enabled: () => false }];
    return list.map((r) => ({
      label: `${r.index + 1}  ${r.name}${r.folder ? `  (${r.folder})` : ""}`,
      run: () => void openRecent(r.index),
    }));
  };

  const can = (c: Command) => () => c(view.state);
  const menus: TopMenu[] = [
    {
      label: "File",
      key: "f",
      items: () => [
        { label: "New", shortcut: mod("N"), run: () => void newDocument() },
        { label: "Open...", shortcut: mod("O"), run: () => void open() },
        { kind: "sub", label: "Open recent", items: recentItems },
        { kind: "sep" },
        { label: "Save", shortcut: mod("S"), run: () => void save() },
        { label: "Save as...", shortcut: mod("Shift+S"), run: () => void saveAs() },
        { kind: "sub", label: "Export", items: exportItems },
        { kind: "sep" },
        { label: "Print...", shortcut: mod("P"), run: print },
      ],
    },
    {
      label: "Edit",
      key: "e",
      items: () => [
        { label: "Undo", shortcut: mod("Z"), run: () => run(undo), enabled: can(undo) },
        { label: "Redo", shortcut: mod("Y"), run: () => run(redo), enabled: can(redo) },
        { kind: "sep" },
        { label: "Cut", shortcut: mod("X"), run: () => void clipboard("cut") },
        { label: "Copy", shortcut: mod("C"), run: () => void clipboard("copy") },
        { label: "Paste", shortcut: mod("V"), run: () => void clipboard("paste") },
        { label: "Paste as plain text", shortcut: mod("Shift+V"), run: () => void clipboard("paste-plain") },
        { label: "Select all", shortcut: mod("A"), run: () => run(cmd.selectAllText) },
        { kind: "sep" },
        { label: "Find...", shortcut: mod("F"), run: () => findPanel.open() },
        { label: "Replace...", shortcut: mod("H"), run: () => findPanel.open(true) },
      ],
    },
    {
      label: "View",
      key: "v",
      items: () => [
        { label: "Dark mode", shortcut: mod("Shift+D"), run: toggleTheme, checked: () => currentTheme() === "dark" },
        { kind: "sep" },
        { label: "Zoom in", shortcut: mod("+"), run: () => changeZoom(1) },
        { label: "Zoom out", shortcut: mod("-"), run: () => changeZoom(-1) },
        { label: "Actual size", shortcut: mod("0"), run: () => changeZoom(0) },
        { kind: "sep" },
        { label: "Page numbers", run: () => run(cmd.togglePageNumbers), checked: () => cmd.pageNumbersOn(view.state) },
      ],
    },
    {
      label: "Format",
      key: "o",
      items: () => [
        { label: "Bold", shortcut: mod("B"), run: () => run(cmd.toggleBold), checked: () => cmd.markActive(view.state, M.strong) },
        { label: "Italic", shortcut: mod("I"), run: () => run(cmd.toggleItalic), checked: () => cmd.markActive(view.state, M.em) },
        { label: "Underline", shortcut: mod("U"), run: () => run(cmd.toggleUnderline), checked: () => cmd.markActive(view.state, M.underline) },
        { label: "Strikethrough", shortcut: mod("Shift+X"), run: () => run(cmd.toggleStrike), checked: () => cmd.markActive(view.state, M.strike) },
        { kind: "sep" },
        {
          kind: "sub",
          label: "Paragraph style",
          items: () =>
            ([["paragraph", "Normal", "0"], ["h1", "Heading 1", "1"], ["h2", "Heading 2", "2"], ["h3", "Heading 3", "3"], ["quote", "Quote", ""], ["code", "Code", ""]] as const).map(([s, label, k]) => ({
              label,
              shortcut: k ? mod(`Alt+${k}`) : undefined,
              run: () => run(cmd.setBlockStyle(s)),
              checked: () => cmd.currentBlockStyle(view.state) === s,
            })),
        },
        {
          kind: "sub",
          label: "Alignment",
          items: () =>
            ([["left", "Left", "L"], ["center", "Center", "E"], ["right", "Right", "R"], ["justify", "Justify", "J"]] as const).map(([a, label, k]) => ({
              label,
              shortcut: mod(k),
              run: () => run(cmd.setAlign(a)),
              checked: () => cmd.currentAlign(view.state) === a,
            })),
        },
        { label: "Bulleted list", shortcut: mod("Shift+8"), run: () => run(cmd.toggleBullets), checked: () => cmd.currentList(view.state) === "bullet" },
        { label: "Numbered list", shortcut: mod("Shift+7"), run: () => run(cmd.toggleNumbers), checked: () => cmd.currentList(view.state) === "ordered" },
        { label: "Increase indent", shortcut: mod("]"), run: () => run(cmd.indent) },
        { label: "Decrease indent", shortcut: mod("["), run: () => run(cmd.outdent) },
        { kind: "sep" },
        { label: "Horizontal line", run: () => run(cmd.insertRule) },
        { label: "Clear formatting", shortcut: mod("\\"), run: () => run(cmd.clearFormatting) },
      ],
    },
    {
      label: "Help",
      key: "h",
      items: () => [
        { label: "Keyboard shortcuts", shortcut: "F1", run: shortcuts },
        { kind: "sep" },
        { label: "About PaperPad", run: about },
      ],
    },
  ];

  const menubar = buildMenubar(document.getElementById("menubar")!, menus);

  // ---- toolbar ------------------------------------------------------------------------------

  const api: AppApi = {
    run,
    focus: () => view.focus(),
    undo: () => run(undo),
    redo: () => run(redo),
    newDocument: () => void newDocument(),
    open: () => void open(),
    save: () => void save(),
    exportAs: (k) => void exportAs(k),
    print,
    clipboard: (op) => void clipboard(op),
    find: (replace) => findPanel.open(replace),
    toggleTheme,
    theme: currentTheme,
    onThemeChange,
  };
  updateToolbar = buildToolbar(document.getElementById("toolbar")!, api);

  // ---- global keys and browser behavior ----------------------------------------------------

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isModalOpen()) return;
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    const act = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    if (!isMac && menubar.handleAltKey(e)) return e.preventDefault();
    if (e.key === "F1") return act(shortcuts);
    // A webview reloads on F5 or Ctrl+R, which would throw away unsaved work.
    if (e.key === "F5" || (modKey && k === "r")) return e.preventDefault();
    if (!modKey) return;

    if (e.shiftKey && k === "s") return act(() => void saveAs());
    if (e.shiftKey && k === "d") return act(toggleTheme);
    if (e.shiftKey || e.altKey) return;
    switch (k) {
      case "n": return act(() => void newDocument());
      case "o": return act(() => void open());
      case "s": return act(() => void save());
      case "p": return act(print);
      case "f": return act(() => findPanel.open());
      case "h": return act(() => findPanel.open(true));
      case "=":
      case "+": return act(() => changeZoom(1));
      case "-": return act(() => changeZoom(-1));
      case "0": return act(() => changeZoom(0));
    }
  });

  // Keep the webview from navigating to dropped files and hide the browser
  // context menu outside text areas.
  for (const type of ["dragover", "drop"] as const) {
    window.addEventListener(type, (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        if (type === "drop") status.flash("Use File, Open to open a document");
      }
    });
  }
  document.addEventListener("contextmenu", (e) => {
    if (!(e.target as Element).closest(".ProseMirror, input, textarea")) e.preventDefault();
  });

  if (!inApp) status.flash("Browser preview: open and save need the desktop app", 10000);
  status.setFormat(FORMAT_LABEL[info.format]);
  refresh(view.state);
  view.focus();
  void offerRecovery();
}
