// Per-machine preferences: the light or dark theme and the zoom level.
// Until the user picks a theme, PaperPad follows the operating system.

export type Theme = "light" | "dark";

// Storage can be unavailable (private mode, locked down profiles): then
// preferences simply last for this session.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* session only */
  }
}

// ---- theme ------------------------------------------------------------------------

const THEME_KEY = "paperpad.theme";
const listeners: (() => void)[] = [];
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemTheme = (): Theme => (media.matches ? "dark" : "light");

function storedTheme(): Theme | null {
  const v = load(THEME_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? systemTheme();
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  for (const l of listeners) l();
}

export function initTheme() {
  apply(storedTheme() ?? systemTheme());
  media.addEventListener("change", () => {
    if (!storedTheme()) apply(systemTheme());
  });
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  store(THEME_KEY, next);
  apply(next);
}

export function onThemeChange(fn: () => void) {
  listeners.push(fn);
}

// ---- zoom -------------------------------------------------------------------------

const ZOOM_KEY = "paperpad.zoom";
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function loadZoom(): number {
  const z = Number(load(ZOOM_KEY));
  return ZOOM_STEPS.includes(z) ? z : 1;
}

export function saveZoom(z: number) {
  store(ZOOM_KEY, String(z));
}
