// Writing feel presets and the choices behind them. Pure data, no DOM.

import type { CaretPrefs } from "../editor/caret.ts";

export type PresetId = "classic" | "smooth" | "calm";
export type ChoiceField = "movement" | "blink" | "shape";

export const PRESETS: Record<PresetId, { label: string; prefs: CaretPrefs }> = {
  classic: { label: "Classic", prefs: { movement: "instant", blink: "blink", shape: "line", smoothScroll: false } },
  smooth: { label: "Smooth", prefs: { movement: "smooth", blink: "fade", shape: "line", smoothScroll: true } },
  calm: { label: "Calm", prefs: { movement: "smoother", blink: "steady", shape: "thick", smoothScroll: true } },
};

export const CHOICES: { [K in ChoiceField]: { label: string; options: [CaretPrefs[K], string][] } } = {
  movement: { label: "Caret movement", options: [["instant", "Instant"], ["smooth", "Smooth"], ["smoother", "Smoother"]] },
  blink: { label: "Caret blink", options: [["blink", "Blink"], ["fade", "Fade"], ["steady", "Steady"]] },
  shape: { label: "Caret shape", options: [["line", "Thin line"], ["thick", "Thick line"], ["underscore", "Retro underscore"]] },
};

export const CHOICE_FIELDS = Object.keys(CHOICES) as ChoiceField[];

/** The preset these settings match, or null when they are custom. */
export function presetOf(p: CaretPrefs): PresetId | null {
  const match = (q: CaretPrefs) => CHOICE_FIELDS.every((f) => p[f] === q[f]) && p.smoothScroll === q.smoothScroll;
  return (Object.keys(PRESETS) as PresetId[]).find((id) => match(PRESETS[id].prefs)) ?? null;
}

/** Reads stored settings, keeping only known values. Reduced motion defaults to Classic. */
export function parsePrefs(raw: string | null, reducedMotion: boolean): CaretPrefs {
  const out = { ...PRESETS[reducedMotion ? "classic" : "smooth"].prefs };
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw ?? "") as Record<string, unknown>;
  } catch {
    return out;
  }
  if (typeof v !== "object" || v === null) return out;
  for (const f of CHOICE_FIELDS) {
    const option = CHOICES[f].options.find(([id]) => id === v[f]);
    if (option) (out as Record<ChoiceField, string>)[f] = option[0];
  }
  if (typeof v.smoothScroll === "boolean") out.smoothScroll = v.smoothScroll;
  return out;
}
