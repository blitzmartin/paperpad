// Platform modifier names and readable shortcut labels.

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_LABEL = IS_MAC ? "Cmd" : "Ctrl";

/** Turns a ProseMirror key name such as "Shift-Mod-x" into a label such as "Ctrl+Shift+X". */
export function keyLabel(key: string): string {
  const parts = key.split(/-(?!$)/);
  const base = parts.pop()!;
  const mods = ["Mod", "Alt", "Shift"].filter((m) => parts.includes(m)).map((m) => (m === "Mod" ? MOD_LABEL : m));
  return [...mods, base.length === 1 ? base.toUpperCase() : base].join("+");
}
