// Page view: the document shown as A4 sheets, like a classic word processor.
//
// The document stays one flowing editor. Behind it a column of sheets is
// drawn (a grid cell shared with the editor, see .page.paged in main.css).
// Where a page fills up, an invisible spacer is inserted as a widget
// decoration. It pushes the rest of the text down to the next sheet. Breaks
// fall between blocks or between two lines of a paragraph, and keep at least
// two lines of a paragraph together on each side, as print does.
//
// Layout runs once per frame after a change:
// 1. Hide the spacers and measure the plain flow to choose the breaks.
// 2. Show the spacers at the new breaks.
// 3. Read where each spacer starts and size them so every page begins at
//    its top margin. Spacers shift the text below them rigidly, so one read
//    and one write fit all of them (see fitGapHeights).
// The document itself never changes, so undo, saving and export ignore it.

import type { Node as PMNode } from "prosemirror-model";
import { type Command, type EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

// Geometry in CSS pixels of the unzoomed page. Must match .page.paged in main.css.
const CM = 96 / 2.54;
export const PAGE_W = 21 * CM;
export const PAGE_H = 29.7 * CM;
export const MARGIN = 2 * CM;
export const GAP = 24;
const CONTENT_H = PAGE_H - 2 * MARGIN;
/** Slack for rounding, so a line that exactly fits stays on its page. */
const EPS = 0.5;

interface Break {
  pos: number;
  /** "line" splits a textblock between two lines; "block" goes between blocks. */
  kind: "line" | "block";
}

const key = new PluginKey<DecorationSet>("pages");

let paged = false;
const live = new Set<PageLayout>();

export const pageViewOn = (): boolean => paged;

/** Switches between page view and infinite view. */
export function setPageView(on: boolean) {
  paged = on;
  for (const l of live) l.setMode();
}

/** Lays the pages out again, after zoom or font changes. */
export function relayoutPages() {
  for (const l of live) l.schedule();
}

/** The page the caret is on and the page count, or null in infinite view. */
export function pageInfo(state: EditorState): { page: number; pages: number } | null {
  const set = key.getState(state);
  if (!paged || !set) return null;
  return { page: set.find(0, state.selection.head).length + 1, pages: set.find().length + 1 };
}

/**
 * Up and Down across a page break. The browser's own vertical movement gets
 * lost on a spacer inside a paragraph (it skips a line or stops beside the
 * spacer), so on the line next to a spacer the caret jumps over it here.
 */
export const arrowOverBreak =
  (dir: "up" | "down"): Command =>
  (state, dispatch, view) => {
    if (!paged || !view || !state.selection.empty) return false;
    const c = view.coordsAtPos(state.selection.head);
    const half = (c.bottom - c.top) / 2;
    let y: number | null = null;
    for (const gap of view.dom.querySelectorAll(".pp-gap")) {
      const r = gap.getBoundingClientRect();
      // The line box starts a little above the glyphs, hence the tolerance.
      if (dir === "down" && Math.abs(r.top - c.bottom) < 6) y = r.bottom + half;
      if (dir === "up" && Math.abs(r.bottom - c.top) < 6) y = r.top - half;
      if (y !== null) break;
    }
    if (y === null) return false;
    const hit = view.posAtCoords({ left: c.left, top: y });
    if (!hit) return false;
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, hit.pos)).scrollIntoView());
    return true;
  };

// ---- pure helpers (tested) ----------------------------------------------------

/**
 * Where a break before the block at pos really goes: before the outermost
 * block that starts there. A break before the first paragraph of a list goes
 * before the list, so the bullet stays with its text.
 */
export function blockBreakPos(doc: PMNode, pos: number): number {
  const $p = doc.resolve(pos);
  let d = $p.depth;
  while (d > 0 && $p.index(d) === 0) d--;
  return d === $p.depth ? pos : $p.before(d + 1);
}

/**
 * New spacer heights so that spacer i ends at targets[i]. bottoms are where
 * the spacers end now. Growing spacer i moves every spacer after it by the
 * same amount, so each one only corrects what the ones above did not.
 */
export function fitGapHeights(heights: number[], bottoms: number[], targets: number[]): number[] {
  let shift = 0;
  return heights.map((h, i) => {
    const d = targets[i]! - bottoms[i]! - shift;
    shift += d;
    return Math.max(0, h + d);
  });
}

/** Where spacer i must end: the top margin of page i + 2. */
export const gapTarget = (i: number): number => (i + 1) * (PAGE_H + GAP) + MARGIN;

// ---- the plugin -------------------------------------------------------------------

function gapWidget(b: Break, i: number): Decoration {
  return Decoration.widget(
    b.pos,
    () => {
      const el = document.createElement(b.kind === "line" ? "span" : "div");
      el.className = `pp-gap pp-gap-${b.kind}`;
      el.setAttribute("aria-hidden", "true");
      return el;
    },
    // The caret at the break belongs to the next page, after the spacer.
    { side: -1, key: `pp-${i}-${b.kind}-${b.pos}`, ignoreSelection: true },
  );
}

export const pagesPlugin = new Plugin<DecorationSet>({
  key,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const breaks = tr.getMeta(key) as Break[] | undefined;
      if (breaks) return DecorationSet.create(tr.doc, breaks.map(gapWidget));
      return set.map(tr.mapping, tr.doc);
    },
  },
  props: { decorations: (state) => key.getState(state) },
  view: (view) => new PageLayout(view),
});

class PageLayout {
  private readonly view: EditorView;
  private readonly sheets = document.createElement("div");
  private frame = 0;
  private breaks: Break[] = [];

  constructor(view: EditorView) {
    this.view = view;
    this.sheets.className = "pp-sheets";
    this.sheets.setAttribute("aria-hidden", "true");
    view.dom.before(this.sheets);
    view.dom.addEventListener("compositionend", this.relayout);
    // An image may only get its final height once it has loaded. Load does not bubble, hence capture.
    view.dom.addEventListener("load", this.relayout, true);
    live.add(this);
    this.setMode();
  }

  private readonly relayout = () => this.schedule();

  /** The element that holds the sheets and the editor (#page in the app). */
  private get page(): HTMLElement {
    return this.view.dom.parentElement!;
  }

  setMode() {
    this.page.classList.toggle("paged", paged);
    this.schedule();
  }

  update(view: EditorView, prev: EditorState) {
    // Turning page numbers on or off is a document change too, so it lands here.
    if (view.state.doc !== prev.doc) this.schedule();
  }

  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.layout());
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.dom.removeEventListener("compositionend", this.relayout);
    this.view.dom.removeEventListener("load", this.relayout, true);
    this.sheets.remove();
    live.delete(this);
  }

  private layout() {
    this.frame = 0;
    // Redrawing widgets during IME composition would break it. Wait for the end.
    if (this.view.composing) return;
    const breaks = paged ? this.measureBreaks() : [];
    const same = breaks.length === this.breaks.length && breaks.every((b, i) => b.pos === this.breaks[i]!.pos && b.kind === this.breaks[i]!.kind);
    if (!same) {
      this.breaks = breaks;
      this.view.dispatch(this.view.state.tr.setMeta(key, breaks).setMeta("addToHistory", false));
    }
    if (paged) this.fitGaps();
    this.drawSheets();
  }

  /** Converts a viewport y to page pixels: from the top of the first sheet, unzoomed. */
  private toPage(): (y: number) => number {
    const r = this.page.getBoundingClientRect();
    const scale = r.width / PAGE_W || 1;
    return (y) => (y - r.top) / scale;
  }

  private measureBreaks(): Break[] {
    const { view } = this;
    const dom = view.dom as HTMLElement;
    dom.classList.add("pp-measuring");
    try {
      const y = this.toPage();
      const blocks: { pos: number; node: PMNode }[] = [];
      view.state.doc.descendants((node, pos) => {
        if (node.isTextblock || (node.isBlock && node.isLeaf)) {
          blocks.push({ pos, node });
          return false;
        }
        return true;
      });

      const breaks: Break[] = [];
      let start = MARGIN;
      let lastPos = -1;
      for (let i = 0; i < blocks.length; ) {
        const { pos, node } = blocks[i]!;
        const el = view.nodeDOM(pos);
        if (!(el instanceof HTMLElement)) {
          i++;
          continue;
        }
        const rect = el.getBoundingClientRect();
        const limit = start + CONTENT_H;
        if (y(rect.bottom) <= limit + EPS) {
          i++;
          continue;
        }
        const atPageTop = y(rect.top) <= start + EPS;
        let b: { pos: number; top: number; kind: Break["kind"] } | null = null;
        if (node.isTextblock && y(rect.top) < limit) {
          const line = this.lineBreak(pos, node, limit, y, atPageTop);
          if (line === "fits") {
            i++;
            continue;
          }
          if (line) b = { ...line, kind: "line" };
        }
        if (!b && !atPageTop) {
          const at = blockBreakPos(view.state.doc, pos);
          const outer = view.nodeDOM(at);
          const top = outer instanceof HTMLElement ? outer.getBoundingClientRect().top : rect.top;
          b = { pos: at, top: y(top), kind: "block" };
        }
        // A block that starts a page and still does not fit (a leaf taller
        // than a page) stays where it is.
        if (!b || b.pos <= lastPos) {
          i++;
          continue;
        }
        breaks.push({ pos: b.pos, kind: b.kind });
        lastPos = b.pos;
        start = b.top;
        // Look at the same block again: it may run over the next page too.
      }
      return breaks;
    } finally {
      dom.classList.remove("pp-measuring");
    }
  }

  /**
   * Where to split a textblock that runs past limit: the start of its first
   * line that does not fit. Null means "move the whole block". When the block
   * starts the page it must be split, so the two line rule is skipped.
   */
  private lineBreak(pos: number, node: PMNode, limit: number, y: (v: number) => number, force: boolean): { pos: number; top: number } | "fits" | null {
    const { view } = this;
    const from = pos + 1;
    const to = pos + node.nodeSize - 1;
    const box = (q: number) => view.coordsAtPos(q, 1);
    /** The first position whose line ends below v, or null. */
    const below = (v: number): number | null => {
      let lo = from;
      let hi = to + 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (y(box(mid).bottom) > v + EPS) hi = mid;
        else lo = mid + 1;
      }
      return lo > to ? null : lo;
    };
    let p = below(limit);
    // Only padding or margin runs over, not text.
    if (p === null) return "fits";
    // Not even the first line fits: move the whole block.
    if (p === from) return null;
    if (!force) {
      const prevStart = below(y(view.coordsAtPos(p - 1, -1).top)) ?? p;
      // One line would be left alone at the bottom of the page.
      if (prevStart <= from) return null;
      // One line would be left alone at the top of the next page.
      if (below(y(box(p).bottom)) === null) p = prevStart;
    }
    return { pos: p, top: y(box(p).top) };
  }

  private fitGaps() {
    const gaps = [...this.view.dom.querySelectorAll<HTMLElement>(".pp-gap")];
    if (!gaps.length) return;
    const y = this.toPage();
    const heights = gaps.map((g) => parseFloat(g.style.height) || 0);
    const bottoms = gaps.map((g) => y(g.getBoundingClientRect().bottom));
    const next = fitGapHeights(heights, bottoms, gaps.map((_, i) => gapTarget(i)));
    // CSSOM writes are allowed by the CSP (only style attributes in markup are not).
    gaps.forEach((g, i) => g.style.setProperty("height", `${next[i]}px`));
  }

  private drawSheets() {
    const count = paged ? this.breaks.length + 1 : 0;
    const numbered = !!this.view.state.doc.attrs.pageNumbers;
    this.sheets.classList.toggle("numbered", numbered);
    while (this.sheets.children.length > count) this.sheets.lastChild!.remove();
    while (this.sheets.children.length < count) {
      const sheet = document.createElement("div");
      sheet.className = "pp-sheet";
      const num = document.createElement("span");
      num.className = "pp-num";
      num.textContent = String(this.sheets.children.length + 1);
      sheet.append(num);
      this.sheets.append(sheet);
    }
  }
}
