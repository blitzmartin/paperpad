// Per-machine preferences: the color theme, light or dark mode and the zoom
// level. Until the user picks light or dark, PaperPad follows the system.

export type Theme = "light" | "dark";
/** "system" follows the operating system's light or dark setting. */
export type ThemeMode = Theme | "system";

// Storage can be unavailable (private mode, locked down profiles): then
// preferences simply last for this session.
export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* session only */
  }
}

// ---- theme ------------------------------------------------------------------------

/** Color themes. Each has a light and a dark version in main.css. */
export const PALETTES = [
  { id: "sage", label: "Sage" },
  { id: "gray", label: "Gray" },
  { id: "sand", label: "Sand" },
  { id: "slate", label: "Slate" },
  { id: "rose", label: "Rose" },
  { id: "lilac", label: "Lilac" },
] as const;
export type PaletteId = (typeof PALETTES)[number]["id"];

const THEME_KEY = "paperpad.theme";
const PALETTE_KEY = "paperpad.palette";
const listeners: (() => void)[] = [];
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemTheme = (): Theme => (media.matches ? "dark" : "light");

function storedTheme(): Theme | null {
  const v = loadPref(THEME_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? systemTheme();
}

export const themeMode = (): ThemeMode => storedTheme() ?? "system";

const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

export function currentPalette(): PaletteId {
  const v = document.documentElement.dataset.palette;
  return isPalette(v) ? v : "sage";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  for (const l of listeners) l();
}

function applyPalette(id: PaletteId) {
  document.documentElement.dataset.palette = id;
  for (const l of listeners) l();
}

export function initTheme() {
  const palette = loadPref(PALETTE_KEY);
  applyPalette(isPalette(palette) ? palette : "sage");
  apply(storedTheme() ?? systemTheme());
  media.addEventListener("change", () => {
    if (!storedTheme()) apply(systemTheme());
  });
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  storePref(THEME_KEY, next);
  apply(next);
}

export function setThemeMode(mode: ThemeMode) {
  storePref(THEME_KEY, mode);
  apply(mode === "system" ? systemTheme() : mode);
}

export function setPalette(id: PaletteId) {
  storePref(PALETTE_KEY, id);
  applyPalette(id);
}

export function onThemeChange(fn: () => void) {
  listeners.push(fn);
}

// ---- zoom -------------------------------------------------------------------------

const ZOOM_KEY = "paperpad.zoom";
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function loadZoom(): number {
  const z = Number(loadPref(ZOOM_KEY));
  return ZOOM_STEPS.includes(z) ? z : 1;
}

export function saveZoom(z: number) {
  storePref(ZOOM_KEY, String(z));
}
