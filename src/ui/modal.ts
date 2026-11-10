// In-app modal dialogs (confirm, alert, about). Built from plain elements
// rather than <dialog> so they also work on older macOS WebKit.

import { h } from "./dom.ts";

export interface ModalButton {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ModalOptions {
  title: string;
  body: string | Node;
  buttons: ModalButton[];
  /** Returned when the user presses Escape or closes the window. */
  cancelId: string;
}

let open = false;
export const isModalOpen = () => open;

export function showModal(opts: ModalOptions): Promise<string> {
  const root = document.getElementById("modal-root")!;
  const previous = document.activeElement as HTMLElement | null;
  open = true;

  return new Promise((resolve) => {
    const finish = (id: string) => {
      open = false;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      previous?.focus();
      resolve(id);
    };

    const buttons = opts.buttons.map((b) =>
      h("button", { class: `btn${b.primary ? " primary" : ""}`, type: "button", text: b.label, on: { click: () => finish(b.id) } }),
    );
    const titleId = `modal-title-${Date.now()}`;
    const win = h(
      "div",
      { class: "window modal", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h("div", { class: "titlebar" }, h("span", { id: titleId, text: opts.title }), h("button", { class: "close", type: "button", "aria-label": "Close", text: "×", on: { click: () => finish(opts.cancelId) } })),
      h("div", { class: "modal-body" }, typeof opts.body === "string" ? h("p", { text: opts.body }) : opts.body),
      h("div", { class: "modal-buttons" }, ...buttons),
    );
    const overlay = h("div", { class: "overlay" }, win);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(opts.cancelId);
      } else if (e.key === "Tab") {
        // Keep focus inside the dialog.
        const focusable = Array.from(win.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, [contenteditable='true']"));
        const i = focusable.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : (i + 1) % focusable.length;
        focusable[next]?.focus();
        e.preventDefault();
      }
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    root.append(overlay);
    (buttons[opts.buttons.findIndex((b) => b.primary)] ?? buttons[0])?.focus();
  });
}

/** A dialog with a single OK button. */
export function alertBox(title: string, body: string | Node) {
  return showModal({ title, body, buttons: [{ id: "ok", label: "OK", primary: true }], cancelId: "ok" });
}
