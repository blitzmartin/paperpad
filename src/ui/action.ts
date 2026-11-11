// A user-facing action, shared by the menus, the toolbar and the keyboard.

import { keyLabel } from "./keys.ts";

export interface Action {
  label: string;
  /** Key bindings in ProseMirror notation ("Mod-b"). The first one is shown as the shortcut. */
  keys?: readonly string[];
  /** A shortcut that is shown but handled by the webview itself, such as "Mod-c". */
  hint?: string;
  run(): void;
  /** Greyed out unless this returns true. */
  enabled?(): boolean;
  /** Checked in menus, pressed in the toolbar. */
  checked?(): boolean;
  /** The toolbar hides the button unless this returns true. */
  visible?(): boolean;
}

export function shortcutText(a: Action): string {
  const key = a.keys?.[0] ?? a.hint;
  return key ? keyLabel(key) : "";
}
