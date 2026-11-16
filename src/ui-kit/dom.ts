// Tiny DOM helpers. Text is always set through textContent, never innerHTML.

type Child = Node | string | null | undefined | false;
type Handlers = Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
interface Props {
  on?: Handlers;
  [attr: string]: string | boolean | number | undefined | Handlers;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "on" || v === undefined || v === false || typeof v === "object") continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  if (props.on) for (const [ev, fn] of Object.entries(props.on)) el.addEventListener(ev, fn as EventListener);
  for (const c of children) if (c) el.append(c);
  return el;
}

/**
 * Closes a floating element on outside click or Escape. Returns a disposer.
 * `except` can be a function, read on each click, for elements that appear
 * later (like submenus).
 */
export function dismissable(el: HTMLElement, close: () => void, except: HTMLElement[] | (() => HTMLElement[]) = []): () => void {
  const onDown = (e: MouseEvent) => {
    const t = e.target as Node;
    const inside = typeof except === "function" ? except() : except;
    if (!el.contains(t) && !inside.some((x) => x.contains(t))) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  // Defer so the click that opened the popup does not close it.
  const timer = setTimeout(() => document.addEventListener("mousedown", onDown, true));
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", close);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
  };
}

/** Places a popup under an anchor, kept inside the window. Uses CSSOM, which the CSP allows. */
export function placeBelow(popup: HTMLElement, anchor: HTMLElement, side: "below" | "right" = "below") {
  const r = anchor.getBoundingClientRect();
  popup.style.position = "fixed";
  popup.style.visibility = "hidden";
  document.body.append(popup);
  const p = popup.getBoundingClientRect();
  let left = side === "below" ? r.left : r.right - 2;
  let top = side === "below" ? r.bottom : r.top - 3;
  if (left + p.width > window.innerWidth - 4) left = side === "below" ? window.innerWidth - p.width - 4 : r.left - p.width + 2;
  if (top + p.height > window.innerHeight - 4) top = Math.max(4, window.innerHeight - p.height - 4);
  popup.style.left = `${Math.max(4, left)}px`;
  popup.style.top = `${top}px`;
  popup.style.visibility = "";
}
