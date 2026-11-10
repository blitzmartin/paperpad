// Status bar: a transient message on the left, document facts on the right.

import type { EditorState } from "prosemirror-state";
import { stats } from "../editor/commands.ts";
import { h } from "./dom.ts";

export function createStatusBar(root: HTMLElement) {
  const message = h("span", { class: "sb-cell sb-message", text: "Ready" });
  const position = h("span", { class: "sb-cell sb-pos" });
  const words = h("span", { class: "sb-cell" });
  const chars = h("span", { class: "sb-cell" });
  const format = h("span", { class: "sb-cell" });
  const zoom = h("span", { class: "sb-cell sb-zoom" });
  root.append(message, position, words, chars, format, zoom);

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
        pending = null;
        position.textContent = `Par ${s.paragraph}, Col ${s.column}`;
        words.textContent = `${nf.format(s.words)} ${s.words === 1 ? "word" : "words"}`;
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
