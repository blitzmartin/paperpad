// The welcome window, shown once at the first start. It explains the PaperPad
// folder (where documents live, and the way to use several computers) and
// offers to choose it. It is never required: skipping it costs a little
// convenience only, and the folder can be chosen later in View, Options, Files.
//
// It is shown again only if the "seen" flag is lost (browser storage can be
// cleared) and no folder is set, which is harmless.

import * as backend from "../io/backend.ts";
import { inApp } from "../io/backend.ts";
import { h } from "../ui-kit/dom.ts";
import { showModal } from "../ui-kit/modal.ts";
import { loadPref, storePref } from "../ui-kit/theme.ts";

const WELCOME_KEY = "paperpad.welcome";

export type WelcomeResult = "chosen" | "later";

/** Resolves with what the user did, or null when the window was not needed. */
export async function offerWelcome(): Promise<WelcomeResult | null> {
  if (!inApp || loadPref(WELCOME_KEY) === "seen") return null;
  // A folder is already set (an earlier version or another start): nothing to ask.
  if (await backend.documentsFolder().catch(() => null)) {
    storePref(WELCOME_KEY, "seen");
    return null;
  }

  const choice = await showModal({
    title: "Welcome to PaperPad",
    body: h(
      "div",
      { class: "welcome" },
      h("p", { text: "PaperPad keeps your writing in ordinary files on your computer. There is no account and nothing is sent anywhere." }),
      h("p", {}, h("strong", { text: "Choose a PaperPad folder" }), " to keep your documents together. Open and Save as will start there."),
      h("p", {
        text:
          "To write on more than one computer, choose a folder that your cloud app keeps in sync, such as Dropbox, OneDrive, Nextcloud or Syncthing. " +
          "PaperPad notices when another computer changes a file and never overwrites it without asking.",
      }),
      h("p", {
        class: "opt-note",
        text:
          "You can skip this. PaperPad works the same: you can save anywhere, and version history and protection from overwriting still apply. " +
          "You will just browse to your documents each time, and nothing will travel between computers on its own. " +
          "You can change this later in View, Options, Files.",
      }),
    ),
    buttons: [
      { id: "choose", label: "Choose folder...", primary: true },
      { id: "later", label: "Not now" },
    ],
    cancelId: "later",
  });
  storePref(WELCOME_KEY, "seen");
  if (choice !== "choose") return "later";
  const folder = await backend.chooseDocumentsFolder().catch(() => null);
  return folder ? "chosen" : "later";
}
