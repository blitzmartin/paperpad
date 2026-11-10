// Light and dark themes. The choice is remembered per machine; until the
// user picks one, PaperPad follows the operating system.

export type Theme = "light" | "dark";

const KEY = "paperpad.theme";
const listeners: (() => void)[] = [];
const media = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? (media.matches ? "dark" : "light");
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  for (const l of listeners) l();
}

export function initTheme() {
  apply(stored() ?? (media.matches ? "dark" : "light"));
  media.addEventListener("change", () => {
    if (!stored()) apply(media.matches ? "dark" : "light");
  });
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
  apply(next);
}

export function onThemeChange(fn: () => void) {
  listeners.push(fn);
}

// ---- zoom (also a per-machine preference) ---------------------------------------

const ZOOM_KEY = "paperpad.zoom";
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function loadZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}

export function saveZoom(z: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    /* ignore */
  }
}
