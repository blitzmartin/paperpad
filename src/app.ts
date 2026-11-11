// The application controller: owns the editor, the current document and
// every user-facing action (files, export, clipboard, view).

import { keydownHandler } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { BLOCK_STYLES, EDITOR_ACTIONS, type EditorAction, type EditorActionId } from "./editor/actions.ts";
import * as cmd from "./editor/commands.ts";
import { pageViewOn, relayoutPages, setPageView } from "./editor/pages.ts";
import { blankDoc, createView, newState } from "./editor/setup.ts";
import { schema } from "./editor/schema.ts";
import { toDocxParts } from "./export/docx.ts";
import { toRtf } from "./export/rtf.ts";
import { toPlainText } from "./export/text.ts";
import { backend, inApp, type OpenedDoc, type TextExport } from "./io/backend.ts";
import { type EditableFormat, parseDocument, serializeDocument, serializeHtml } from "./io/native.ts";
import type { Action } from "./ui/action.ts";
import { h } from "./ui/dom.ts";
import { createFindPanel } from "./ui/find-panel.ts";
import { IS_MAC, keyLabel, MOD_LABEL } from "./ui/keys.ts";
import { buildMenubar, type MenuEntry, SEP, type TopMenu } from "./ui/menu.ts";
import { alertBox, isModalOpen, showModal } from "./ui/modal.ts";
import { AUTOSAVE_INTERVALS } from "./ui/autosave.ts";
import { autosavePrefs, initSpelling, initWritingFeel, onAutosaveChange, openOptions, type OptionsResult, preferredFont, setAutosavePrefs } from "./ui/options.ts";
import { setPrintPageNumbers } from "./ui/page-numbers.ts";
import { createStatusBar } from "./ui/statusbar.ts";
import { openStylesDialog } from "./ui/styles-dialog.ts";
import { currentPalette, currentTheme, loadPref, loadZoom, onThemeChange, PALETTES, saveZoom, setPalette, storePref, toggleTheme, ZOOM_STEPS } from "./ui/theme.ts";
import { buildToolbar } from "./ui/toolbar.ts";

/** Every action the menus, the toolbar and the keyboard can trigger. */
export interface AppActions extends Record<EditorActionId, Action> {
  newDocument: Action;
  open: Action;
  save: Action;
  saveAs: Action;
  autosave: Action;
  print: Action;
  cut: Action;
  copy: Action;
  paste: Action;
  pastePlain: Action;
  find: Action;
  replace: Action;
  darkMode: Action;
  zoomIn: Action;
  zoomOut: Action;
  zoomReset: Action;
  pageView: Action;
  infiniteView: Action;
  options: Action;
  styles: Action;
  shortcuts: Action;
  about: Action;
}

interface DocInfo {
  token: number | null;
  name: string;
  format: EditableFormat;
  /** The document as last saved; "dirty" means the editor differs from it. */
  saved: PMNode;
}

type FileInfo = Omit<DocInfo, "saved">;
type ExportKind = "pdf" | "docx" | TextExport;

const FORMAT_LABEL: Record<EditableFormat, string> = { html: "PaperPad", md: "Markdown", txt: "Plain text" };
const RECOVERY_INTERVAL_MS = 15_000;
const intervalLabel = (s: number) => AUTOSAVE_INTERVALS.find(([v]) => v === s)?.[1] ?? `${s} seconds`;
const LAYOUT_KEY = "paperpad.layout";

const EXPORTS: [ExportKind, string][] = [
  ["pdf", "PDF (print to PDF)…"],
  ["docx", "Word document (.docx)…"],
  ["rtf", "Rich Text (.rtf)…"],
  ["md", "Markdown (.md)…"],
  ["txt", "Plain text (.txt)…"],
];

const TEXT_EXPORTERS: Record<TextExport, (doc: PMNode) => string | Promise<string>> = {
  rtf: toRtf,
  // The Markdown module (with markdown-it) is loaded only when first needed.
  md: async (doc) => (await import("./export/markdown.ts")).toMarkdown(doc),
  txt: toPlainText,
};

export function startApp() {
  const page = document.getElementById("page")!;
  const status = createStatusBar(document.getElementById("statusbar")!);
  /** A new, empty document in the default font chosen in View, Options. */
  const emptyDoc = () => newState(blankDoc(preferredFont())).doc;

  let info: DocInfo = { token: null, name: "Untitled", format: "html", saved: emptyDoc() };
  let lastDirty: boolean | null = null;
  let lastTitle = "";
  /** True while a save is being written, so autosave does not write at the same time. */
  let saving = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  let updateToolbar: (s: EditorState) => void = () => {};

  initWritingFeel();
  // Page view unless the user chose the infinite one.
  setPageView(loadPref(LAYOUT_KEY) !== "infinite");
  const view = createView(page, (state) => refresh(state));
  view.updateState(newState(info.saved));
  initSpelling(view.dom);
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
    scheduleAutosave();
  }

  function setInfo(next: DocInfo) {
    info = next;
    status.setFormat(FORMAT_LABEL[info.format]);
    refresh(view.state);
  }

  function loadDoc(doc: PMNode, file: FileInfo, markSaved = true) {
    cancelAutosave();
    // In infinite view a document has no page numbers, so the next save drops
    // them. Not marked as a change: opening a file alone does not rewrite it.
    if (!pageViewOn() && doc.attrs.pageNumbers) doc = doc.type.create({ ...doc.attrs, pageNumbers: false }, doc.content, doc.marks);
    view.updateState(newState(doc));
    setInfo({ ...file, saved: markSaved ? view.state.doc : emptyDoc() });
    view.focus();
  }

  const fail = (what: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    void alertBox("PaperPad", `${what}: ${message}`);
  };

  // ---- files ---------------------------------------------------------------------

  /**
   * Writes the document and records it as saved. False when cancelled or failed.
   * An autosave reports in the status bar only, never with a dialog.
   */
  async function persist(write: (doc: PMNode) => Promise<FileInfo | null>, auto = false): Promise<boolean> {
    const doc = view.state.doc;
    saving = true;
    try {
      const file = await write(doc);
      if (!file) return false;
      // The file may have been replaced (Save As) while this was written.
      if (auto && file.token !== info.token) return false;
      setInfo({ ...file, saved: doc });
      // Typing during the write keeps the document dirty: recovery still covers it.
      if (!isDirty()) void backend.recoveryClear();
      status.flash(auto ? "Autosaved" : `Saved ${info.name}`, auto ? 2000 : 4000);
      return true;
    } catch (e) {
      if (auto) status.flash(`Autosave failed: ${e instanceof Error ? e.message : String(e)}`, 10000);
      else fail("Could not save", e);
      return false;
    } finally {
      saving = false;
      refresh(view.state);
    }
  }

  const saveAs = () => persist((doc) => backend.saveAs(serializeHtml(doc, stem()), stem()));

  function save(auto = false): Promise<boolean> {
    const file: FileInfo = info;
    if (file.token === null) return saveAs();
    const token = file.token;
    return persist(async (doc) => {
      await backend.save(token, await serializeDocument(doc, file.format, stem()));
      return file;
    }, auto);
  }

  // ---- autosave ---------------------------------------------------------------------

  /** Only PaperPad files that already exist: text and Markdown would lose formatting. */
  function canAutosave() {
    return autosavePrefs().on && info.token !== null && info.format === "html";
  }

  function cancelAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  }

  /** Plans a save a set time after the first unsaved change. Called on every editor update. */
  function scheduleAutosave() {
    if (autosaveTimer !== undefined || !canAutosave() || !isDirty()) return;
    autosaveTimer = setTimeout(autosaveNow, autosavePrefs().seconds * 1000);
  }

  function autosaveNow() {
    cancelAutosave();
    if (!canAutosave() || !isDirty()) return;
    // Wait while a dialog is open (it may be asking about these very changes)
    // or another save is being written.
    if (saving || isModalOpen()) {
      autosaveTimer = setTimeout(autosaveNow, 2000);
      return;
    }
    void save(true);
  }

  onAutosaveChange(() => {
    cancelAutosave();
    scheduleAutosave();
  });
  // Switching to another window saves right away.
  window.addEventListener("blur", () => {
    if (autosaveTimer !== undefined) autosaveNow();
  });

  function toggleAutosave() {
    const p = autosavePrefs();
    setAutosavePrefs({ ...p, on: !p.on });
    if (!p.on) {
      if (info.token === null) status.flash("Autosave starts after you save this document once", 6000);
      else if (info.format !== "html") status.flash(`${FORMAT_LABEL[info.format]} files are not autosaved. Use Save As to keep formatting.`, 8000);
      else status.flash(`Autosave is on: changes are saved after ${intervalLabel(p.seconds)}`);
    } else status.flash("Autosave is off");
    view.focus();
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

  async function openFrom(pick: () => Promise<OpenedDoc | null>) {
    if (!(await confirmDiscard())) return;
    let d: OpenedDoc | null;
    let doc: PMNode;
    try {
      d = await pick();
      if (!d) return;
    } catch (e) {
      return fail("Could not open", e);
    }
    try {
      doc = await parseDocument(d.content, d.format, preferredFont());
    } catch (e) {
      return fail(`Could not read ${d.name}`, e);
    }
    loadDoc(doc, { token: d.token, name: d.name, format: d.format });
    void backend.recoveryClear();
    if (d.format !== "html") {
      const auto = autosavePrefs().on ? " It is not autosaved." : "";
      status.flash(`${FORMAT_LABEL[d.format]} keeps no fonts or colors.${auto} Use Save As to keep formatting.`, 8000);
    }
  }

  async function newDocument() {
    if (await confirmDiscard()) loadDoc(emptyDoc(), { token: null, name: "Untitled", format: "html" });
  }

  function print() {
    // Print-to-PDF uses the page title as the default file name.
    const previous = document.title;
    document.title = stem();
    window.print();
    document.title = previous;
  }

  async function exportAs(kind: ExportKind) {
    if (kind === "pdf") {
      status.flash('Choose "Save as PDF" or "Microsoft Print to PDF" as the printer.', 8000);
      return print();
    }
    const doc = view.state.doc;
    try {
      const name =
        kind === "docx"
          ? await backend.exportDocx(toDocxParts(doc, stem()), stem())
          : await backend.exportText(kind, await TEXT_EXPORTERS[kind](doc), stem());
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
      loadDoc(await parseDocument(content, "html", preferredFont()), { token: null, name: "Recovered", format: "html" }, false);
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
      if (!document.execCommand(op)) status.flash(`Use ${keyLabel(op === "cut" ? "Mod-x" : "Mod-c")}`);
      return;
    }
    try {
      if (op === "paste" && navigator.clipboard.read) {
        for (const item of await navigator.clipboard.read()) {
          if (item.types.includes("text/html")) {
            view.pasteHTML(await (await item.getType("text/html")).text());
            return;
          }
        }
      }
      view.pasteText(await navigator.clipboard.readText());
    } catch {
      status.flash(`Press ${keyLabel("Mod-v")} to paste${op === "paste-plain" ? " (with Shift for plain text)" : ""}`);
    }
  }

  // ---- zoom -------------------------------------------------------------------------------

  let zoom = loadZoom();
  const applyZoom = () => {
    // CSSOM writes are allowed by the CSP (only style attributes in markup are not).
    page.style.setProperty("zoom", String(zoom));
    status.setZoom(zoom);
    // Text can wrap a little differently at another zoom.
    relayoutPages();
  };
  const changeZoom = (dir: -1 | 0 | 1) => {
    const i = ZOOM_STEPS.indexOf(zoom);
    zoom = dir === 0 ? 1 : ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))]!;
    saveZoom(zoom);
    applyZoom();
  };
  applyZoom();

  // ---- page layout -----------------------------------------------------------------------

  function setLayout(pages: boolean) {
    setPageView(pages);
    storePref(LAYOUT_KEY, pages ? "pages" : "infinite");
    // Infinite view has no page numbers button, so numbers left on would
    // print with no way to turn them off. Kept out of undo for the same reason.
    if (!pages && cmd.pageNumbersOn(view.state)) {
      view.dispatch(view.state.tr.setDocAttribute("pageNumbers", false).setMeta("addToHistory", false));
    }
    // The toolbar shows the page numbers button in page view only.
    refresh(view.state);
    view.focus();
  }

  /** A new default font also applies to the open document while it is still empty. */
  function applyOptions(result: OptionsResult) {
    const font = result.fontChanged;
    const doc = view.state.doc;
    const empty = doc.childCount === 1 && doc.firstChild!.type === schema.nodes.paragraph && doc.firstChild!.content.size === 0;
    if (font && empty && doc.attrs.font !== font) {
      const wasSaved = !isDirty();
      view.dispatch(view.state.tr.setDocAttribute("font", font).setMeta("addToHistory", false));
      if (wasSaved) info = { ...info, saved: view.state.doc };
      refresh(view.state);
    }
    view.focus();
  }

  /** Format, Styles: one undoable change to the document's font and styles. */
  async function editStyles() {
    const result = await openStylesDialog(view.state.doc.attrs);
    if (result) view.dispatch(view.state.tr.setDocAttribute("font", result.font).setDocAttribute("styles", result.styles));
    view.focus();
  }

  // Pages are measured with the document fonts, so measure again once they load.
  void document.fonts?.ready.then(relayoutPages);

  // ---- dialogs ------------------------------------------------------------------------------

  const findPanel = createFindPanel(view);

  function about() {
    void alertBox(
      "About PaperPad",
      h(
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
      ),
    );
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
      [`Up / Down`, "Leave a code block from its first or last line"],
      [`${m}+Shift+V`, "Paste as plain text"],
      [`${m}+\\`, "Clear formatting"],
      [`${m}+Shift+D`, "Toggle dark mode"],
      [`${m}+ + / - / 0`, "Zoom in, out, reset"],
    ];
    const table = h("table", { class: "keys" });
    for (const [k, v] of rows) table.append(h("tr", {}, h("td", {}, h("kbd", { text: k })), h("td", { text: v })));
    void alertBox("Keyboard shortcuts", table);
  }

  // ---- actions --------------------------------------------------------------------------------

  const fromEditor = ({ label, keys, command, active, enabled }: EditorAction): Action => ({
    label,
    keys,
    run: () => run(command),
    checked: active && (() => active(view.state)),
    enabled: enabled && (() => enabled(view.state)),
  });

  const A: AppActions = {
    ...(Object.fromEntries(Object.entries(EDITOR_ACTIONS).map(([id, a]) => [id, fromEditor(a)])) as Record<EditorActionId, Action>),
    pageNumbers: { ...fromEditor(EDITOR_ACTIONS.pageNumbers), visible: pageViewOn },
    newDocument: { label: "New", keys: ["Mod-n"], run: () => void newDocument() },
    open: { label: "Open...", keys: ["Mod-o"], run: () => void openFrom(backend.open) },
    save: { label: "Save", keys: ["Mod-s"], run: () => void save() },
    saveAs: { label: "Save as...", keys: ["Shift-Mod-s"], run: () => void saveAs() },
    autosave: { label: "Autosave", run: toggleAutosave, checked: () => autosavePrefs().on },
    print: { label: "Print...", keys: ["Mod-p"], run: print },
    // The webview handles these keys itself; the shortcut is only shown.
    cut: { label: "Cut", hint: "Mod-x", run: () => void clipboard("cut") },
    copy: { label: "Copy", hint: "Mod-c", run: () => void clipboard("copy") },
    paste: { label: "Paste", hint: "Mod-v", run: () => void clipboard("paste") },
    pastePlain: { label: "Paste as plain text", hint: "Shift-Mod-v", run: () => void clipboard("paste-plain") },
    find: { label: "Find...", keys: ["Mod-f"], run: () => findPanel.open() },
    replace: { label: "Replace...", keys: ["Mod-h"], run: () => findPanel.open(true) },
    darkMode: { label: "Dark mode", keys: ["Shift-Mod-d"], run: toggleTheme, checked: () => currentTheme() === "dark" },
    zoomIn: { label: "Zoom in", keys: ["Mod-+", "Mod-="], run: () => changeZoom(1) },
    zoomOut: { label: "Zoom out", keys: ["Mod--"], run: () => changeZoom(-1) },
    zoomReset: { label: "Actual size", keys: ["Mod-0"], run: () => changeZoom(0) },
    pageView: { label: "Page view", run: () => setLayout(true), checked: pageViewOn },
    infiniteView: { label: "Infinite view", run: () => setLayout(false), checked: () => !pageViewOn() },
    options: { label: "Options...", run: () => void openOptions().then(applyOptions) },
    styles: { label: "Styles...", run: () => void editStyles() },
    shortcuts: { label: "Keyboard shortcuts", keys: ["F1"], run: shortcuts },
    about: { label: "About PaperPad", run: about },
  };

  // ---- menus ---------------------------------------------------------------------------------

  const exportItems = (): MenuEntry[] => EXPORTS.map(([kind, label]) => ({ label, run: () => void exportAs(kind) }));

  const recentItems = async (): Promise<MenuEntry[]> => {
    const list = await backend.listRecent().catch(() => []);
    if (!list.length) return [{ label: "(empty)", run: () => {}, enabled: () => false }];
    return list.map((r) => ({
      label: `${r.index + 1}  ${r.name}${r.folder ? `  (${r.folder})` : ""}`,
      run: () => void openFrom(() => backend.openRecent(r.index)),
    }));
  };

  const styleItems = (): MenuEntry[] =>
    BLOCK_STYLES.map((b) => ({
      label: b.label,
      keys: b.key ? [b.key] : undefined,
      run: () => run(cmd.setBlockStyle(b.style)),
      checked: () => cmd.currentBlockStyle(view.state) === b.style,
    }));

  const themeItems = (): MenuEntry[] =>
    PALETTES.map((p) => ({
      label: p.label,
      run: () => {
        setPalette(p.id);
        view.focus();
      },
      checked: () => currentPalette() === p.id,
    }));

  const menus: TopMenu[] = [
    {
      label: "File",
      key: "f",
      items: [A.newDocument, A.open, { kind: "sub", label: "Open recent", items: recentItems }, SEP, A.save, A.saveAs, A.autosave, { kind: "sub", label: "Export", items: exportItems }, SEP, A.print],
    },
    {
      label: "Edit",
      key: "e",
      items: [A.undo, A.redo, SEP, A.cut, A.copy, A.paste, A.pastePlain, A.selectAll, SEP, A.find, A.replace],
    },
    {
      label: "View",
      key: "v",
      items: [
        A.pageView,
        A.infiniteView,
        SEP,
        { kind: "sub", label: "Zoom", items: () => [A.zoomIn, A.zoomOut, A.zoomReset] },
        { kind: "sub", label: "Theme", items: themeItems },
        A.darkMode,
        SEP,
        A.options,
      ],
    },
    {
      label: "Format",
      key: "o",
      items: [
        A.bold,
        A.italic,
        A.underline,
        A.strike,
        SEP,
        { kind: "sub", label: "Paragraph style", items: styleItems },
        { kind: "sub", label: "Alignment", items: () => [A.alignLeft, A.alignCenter, A.alignRight, A.alignJustify] },
        A.bullets,
        A.numbers,
        A.indent,
        A.outdent,
        SEP,
        A.rule,
        A.clearFormatting,
        SEP,
        A.styles,
      ],
    },
    { label: "Help", key: "h", items: [A.shortcuts, SEP, A.about] },
  ];

  const menubar = buildMenubar(document.getElementById("menubar")!, menus);
  updateToolbar = buildToolbar(document.getElementById("toolbar")!, { actions: A, run, focus: () => view.focus(), exportItems, onThemeChange });

  // ---- global keys and browser behavior ----------------------------------------------------

  // Every action's keys work anywhere in the window. Inside the editor its own
  // keymap runs first and stops the event, so nothing runs twice.
  const bindings: Record<string, Command> = {};
  for (const a of Object.values(A) as Action[]) {
    for (const k of a.keys ?? []) {
      bindings[k] = () => {
        a.run();
        return true;
      };
    }
  }
  const handleKey = keydownHandler(bindings);

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || isModalOpen()) return;
    if (!IS_MAC && menubar.handleAltKey(e)) return e.preventDefault();
    // A webview reloads on F5 or Ctrl+R, which would throw away unsaved work.
    if (e.key === "F5" || ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "r")) e.preventDefault();
    if (handleKey(view, e)) e.preventDefault();
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
  setInfo(info);
  view.focus();
  void offerRecovery();
}
