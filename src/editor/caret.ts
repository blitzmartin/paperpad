// A drawn caret that glides between positions, and optional smooth scrolling.
//
// The browser's own caret cannot be animated, so when a smooth setting is on
// it is made transparent and this one is placed over the text with
// coordsAtPos. It lives in the editor's positioned scroll container, so it
// scrolls with the text and needs no zoom math. Selections, IME composition
// and an unfocused editor fall back to the native behavior.

import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export type CaretMovement = "instant" | "smooth" | "smoother";
export type CaretBlink = "blink" | "fade" | "steady";
export type CaretShape = "line" | "thick" | "underscore";

export interface CaretPrefs {
  movement: CaretMovement;
  blink: CaretBlink;
  shape: CaretShape;
  smoothScroll: boolean;
}

const MOVE_MS: Record<CaretMovement, number> = { instant: 0, smooth: 60, smoother: 120 };
/** The caret stays solid while you type and starts blinking after this pause. */
const IDLE_MS = 500;
/** Room kept between the caret and the window edge when scrolling. */
const SCROLL_MARGIN = 40;
const EVENTS = ["focus", "blur", "compositionstart", "compositionend"] as const;

let prefs: CaretPrefs = { movement: "instant", blink: "blink", shape: "line", smoothScroll: false };
const live = new Set<DrawnCaret>();

export const caretPrefs = (): CaretPrefs => ({ ...prefs });

export function setCaretPrefs(next: CaretPrefs) {
  prefs = { ...next };
  for (const c of live) c.restyle();
}

/** These settings look like the browser's caret, so nothing is drawn. */
const isNative = (p: CaretPrefs) => p.movement === "instant" && p.blink === "blink" && p.shape === "line";

/** The positioned element the caret is drawn in (the workspace in the app). */
const hostOf = (view: EditorView) => (view.dom as HTMLElement).offsetParent as HTMLElement | null;

class DrawnCaret {
  private readonly el = document.createElement("div");
  private readonly observer = new ResizeObserver(() => this.schedule());
  private frame = 0;
  private idleTimer = 0;
  private shown = false;
  private composing = false;
  private last = "";

  private readonly onEvent = (e: Event) => {
    if (e.type === "compositionstart") this.composing = true;
    if (e.type === "compositionend") this.composing = false;
    this.schedule();
  };

  private readonly view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.el.setAttribute("aria-hidden", "true");
    for (const t of EVENTS) view.dom.addEventListener(t, this.onEvent);
    window.addEventListener("resize", this.onEvent);
    this.observer.observe(view.dom);
    live.add(this);
    this.restyle();
  }

  restyle() {
    // CSSOM writes are allowed by the CSP (only style attributes in markup are not).
    this.el.className = `pm-caret shape-${prefs.shape} blink-${prefs.blink}`;
    this.el.style.setProperty("--caret-move", `${MOVE_MS[prefs.movement]}ms`);
    this.wake();
    this.schedule();
  }

  update() {
    this.schedule();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.idleTimer);
    this.observer.disconnect();
    for (const t of EVENTS) this.view.dom.removeEventListener(t, this.onEvent);
    window.removeEventListener("resize", this.onEvent);
    this.view.dom.classList.remove("drawn-caret");
    this.el.remove();
    live.delete(this);
  }

  private schedule() {
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Solid now, blinking again after a pause. */
  private wake() {
    this.el.classList.remove("idle");
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.el.classList.add("idle"), IDLE_MS);
  }

  private draw() {
    const { view, el } = this;
    const drawn = !isNative(prefs) && !this.composing;
    view.dom.classList.toggle("drawn-caret", drawn);
    const sel = view.state.selection;
    const host = hostOf(view);
    if (!drawn || !host || !view.hasFocus() || !sel.empty || !(sel instanceof TextSelection)) {
      el.remove();
      this.shown = false;
      return;
    }
    const r = view.coordsAtPos(sel.head);
    const box = host.getBoundingClientRect();
    const x = r.left - box.left - host.clientLeft + host.scrollLeft;
    const y = r.top - box.top - host.clientTop + host.scrollTop;
    const height = r.bottom - r.top;
    // Appearing (after a click, a selection or focus) jumps; only moves glide.
    el.classList.toggle("jump", !this.shown);
    if (el.parentNode !== host) host.append(el);
    el.style.setProperty("--h", `${height}px`);
    el.style.transform = `translate(${x}px, ${y}px)`;
    if (!this.shown) {
      void el.offsetWidth; // apply the jump before transitions come back
      el.classList.remove("jump");
      this.shown = true;
    }
    const key = `${x},${y},${height}`;
    if (key !== this.last) {
      this.last = key;
      this.wake();
    }
  }
}

/** Scrolls the caret into view with a glide instead of a jump. */
function glideIntoView(view: EditorView): boolean {
  const host = hostOf(view);
  if (!host || host.scrollHeight <= host.clientHeight) return false;
  const r = view.coordsAtPos(view.state.selection.head);
  const top = host.getBoundingClientRect().top + host.clientTop;
  const above = r.top - SCROLL_MARGIN - top;
  const below = r.bottom + SCROLL_MARGIN - (top + host.clientHeight);
  const dy = above < 0 ? above : below > 0 ? below : 0;
  if (dy) host.scrollBy({ top: dy, behavior: "smooth" });
  return true;
}

export const caretPlugin = new Plugin({
  view: (view) => new DrawnCaret(view),
  props: {
    handleScrollToSelection: (view) => prefs.smoothScroll && glideIntoView(view),
  },
});
