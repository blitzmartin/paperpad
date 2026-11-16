// File > Version history: lists the saved versions of the open document and
// returns the one the user wants to restore. Restoring loads it into the
// editor as an ordinary change (undoable, not saved until the user saves).

import type { VersionEntry } from "../io/backend.ts";
import { h } from "../ui-kit/dom.ts";
import { sizeLabel } from "../ui-kit/history.ts";
import { showModal } from "../ui-kit/modal.ts";

/** Resolves with the id of the chosen version, or null when cancelled. */
export async function pickVersion(name: string, versions: VersionEntry[]): Promise<string | null> {
  let chosen = versions[0]!.id;
  const rows = versions.map((v, i) => {
    const input = h("input", { type: "radio", name: "version", value: v.id });
    input.checked = i === 0;
    input.addEventListener("change", () => (chosen = v.id));
    const when = new Date(v.timeMs).toLocaleString();
    return h("label", { class: "opt-choice" }, input, ` ${when}  `, h("span", { class: "muted", text: sizeLabel(v.bytes) }));
  });
  const body = h(
    "div",
    { class: "options" },
    h("p", { text: `Earlier saved versions of ${name}. The newest is at the top.` }),
    h("fieldset", { class: "opt-group opt-stack version-list" }, h("legend", { text: "Versions" }), ...rows),
    h("p", { class: "opt-note", text: "Restoring puts the version in the editor as a change you can undo. Nothing is saved until you save." }),
  );
  const result = await showModal({
    title: "Version history",
    body,
    buttons: [
      { id: "restore", label: "Restore", primary: true },
      { id: "cancel", label: "Cancel" },
    ],
    cancelId: "cancel",
  });
  return result === "restore" ? chosen : null;
}
