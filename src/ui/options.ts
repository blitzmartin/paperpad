// View > Options: the writing feel presets, a preview line and the advanced
// caret settings. Changes apply live; Cancel puts the old settings back.

import { type CaretPrefs, caretPrefs, setCaretPrefs } from "../editor/caret.ts";
import { createPreview } from "../editor/setup.ts";
import { h } from "./dom.ts";
import { showModal } from "./modal.ts";
import { loadPref, storePref } from "./theme.ts";
import { CHOICE_FIELDS, CHOICES, parsePrefs, PRESETS, type PresetId, presetOf } from "./writing-feel.ts";

const PREFS_KEY = "paperpad.caret";
const ADVANCED_KEY = "paperpad.options.advanced";
const PREVIEW_TEXT = "Click here and type to try the caret. The quick brown fox jumps over the lazy dog.";

export function initWritingFeel() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setCaretPrefs(parsePrefs(loadPref(PREFS_KEY), reducedMotion));
}

export async function openOptions(): Promise<void> {
  const saved = caretPrefs();
  const draft: CaretPrefs = { ...saved };

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

  const body = h(
    "div",
    { class: "options" },
    h("fieldset", { class: "opt-presets" }, h("legend", { text: "Writing feel" }), ...presets, custom),
    well,
    advanced,
  );

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
  if (result === "ok") storePref(PREFS_KEY, JSON.stringify(draft));
  else setCaretPrefs(saved);
}
