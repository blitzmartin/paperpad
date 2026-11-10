// Floating Find and Replace window. It stays open while you edit.

import type { EditorView } from "prosemirror-view";
import { findAll, findNext, type FindOptions, replaceAll, replaceOne } from "../editor/find.ts";
import { h } from "./dom.ts";

export function createFindPanel(getView: () => EditorView) {
  let panel: HTMLElement | null = null;
  let findInput: HTMLInputElement;
  let replaceInput: HTMLInputElement;
  let matchCase: HTMLInputElement;
  let wholeWord: HTMLInputElement;
  let status: HTMLElement;

  const opts = (): FindOptions => ({ matchCase: matchCase.checked, wholeWord: wholeWord.checked });

  const report = (text: string): void => {
    status.textContent = text;
  };

  const countMatches = (): void => {
    const q = findInput.value;
    if (!q) return void report("");
    const n = findAll(getView().state.doc, q, opts()).length;
    report(n === 0 ? "Not found" : n === 1 ? "1 match" : `${n} matches`);
  };

  const step = (backwards: boolean) => {
    const view = getView();
    const tr = findNext(view.state, findInput.value, opts(), backwards);
    if (tr) view.dispatch(tr);
    else report("Not found");
  };

  const replace = () => {
    const view = getView();
    const tr = replaceOne(view.state, findInput.value, replaceInput.value, opts());
    if (tr) view.dispatch(tr);
    countMatches();
  };

  const replaceEvery = (): void => {
    const view = getView();
    const result = replaceAll(view.state, findInput.value, replaceInput.value, opts());
    if (!result) return void report("Not found");
    view.dispatch(result.tr);
    report(`Replaced ${result.count}`);
  };

  const close = () => {
    panel?.remove();
    panel = null;
    getView().focus();
  };

  const build = () => {
    findInput = h("input", { type: "text", class: "field", "aria-label": "Find what", spellcheck: "false" });
    replaceInput = h("input", { type: "text", class: "field", "aria-label": "Replace with", spellcheck: "false" });
    matchCase = h("input", { type: "checkbox" });
    wholeWord = h("input", { type: "checkbox" });
    status = h("span", { class: "find-status", "aria-live": "polite" });

    const btn = (label: string, fn: () => void) => h("button", { class: "btn", type: "button", text: label, on: { click: fn } });

    findInput.addEventListener("input", countMatches);
    matchCase.addEventListener("change", countMatches);
    wholeWord.addEventListener("change", countMatches);

    const win = h(
      "div",
      { class: "window find-panel", role: "dialog", "aria-label": "Find and replace" },
      h("div", { class: "titlebar" }, h("span", { text: "Find and Replace" }), h("button", { class: "close", type: "button", "aria-label": "Close", text: "×", on: { click: close } })),
      h(
        "div",
        { class: "find-grid" },
        h("label", { text: "Find:" }),
        findInput,
        h("div", { class: "find-buttons" }, btn("Previous", () => step(true)), btn("Next", () => step(false))),
        h("label", { text: "Replace:" }),
        replaceInput,
        h("div", { class: "find-buttons" }, btn("Replace", replace), btn("All", replaceEvery)),
      ),
      h(
        "div",
        { class: "find-options" },
        h("label", {}, matchCase, " Match case"),
        h("label", {}, wholeWord, " Whole word"),
        status,
      ),
    );

    win.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && e.target === findInput) {
        e.preventDefault();
        step(e.shiftKey);
      } else if (e.key === "Enter" && e.target === replaceInput) {
        e.preventDefault();
        replace();
      }
      e.stopPropagation();
    });
    return win;
  };

  return {
    open(focusReplace = false) {
      if (!panel) {
        panel = build();
        document.getElementById("workspace")!.append(panel);
      }
      // Seed the search with the selected text, as most editors do.
      const { state } = getView();
      const selected = state.doc.textBetween(state.selection.from, state.selection.to, " ");
      if (selected && selected.length < 200 && !selected.includes("\n")) findInput.value = selected;
      const target = focusReplace ? replaceInput : findInput;
      target.focus();
      target.select();
      countMatches();
    },
    close,
    get isOpen() {
      return panel !== null;
    },
  };
}
