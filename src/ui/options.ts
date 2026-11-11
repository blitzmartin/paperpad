// View > Options, in four tabs: Writing feel (caret presets, a preview line
// and the advanced caret settings), Text (default font and spelling), Saving
// (autosave and a note on crash recovery) and Appearance (color theme and
// light or dark mode). Changes apply live, except autosave which applies on
// OK; Cancel puts the old settings back.

import { type CaretPrefs, caretPrefs, setCaretPrefs } from "../editor/caret.ts";
import { findFont, type FontKey, FONTS, NEW_DOCUMENT_FONT } from "../editor/palette.ts";
import { createPreview } from "../editor/setup.ts";
import { h } from "./dom.ts";
import { showModal } from "./modal.ts";
import { currentPalette, loadPref, PALETTES, setPalette, setThemeMode, storePref, themeMode, type ThemeMode } from "./theme.ts";
import { languageName, parseSpellcheck, storedSpellcheck } from "./spelling.ts";
import { AUTOSAVE_INTERVALS, type AutosavePrefs, parseAutosave } from "./autosave.ts";
import { CHOICE_FIELDS, CHOICES, parsePrefs, PRESETS, type PresetId, presetOf } from "./writing-feel.ts";

const PREFS_KEY = "paperpad.caret";
const SPELL_KEY = "paperpad.spellcheck";
const FONT_KEY = "paperpad.font";
const ADVANCED_KEY = "paperpad.options.advanced";
const TAB_KEY = "paperpad.options.tab";
const AUTOSAVE_KEY = "paperpad.autosave";
const PREVIEW_TEXT = "Click here and type to try the caret. The quick brown fox jumps over the lazy dog.";

export function initWritingFeel() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setCaretPrefs(parsePrefs(loadPref(PREFS_KEY), reducedMotion));
}

/** The font key new documents start with. */
export const preferredFont = (): FontKey => findFont(loadPref(FONT_KEY))?.key ?? NEW_DOCUMENT_FONT;

// ---- spelling -----------------------------------------------------------------------

let editor: HTMLElement | null = null;

const applySpellcheck = (on: boolean) => {
  if (editor) editor.spellcheck = on;
};

/** Applies the stored spell check setting to the editor. Call once at startup. */
export function initSpelling(el: HTMLElement) {
  editor = el;
  applySpellcheck(parseSpellcheck(loadPref(SPELL_KEY)));
}

function spellingSection(initial: boolean) {
  const box = h("input", { type: "checkbox", id: "opt-spell" });
  box.checked = initial;
  box.addEventListener("change", () => applySpellcheck(box.checked));
  const language = languageName(navigator.language);
  const section = h(
    "fieldset",
    { class: "opt-group opt-stack" },
    h("legend", { text: "Spelling" }),
    h("label", { class: "opt-choice" }, box, " Check spelling as you type"),
    h("p", {
      class: "opt-note",
      text:
        `Spelling is checked in ${language}, the display language of Windows. ` +
        "Words in other languages are underlined as mistakes. " +
        "To check another language, change the Windows display language in Settings, Time and language.",
    }),
  );
  return { section, checked: () => box.checked };
}

// ---- default font -------------------------------------------------------------------

function fontSection(initial: string) {
  const select = h("select", { class: "field", id: "opt-font" });
  for (const f of FONTS) select.append(h("option", { value: f.key, text: f.label, class: `ff-${f.key}` }));
  select.value = initial;
  const sample = h("p", { class: `opt-font-sample ff-${initial}`, text: "The quick brown fox jumps over the lazy dog." });
  select.addEventListener("change", () => (sample.className = `opt-font-sample ff-${select.value}`));
  const section = h(
    "fieldset",
    { class: "opt-group opt-stack" },
    h("legend", { text: "Default font" }),
    h("div", { class: "opt-grid" }, h("label", { for: select.id, text: "Font for new documents" }), select),
    sample,
    h("p", {
      class: "opt-note",
      text: "The font is saved with each document, so it looks the same on any computer. Documents you already wrote keep their font. To change the font, sizes and spacing of headings, quotes and other parts of a document, use Format, Styles.",
    }),
  );
  return { section, value: () => select.value };
}

// ---- autosave -----------------------------------------------------------------------

let autosave: AutosavePrefs = parseAutosave(loadPref(AUTOSAVE_KEY));
const autosaveListeners: (() => void)[] = [];

export const autosavePrefs = (): AutosavePrefs => autosave;

/** Stores the autosave settings and tells the app to plan its next save again. */
export function setAutosavePrefs(p: AutosavePrefs) {
  autosave = { ...p };
  storePref(AUTOSAVE_KEY, JSON.stringify(autosave));
  for (const f of autosaveListeners) f();
}

export const onAutosaveChange = (f: () => void) => void autosaveListeners.push(f);

function autosaveSection(initial: AutosavePrefs) {
  const box = h("input", { type: "checkbox", id: "opt-autosave" });
  box.checked = initial.on;
  const select = h("select", { class: "field", id: "opt-autosave-time" });
  for (const [s, text] of AUTOSAVE_INTERVALS) select.append(h("option", { value: String(s), text }));
  select.value = String(initial.seconds);
  const sync = () => (select.disabled = !box.checked);
  box.addEventListener("change", sync);
  sync();
  const section = h(
    "fieldset",
    { class: "opt-group opt-stack" },
    h("legend", { text: "Autosave" }),
    h("label", { class: "opt-choice" }, box, " Save my documents automatically"),
    h("div", { class: "opt-grid" }, h("label", { for: select.id, text: "Save changes after" }), select),
    h("p", {
      class: "opt-note",
      text:
        "Autosave starts once a document is saved as a PaperPad file. " +
        "Text and Markdown files are only saved when you choose Save, because they keep no formatting. " +
        "PaperPad also saves when you switch to another window.",
    }),
  );
  return { section, value: (): AutosavePrefs => ({ on: box.checked, seconds: Number(select.value) }) };
}

function recoverySection() {
  return h(
    "fieldset",
    { class: "opt-group opt-stack" },
    h("legend", { text: "Crash recovery" }),
    h("p", {
      class: "opt-note",
      text:
        "With or without autosave, PaperPad keeps a copy of unsaved work every 15 seconds in its own data folder. " +
        "If it closes unexpectedly, it offers to restore that copy the next time it starts.",
    }),
  );
}

// ---- appearance ---------------------------------------------------------------------

const MODES: [ThemeMode, string][] = [
  ["system", "Same as the system"],
  ["light", "Light"],
  ["dark", "Dark"],
];

function appearanceSection() {
  const themes = PALETTES.map((p) => {
    const input = h("input", { type: "radio", name: "opt-palette", value: p.id });
    input.checked = p.id === currentPalette();
    input.addEventListener("change", () => setPalette(p.id));
    // Swatches of the theme's desk, chrome, paper and accent, in its light version.
    const swatch = h("span", { class: `theme-swatch tsw-${p.id}`, "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
    return h("label", { class: "opt-choice theme-choice" }, input, swatch, ` ${p.label}`);
  });
  const modes = MODES.map(([mode, label]) => {
    const input = h("input", { type: "radio", name: "opt-mode", value: mode });
    input.checked = mode === themeMode();
    input.addEventListener("change", () => setThemeMode(mode));
    return h("label", { class: "opt-choice" }, input, ` ${label}`);
  });
  return h(
    "div",
    { class: "options" },
    h("fieldset", { class: "opt-group opt-themes" }, h("legend", { text: "Theme" }), ...themes),
    h("fieldset", { class: "opt-group opt-row" }, h("legend", { text: "Light or dark" }), ...modes),
    h("p", { class: "opt-note", text: "Every theme has a light and a dark version. Documents always print on white paper." }),
  );
}

// ---- tabs ---------------------------------------------------------------------------

type TabId = "feel" | "text" | "saving" | "appearance";
const TABS: [TabId, string][] = [
  ["feel", "Writing feel"],
  ["text", "Text"],
  ["saving", "Saving"],
  ["appearance", "Appearance"],
];

function tabbed(panels: Record<TabId, HTMLElement>) {
  const stored = loadPref(TAB_KEY);
  let current: TabId = TABS.some(([id]) => id === stored) ? (stored as TabId) : "feel";
  const tabs = TABS.map(([id, label]) =>
    h("button", { class: "tab", type: "button", role: "tab", id: `opt-tab-${id}`, "aria-controls": `opt-panel-${id}`, text: label }),
  );
  const select = (i: number, focus = false) => {
    current = TABS[i]![0];
    storePref(TAB_KEY, current);
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(i === j));
      t.tabIndex = i === j ? 0 : -1;
    });
    TABS.forEach(([id], j) => (panels[id].hidden = i !== j));
    if (focus) tabs[i]!.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      select((i + step + tabs.length) % tabs.length, true);
    });
  });
  TABS.forEach(([id]) => {
    const panel = panels[id];
    panel.id = `opt-panel-${id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `opt-tab-${id}`);
    panel.classList.add("tab-panel");
  });
  select(TABS.findIndex(([id]) => id === current));
  return h(
    "div",
    { class: "tabbed" },
    h("div", { class: "tab-strip", role: "tablist", "aria-label": "Options" }, ...tabs),
    h("div", { class: "tab-body" }, ...TABS.map(([id]) => panels[id])),
  );
}

// ---- the dialog ---------------------------------------------------------------------

export interface OptionsResult {
  /** The default font changed (a font key). */
  fontChanged?: string;
}

export async function openOptions(): Promise<OptionsResult> {
  const saved = caretPrefs();
  const draft: CaretPrefs = { ...saved };
  const spellSaved = parseSpellcheck(loadPref(SPELL_KEY));
  const spelling = spellingSection(spellSaved);
  const fontSaved = preferredFont();
  const font = fontSection(fontSaved);
  const paletteSaved = currentPalette();
  const modeSaved = themeMode();
  const saving = autosaveSection(autosave);

  const radios = new Map<PresetId | "custom", HTMLInputElement>();
  const choice = (id: PresetId | "custom", label: string) => {
    const input = h("input", { type: "radio", name: "writing-feel", value: id });
    radios.set(id, input);
    input.addEventListener("change", () => {
      if (id !== "custom") Object.assign(draft, PRESETS[id].prefs);
      sync();
    });
    return h("label", { class: "opt-choice" }, input, ` ${label}`);
  };
  const presets = (Object.keys(PRESETS) as PresetId[]).map((id) => choice(id, PRESETS[id].label));
  // Only shown when the advanced settings match no preset.
  const custom = choice("custom", "Custom");

  const selects = CHOICE_FIELDS.map((f) => {
    const select = h("select", { class: "field", id: `opt-${f}` });
    for (const [value, text] of CHOICES[f].options) select.append(h("option", { value, text }));
    select.addEventListener("change", () => {
      (draft as Record<typeof f, string>)[f] = select.value;
      sync();
    });
    return [f, select] as const;
  });
  const scroll = h("input", { type: "checkbox", id: "opt-scroll" });
  scroll.addEventListener("change", () => {
    draft.smoothScroll = scroll.checked;
    sync();
  });

  function sync() {
    for (const [f, select] of selects) select.value = draft[f];
    scroll.checked = draft.smoothScroll;
    const id = presetOf(draft) ?? "custom";
    radios.get(id)!.checked = true;
    custom.hidden = id !== "custom";
    setCaretPrefs(draft);
  }

  const well = h("div", { class: "preview-well" });
  const preview = createPreview(well, PREVIEW_TEXT);

  const advanced = h(
    "details",
    { class: "opt-advanced", open: loadPref(ADVANCED_KEY) === "open" },
    h("summary", { text: "Advanced" }),
    h(
      "div",
      { class: "opt-grid" },
      ...selects.flatMap(([f, select]) => [h("label", { for: select.id, text: CHOICES[f].label }), select]),
      h("label", { for: scroll.id, text: "Smooth scrolling" }),
      h("div", {}, scroll),
    ),
  );
  advanced.addEventListener("toggle", () => storePref(ADVANCED_KEY, advanced.open ? "open" : "closed"));

  const body = tabbed({
    feel: h(
      "div",
      { class: "options" },
      h("fieldset", { class: "opt-group opt-row" }, h("legend", { text: "Caret" }), ...presets, custom),
      well,
      advanced,
    ),
    text: h("div", { class: "options" }, font.section, spelling.section),
    saving: h("div", { class: "options" }, saving.section, recoverySection()),
    appearance: appearanceSection(),
  });

  sync();
  const result = await showModal({
    title: "Options",
    body,
    buttons: [
      { id: "ok", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
    ],
    cancelId: "cancel",
  });
  preview.destroy();
  if (result === "ok") {
    storePref(PREFS_KEY, JSON.stringify(draft));
    storePref(SPELL_KEY, storedSpellcheck(spelling.checked()));
    storePref(FONT_KEY, font.value());
    setAutosavePrefs(saving.value());
    return font.value() !== fontSaved ? { fontChanged: font.value() } : {};
  }
  setCaretPrefs(saved);
  applySpellcheck(spellSaved);
  if (currentPalette() !== paletteSaved) setPalette(paletteSaved);
  if (themeMode() !== modeSaved) setThemeMode(modeSaved);
  return {};
}
