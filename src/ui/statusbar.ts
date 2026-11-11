// Status bar: a transient message on the left, document facts on the right.

import type { EditorState } from "prosemirror-state";
import { stats } from "../editor/commands.ts";
import { pageInfo } from "../editor/pages.ts";
import { h } from "./dom.ts";

export function createStatusBar(root: HTMLElement) {
  const message = h("span", { class: "sb-cell sb-message", text: "Ready" });
  const page = h("span", { class: "sb-cell sb-page" });
  const position = h("span", { class: "sb-cell sb-pos" });
  const words = h("span", { class: "sb-cell sb-words" });
  const chars = h("span", { class: "sb-cell sb-chars" });
  const format = h("span", { class: "sb-cell sb-format" });
  const zoom = h("span", { class: "sb-cell sb-zoom" });
  root.append(message, page, position, words, chars, format, zoom);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: EditorState | null = null;
  const nf = new Intl.NumberFormat();

  return {
    flash(text: string, ms = 4000) {
      message.textContent = text;
      clearTimeout(timer);
      timer = setTimeout(() => (message.textContent = "Ready"), ms);
    },
    /** Counting words walks the whole document, so do it once per frame at most. */
    update(state: EditorState) {
      if (pending) {
        pending = state;
        return;
      }
      pending = state;
      requestAnimationFrame(() => {
        const s = stats(pending!);
        const p = pageInfo(pending!);
        pending = null;
        page.hidden = !p;
        if (p) page.textContent = `Page ${nf.format(p.page)} of ${nf.format(p.pages)}`;
        position.textContent = `Par ${s.paragraph}, Col ${s.column}`;
        const total = `${nf.format(s.words)} ${s.words === 1 ? "word" : "words"}`;
        words.textContent = s.selectedWords === null ? total : `${nf.format(s.selectedWords)} of ${total} selected`;
        chars.textContent = `${nf.format(s.chars)} chars`;
      });
    },
    setFormat(label: string) {
      format.textContent = label;
    },
    setZoom(z: number) {
      zoom.textContent = `${Math.round(z * 100)}%`;
    },
  };
}
