// Autosave settings. Pure data, no DOM.
//
// Autosave writes a document a set time after its first unsaved change, and
// when the window loses focus. It only writes PaperPad documents (.html) that
// already have a file: plain text and Markdown keep no formatting, so writing
// them silently could lose work. Crash recovery still covers everything else.

export interface AutosavePrefs {
  on: boolean;
  /** Seconds between the first unsaved change and the save. */
  seconds: number;
}

export const AUTOSAVE_INTERVALS: [number, string][] = [
  [10, "10 seconds"],
  [30, "30 seconds"],
  [60, "1 minute"],
  [120, "2 minutes"],
  [300, "5 minutes"],
  [600, "10 minutes"],
];

export const DEFAULT_AUTOSAVE: AutosavePrefs = { on: false, seconds: 30 };

/** Reads stored settings, keeping only known values. */
export function parseAutosave(raw: string | null): AutosavePrefs {
  const out = { ...DEFAULT_AUTOSAVE };
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return out;
  }
  if (!v || typeof v !== "object") return out;
  const { on, seconds } = v as Record<string, unknown>;
  if (typeof on === "boolean") out.on = on;
  if (AUTOSAVE_INTERVALS.some(([s]) => s === seconds)) out.seconds = seconds as number;
  return out;
}
