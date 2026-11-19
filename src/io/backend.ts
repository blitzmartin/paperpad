// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// This is the only file that talks to the backend. The frontend never
// handles file paths: Rust shows the dialogs and returns opaque tokens.
//
// One named export per command, so each shell's bundle keeps only the
// wrappers it calls. Import it as a namespace (`import * as backend`): the
// bundler still drops what is not used.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocxPart } from "../export/docx.ts";
import type { EditableFormat } from "./native.ts";

export type SavedDoc = {
  token: number;
  name: string;
  format: EditableFormat;
  /** Set by a save when the version archive could not be written. */
  warning?: string | null;
};

export type VersionEntry = {
  id: string;
  timeMs: number;
  bytes: number;
};

export type OpenedDoc = SavedDoc & {
  content: string;
  /** The document ID stored in a PaperPad file, if it has one. */
  docId: string | null;
};

export type SaveOutcome = {
  /** The file changed on disk since PaperPad read or wrote it: nothing was written. */
  conflict: boolean;
  warning: string | null;
};

export type RecentEntry = {
  index: number;
  name: string;
  folder: string;
};

export type TextExport = "md" | "txt" | "rtf";

export const inApp = isTauri();

const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  inApp ? invoke<T>(cmd, args) : Promise.reject(new Error("File access needs the desktop app (npm run tauri dev)."));

/** For background commands: in a browser preview they quietly resolve to the fallback. */
const optional = <T>(fallback: T, cmd: string, args?: Record<string, unknown>): Promise<T> =>
  inApp ? invoke<T>(cmd, args) : Promise.resolve(fallback);

// ---- documents --------------------------------------------------------------

export const open = () => call<OpenedDoc | null>("open_document");

export const openRecent = (index: number) => call<OpenedDoc>("open_recent", { index });

export const listRecent = () => optional<RecentEntry[]>([], "list_recent");

/**
 * Rust archives a copy first, then writes the file. When the file changed on
 * disk meanwhile it writes nothing and says so, unless `force` is set.
 */
export const save = (token: number, content: string, auto: boolean, keep: number, force: boolean) =>
  call<SaveOutcome>("save_document", { token, content, auto, keep, force });

/** True when another program or computer changed the open file. */
export const changedOnDisk = (token: number) => optional<boolean>(false, "check_external_change", { token });

/**
 * Reads the open file again. `previous` (the document as last saved here) is
 * kept in the version archive first, since an autosave may not have archived it.
 */
export const reload = (token: number, previous: string, keep: number) =>
  call<{ content: string; docId: string | null }>("reload_document", { token, previous, keep });

/**
 * Saves the copy as "<name> (conflict <date>)" and returns the new file. Desktop
 * puts it next to the original. Android asks where to save it, with that name
 * proposed, and returns null when the user cancels.
 */
export const saveConflictCopy = (token: number, content: string) => call<SavedDoc | null>("save_conflict_copy", { token, content });

export const saveAs = (content: string, suggestedName: string, keep: number) =>
  call<SavedDoc | null>("save_document_as", { content, suggestedName, keep });

// ---- documents folder ---------------------------------------------------------

/** The name (never the path) of the folder Open and Save As start in. */
export const documentsFolder = () => optional<string | null>(null, "get_documents_folder");

export const chooseDocumentsFolder = () => call<string | null>("choose_documents_folder");

export const clearDocumentsFolder = () => call<void>("clear_documents_folder");

// ---- version history ----------------------------------------------------------

export const listVersions = (token: number) => call<VersionEntry[]>("list_versions", { token });

export const readVersion = (token: number, id: string) => call<string>("read_version", { token, id });

// ---- export -------------------------------------------------------------------

export const exportText = (format: TextExport, content: string, suggestedName: string) =>
  call<string | null>("export_text", { format, content, suggestedName });

export const exportDocx = (parts: DocxPart[], suggestedName: string) => call<string | null>("export_docx", { parts, suggestedName });

// ---- window and images ----------------------------------------------------------

export const setDocumentState = (title: string, dirty: boolean) => {
  if (!inApp) document.title = `${dirty ? "*" : ""}${title} - PaperPad`;
  return optional(undefined, "set_document_state", { title, dirty });
};

/** Shows the native Open dialog for an image. Returns its bytes, or null when cancelled. */
export const pickImage = async (): Promise<ArrayBuffer | null> => {
  const bytes = await call<ArrayBuffer>("pick_image");
  return bytes.byteLength ? bytes : null;
};

// ---- crash recovery -------------------------------------------------------------

export const recoveryWrite = (content: string) => optional(undefined, "recovery_write", { content });

export const recoveryRead = () => optional<string | null>(null, "recovery_read");

export const recoveryClear = () => optional(undefined, "recovery_clear");
