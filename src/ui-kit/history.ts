// Version history settings and text. Pure data, no DOM.
//
// Every save also writes a copy to the version archive in PaperPad's data
// folder (src-tauri/src/archive.rs). The setting is how many copies of each
// document are kept; the oldest are deleted first.

export const HISTORY_KEEP_CHOICES: [number, string][] = [
  [20, "20 versions"],
  [50, "50 versions"],
  [100, "100 versions"],
];

export const DEFAULT_HISTORY_KEEP = 50;

/** Reads a stored value, keeping only known choices. */
export function parseHistoryKeep(raw: string | null): number {
  const n = Number(raw);
  return HISTORY_KEEP_CHOICES.some(([v]) => v === n) ? n : DEFAULT_HISTORY_KEEP;
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
