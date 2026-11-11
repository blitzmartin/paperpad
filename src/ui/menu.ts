// Classic menu bar and dropdown menus with keyboard navigation.

import { type Action, shortcutText } from "./action.ts";
import { dismissable, h, placeBelow } from "./dom.ts";

export type MenuEntry =
  | (Action & { kind?: "item" })
  | { kind: "sub"; label: string; items: () => MenuEntry[] | Promise<MenuEntry[]> }
  | { kind: "sep" };

export const SEP: MenuEntry = { kind: "sep" };

export interface TopMenu {
  label: string;
  /** Letter underlined and reachable with Alt+letter. */
  key: string;
  items: MenuEntry[];
}

interface OpenMenu {
  el: HTMLElement;
  close: () => void;
}

let stack: OpenMenu[] = [];

export function closeAllMenus() {
  for (const m of [...stack].reverse()) m.close();
  stack = [];
}

export async function openMenu(
  anchor: HTMLElement,
  entries: MenuEntry[] | Promise<MenuEntry[]>,
  opts: { side?: "below" | "right"; onLeft?: () => void; onRight?: () => void; onClose?: () => void; focusFirst?: boolean } = {},
): Promise<OpenMenu> {
  const list = await entries;
  const el = h("div", { class: "window menu", role: "menu" });
  const items: HTMLButtonElement[] = [];
  let sub: OpenMenu | null = null;
  /** The entry whose submenu is open or opening. */
  let subOwner: HTMLElement | null = null;

  const closeSub = () => {
    sub?.close();
    sub = null;
    subOwner = null;
  };

  for (const entry of list) {
    if (entry.kind === "sep") {
      el.append(h("div", { class: "menu-sep", role: "separator" }));
      continue;
    }
    if (entry.kind === "sub") {
      const btn = h("button", { class: "menu-item has-sub", type: "button", role: "menuitem", "aria-haspopup": "true" }, h("span", { class: "check" }), h("span", { class: "label", text: entry.label }), h("span", { class: "shortcut", text: "▸" }));
      // Moving from one submenu entry to another swaps the open submenu.
      const openSub = async (focus: boolean) => {
        if (subOwner === btn) {
          if (focus) sub?.el.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus();
          return;
        }
        closeSub();
        subOwner = btn;
        const opened = await openMenu(btn, entry.items(), { side: "right", focusFirst: focus, onLeft: () => { closeSub(); btn.focus(); } });
        // The pointer moved on while the items were loading (Open recent asks the backend).
        if (subOwner !== btn) return opened.close();
        sub = opened;
      };
      btn.addEventListener("mouseenter", () => void openSub(false));
      btn.addEventListener("click", () => void openSub(true));
      btn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          void openSub(true);
        }
      });
      items.push(btn);
      el.append(btn);
      continue;
    }
    const enabled = entry.enabled ? entry.enabled() : true;
    const checked = entry.checked?.();
    const btn = h(
      "button",
      { class: "menu-item", type: "button", role: checked === undefined ? "menuitem" : "menuitemcheckbox", "aria-checked": checked === undefined ? undefined : String(checked), disabled: !enabled },
      h("span", { class: "check", text: checked ? "✓" : "" }),
      h("span", { class: "label", text: entry.label }),
      h("span", { class: "shortcut", text: shortcutText(entry) }),
    );
    btn.addEventListener("mouseenter", closeSub);
    btn.addEventListener("click", () => {
      closeAllMenus();
      entry.run();
    });
    items.push(btn);
    el.append(btn);
  }

  el.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (d: number) => {
      for (let k = 1; k <= items.length; k++) {
        const next = items[(i + d * k + items.length * k) % items.length];
        if (next && !next.disabled) return next.focus();
      }
    };
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "ArrowLeft") opts.onLeft?.();
    else if (e.key === "ArrowRight") opts.onRight?.();
    else if (e.key === "Home") items.find((b) => !b.disabled)?.focus();
    else if (e.key === "End") [...items].reverse().find((b) => !b.disabled)?.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  placeBelow(el, anchor, opts.side ?? "below");
  let undismiss = () => {};
  const menu: OpenMenu = {
    el,
    close: () => {
      closeSub();
      undismiss();
      el.remove();
      stack = stack.filter((m) => m !== menu);
      opts.onClose?.();
    },
  };
  // Only the root menu listens for outside clicks; it closes the whole stack.
  // The stack is read on each click: submenus open after this menu, and a
  // click in one of them is not an outside click.
  if (!stack.length) undismiss = dismissable(el, closeAllMenus, () => [anchor, ...stack.map((m) => m.el)]);
  stack.push(menu);
  if (opts.focusFirst !== false) items.find((b) => !b.disabled)?.focus();
  return menu;
}

export function buildMenubar(bar: HTMLElement, menus: TopMenu[]) {
  const buttons: HTMLButtonElement[] = [];
  let current = -1;

  const openAt = async (i: number, focusFirst = true) => {
    closeAllMenus();
    current = i;
    const btn = buttons[i]!;
    btn.classList.add("open");
    await openMenu(btn, menus[i]!.items, {
      focusFirst,
      onLeft: () => void openAt((i - 1 + menus.length) % menus.length),
      onRight: () => void openAt((i + 1) % menus.length),
      onClose: () => {
        btn.classList.remove("open");
        if (current === i) current = -1;
      },
    });
  };

  menus.forEach((m, i) => {
    const idx = m.label.toLowerCase().indexOf(m.key.toLowerCase());
    const label = h("span", {}, m.label.slice(0, idx), h("u", { text: m.label[idx] }), m.label.slice(idx + 1));
    const btn = h("button", { class: "menubar-item", type: "button", role: "menuitem", "aria-haspopup": "true" }, label);
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep the editor selection
      if (current === i) closeAllMenus();
      else void openAt(i);
    });
    btn.addEventListener("mouseenter", () => {
      if (current !== -1 && current !== i) void openAt(i, false);
    });
    buttons.push(btn);
    bar.append(btn);
  });

  return {
    /** Alt+letter opens the matching menu, as in classic Windows apps. */
    handleAltKey(e: KeyboardEvent): boolean {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
      const i = menus.findIndex((m) => e.code === `Key${m.key.toUpperCase()}`);
      if (i < 0) return false;
      void openAt(i);
      return true;
    },
  };
}
