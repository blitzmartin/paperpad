// The open document on mobile: new, open, save, save as, conflicts, reload,
// autosave, crash recovery and images.
//
// The same rules as the desktop shell (src/app.ts), in a smaller form: no
// options, no recent files, no export. Kept separate on purpose so the desktop
// shell does not change while this one settles (see ANDROID.md, section 4).
//
// Why autosave is always on: Android ends a backgrounded app whenever it
// likes, without a close event, so there is no "unsaved changes" dialog.
// Autosave (PaperPad files that already exist) and crash recovery (everything
// else) are what keep the user's work.

import { keymap } from "prosemirror-keymap";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import * as cmd from "../editor/commands.ts";
import { roomForImage } from "../editor/image.ts";
import { blankDoc, newState } from "../editor/setup.ts";
import * as backend from "../io/backend.ts";
import type { OpenedDoc } from "../io/backend.ts";
import { type EditableFormat, newDocId, parseDocument, serializeDocument, serializeHtml } from "../io/native.ts";
import { DEFAULT_HISTORY_KEEP } from "../ui-kit/history.ts";
import { prepareImage } from "../ui-kit/image-import.ts";
import { alertBox, isModalOpen, showModal } from "../ui-kit/modal.ts";

/** Time from the first unsaved change to the autosave. Leaving the app saves at once. */
const AUTOSAVE_MS = 15_000;
const RECOVERY_MS = 15_000;
/**
 * New documents use a font bundled with the app: the Windows fonts (Arial,
 * Times New Roman) are missing on Android (ANDROID.md, section 5).
 */
const MOBILE_FONT = "atkinson";

const FORMAT_LABEL: Record<EditableFormat, string> = { html: "PaperPad", md: "Markdown", txt: "Plain text" };

/**
 * Keys only the mobile shell adds, ahead of the shared keymap. Gboard has no
 * arrow keys, which desktop uses to leave a code block (exitCodeBlock), so
 * here Enter on an empty last line leaves it.
 */
const mobileKeys = keymap({ Enter: cmd.exitCodeOnEmptyLine });

/** The shared editor state (setup.ts) with the mobile keys. */
const editorState = (doc: PMNode) => {
  const state = newState(doc);
  return state.reconfigure({ plugins: [mobileKeys, ...state.plugins] });
};

export type FileInfo = {
  /** Null until the document is saved once. */
  token: number | null;
  name: string;
  format: EditableFormat;
  /** The document ID of a PaperPad file. None until its first save. */
  docId?: string | null;
};

type Written = FileInfo & { warning?: string | null };

/** Shows a short message. `ms` is how long. */
export type Notify = (text: string, ms?: number) => void;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const createSession = (view: EditorView, notify: Notify, onFileChange: () => void) => {
  const emptyDoc = () => newState(blankDoc(MOBILE_FONT)).doc;

  let file: FileInfo = { token: null, name: "Untitled", format: "html" };
  /** The document as last saved: "dirty" means the editor differs from it. */
  let saved: PMNode = emptyDoc();
  /**
   * True while a save is written or a file is being opened. The system file
   * screens hide the app, and coming back must not reload or autosave meanwhile.
   */
  let busy = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  view.updateState(editorState(saved));

  const isDirty = () => !view.state.doc.eq(saved);
  const stem = () => file.name.replace(/\.[^.]+$/, "") || "Untitled";
  const fail = (what: string, e: unknown) => void alertBox("PaperPad", `${what}: ${messageOf(e)}`);

  const setFile = (next: FileInfo, doc: PMNode) => {
    file = next;
    saved = doc;
    onFileChange();
  };

  /**
   * Shows a document. Unlike desktop, page numbers stay as they are: there is
   * no page view here, and a file saved on the tablet keeps them for desktop.
   */
  const load = (doc: PMNode, next: FileInfo, markSaved = true) => {
    cancelAutosave();
    view.updateState(editorState(doc));
    setFile(next, markSaved ? view.state.doc : emptyDoc());
  };

  // ---- saving -------------------------------------------------------------------

  /** Writes the document and records it as saved. False when cancelled or failed. */
  const persist = async (write: (doc: PMNode) => Promise<Written | null>, auto = false): Promise<boolean> => {
    const doc = view.state.doc;
    busy = true;
    try {
      const result = await write(doc);
      if (!result) return false;
      const { warning, ...next } = result;
      // The file may have been replaced (Save as) while this was written.
      if (auto && next.token !== file.token) return false;
      setFile(next, doc);
      // Typing during the write keeps the document dirty: recovery still covers it.
      if (!isDirty()) void backend.recoveryClear();
      // An autosave is shown by the title losing its unsaved mark, not by a message.
      if (warning) notify(warning, 10000);
      else if (!auto) notify(`Saved ${file.name}`);
      return true;
    } catch (e) {
      if (auto) notify(`Autosave failed: ${messageOf(e)}`, 10000);
      else fail("Could not save", e);
      return false;
    } finally {
      busy = false;
      onFileChange();
    }
  };

  /** Save as makes a new file, so it is a new document with a new ID. */
  const saveAs = () => {
    const docId = newDocId();
    return persist(async (doc) => {
      const written = await backend.saveAs(serializeHtml(doc, stem(), docId), stem(), DEFAULT_HISTORY_KEEP);
      return written && { ...written, docId };
    });
  };

  const askConflict = (name: string) =>
    showModal({
      title: "PaperPad",
      body: `${name} was changed on another device since you opened it. Keep both asks where to save your version as a separate file and leaves the other version as it is. Replace it overwrites the other version, which stays in the version history.`,
      buttons: [
        { id: "copy", label: "Keep both", primary: true },
        { id: "overwrite", label: "Replace it" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });

  const save = (auto = false): Promise<boolean> => {
    const current = file;
    if (current.token === null) return saveAs();
    const token = current.token;
    // A PaperPad file gets its document ID the first time it is saved.
    const docId = current.format === "html" ? (current.docId ?? newDocId()) : null;
    return persist(async (doc) => {
      const content = await serializeDocument(doc, current.format, stem(), docId);
      let out = await backend.save(token, content, auto, DEFAULT_HISTORY_KEEP, false);
      if (out.conflict) {
        // An autosave never decides this on its own.
        if (auto) throw new Error("the file was changed on another device. Tap Save to decide what to do");
        const choice = await askConflict(current.name);
        if (choice === "cancel") return null;
        if (choice === "copy") {
          // The copy is a new file, so like Save as it gets its own ID and history.
          const copyId = docId && newDocId();
          const copy = copyId ? await serializeDocument(doc, current.format, stem(), copyId) : content;
          const copied = await backend.saveConflictCopy(token, copy);
          return copied && { ...copied, docId: copyId };
        }
        out = await backend.save(token, content, false, DEFAULT_HISTORY_KEEP, true);
      }
      return { ...current, docId, warning: out.warning };
    }, auto);
  };

  // ---- autosave and recovery ----------------------------------------------------

  /** Only PaperPad files that already exist: Markdown and text would lose formatting. */
  const canAutosave = () => file.token !== null && file.format === "html";

  const cancelAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
  };

  const autosaveNow = () => {
    cancelAutosave();
    if (!canAutosave() || !isDirty()) return;
    // Wait while a dialog is open (it may be asking about these very changes)
    // or another save is being written.
    if (busy || isModalOpen()) {
      autosaveTimer = setTimeout(autosaveNow, 2000);
      return;
    }
    void save(true);
  };

  /** Called on every editor update: plans an autosave after the first unsaved change. */
  const changed = () => {
    if (autosaveTimer === undefined && canAutosave() && isDirty()) autosaveTimer = setTimeout(autosaveNow, AUTOSAVE_MS);
  };

  let lastRecovered: PMNode | null = null;
  const writeRecovery = () => {
    const doc = view.state.doc;
    if (!isDirty() || doc === lastRecovered) return;
    lastRecovered = doc;
    void backend.recoveryWrite(serializeHtml(doc, stem())).catch(() => {});
  };
  setInterval(writeRecovery, RECOVERY_MS);

  /** The app goes to the background, where Android may end it: save what can be saved now. */
  const leaving = () => {
    writeRecovery();
    if (canAutosave() && isDirty()) autosaveNow();
  };

  const offerRecovery = async () => {
    const content = await backend.recoveryRead().catch(() => null);
    if (!content) return;
    const choice = await showModal({
      title: "Document recovery",
      body: "PaperPad closed before a document was saved. Do you want to restore it?",
      buttons: [
        { id: "restore", label: "Restore", primary: true },
        { id: "discard", label: "Discard" },
      ],
      cancelId: "discard",
    });
    if (choice === "restore") {
      // Restored as an unsaved document so the user is asked to save it.
      load(await parseDocument(content, "html", MOBILE_FONT), { token: null, name: "Recovered", format: "html" }, false);
    } else {
      void backend.recoveryClear();
    }
  };

  // ---- opening ------------------------------------------------------------------

  /**
   * Back in the app, a file that is open and unchanged here may have been
   * updated on another device. Reload it. Unsaved changes are left alone: Save asks.
   */
  const reloadIfChanged = async () => {
    const token = file.token;
    if (token === null || busy || isModalOpen() || isDirty()) return;
    try {
      if (!(await backend.changedOnDisk(token))) return;
      // What is about to be replaced goes to the version history first.
      const previous = await serializeDocument(saved, file.format, stem(), file.docId);
      const fresh = await backend.reload(token, previous, DEFAULT_HISTORY_KEEP);
      const doc = await parseDocument(fresh.content, file.format, MOBILE_FONT);
      // Typing or another file may have come in while this was read.
      if (file.token !== token || isDirty()) return;
      load(doc, { ...file, docId: fresh.docId });
      notify(`${file.name} was changed on another device and has been reloaded`, 6000);
    } catch {
      // Not worth a dialog: Save checks again.
    }
  };

  /** Asks what to do with unsaved changes. Resolves true when it is OK to continue. */
  const confirmDiscard = async (): Promise<boolean> => {
    if (!isDirty()) return true;
    const choice = await showModal({
      title: "PaperPad",
      body: `Save changes to ${file.name}?`,
      buttons: [
        { id: "save", label: "Save", primary: true },
        { id: "discard", label: "Don't save" },
        { id: "cancel", label: "Cancel" },
      ],
      cancelId: "cancel",
    });
    if (choice === "save") return save();
    if (choice === "discard") void backend.recoveryClear();
    return choice === "discard";
  };

  const open = async () => {
    if (!(await confirmDiscard())) return;
    let opened: OpenedDoc | null;
    busy = true;
    try {
      opened = await backend.open();
    } catch (e) {
      return fail("Could not open", e);
    } finally {
      busy = false;
    }
    if (!opened) return;
    let doc: PMNode;
    try {
      doc = await parseDocument(opened.content, opened.format, MOBILE_FONT);
    } catch (e) {
      return fail(`Could not read ${opened.name}`, e);
    }
    load(doc, { token: opened.token, name: opened.name, format: opened.format, docId: opened.docId });
    void backend.recoveryClear();
    if (opened.format !== "html") notify(`${FORMAT_LABEL[opened.format]} keeps no fonts, colors or images and is not autosaved. Use Save as to keep formatting.`, 8000);
  };

  const newDocument = async () => {
    if (await confirmDiscard()) load(emptyDoc(), { token: null, name: "Untitled", format: "html" });
  };

  // ---- images -------------------------------------------------------------------

  /** Rust shows the system picker and returns the bytes, never the URI. */
  const addImage = async () => {
    let bytes: ArrayBuffer | null;
    busy = true;
    try {
      bytes = await backend.pickImage();
    } catch (e) {
      return fail("Could not open the image", e);
    } finally {
      busy = false;
    }
    if (!bytes) return;
    notify("Adding image...", 60000);
    try {
      const img = await prepareImage(new Blob([bytes]));
      if (!roomForImage(view.state.doc, img.src.length)) throw new Error("the document would be larger than 32 MB, the most PaperPad can save");
      cmd.insertImage(img)(view.state, view.dispatch);
      if (file.format === "html") notify("Image added", 2000);
      else notify(`${FORMAT_LABEL[file.format]} files keep no images. Use Save as to keep them.`, 8000);
    } catch (e) {
      notify("", 1);
      fail("Could not add the image", e);
    }
  };

  return {
    file: () => file,
    isDirty,
    changed,
    leaving,
    reloadIfChanged,
    offerRecovery,
    newDocument,
    open,
    save: () => save(),
    saveAs,
    addImage,
  };
};

export type Session = ReturnType<typeof createSession>;
