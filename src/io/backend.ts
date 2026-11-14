// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// This is the only file that talks to the backend. The frontend never
// handles file paths: Rust shows the dialogs and returns opaque tokens.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocxPart } from "../export/docx.ts";
import type { EditableFormat } from "./native.ts";

export interface SavedDoc {
  token: number;
  name: string;
  format: EditableFormat;
  /** Set by a save when the version archive could not be written. */
  warning?: string | null;
}

export interface VersionEntry {
  id: string;
  timeMs: number;
  bytes: number;
}

export interface OpenedDoc extends SavedDoc {
  content: string;
  /** The document ID stored in a PaperPad file, if it has one. */
  docId: string | null;
}

export interface SaveOutcome {
  /** The file changed on disk since PaperPad read or wrote it: nothing was written. */
  conflict: boolean;
  warning: string | null;
}

export interface RecentEntry {
  index: number;
  name: string;
  folder: string;
}

export type TextExport = "md" | "txt" | "rtf";

export const inApp = isTauri();

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inApp) return Promise.reject(new Error("File access needs the desktop app (npm run tauri dev)."));
  return invoke<T>(cmd, args);
}

/** For background commands: in a browser preview they quietly resolve to the fallback. */
function optional<T>(fallback: T, cmd: string, args?: Record<string, unknown>): Promise<T> {
  return inApp ? invoke<T>(cmd, args) : Promise.resolve(fallback);
}

export const backend = {
  open: () => call<OpenedDoc | null>("open_document"),
  openRecent: (index: number) => call<OpenedDoc>("open_recent", { index }),
  listRecent: () => optional<RecentEntry[]>([], "list_recent"),
  /**
   * Rust archives a copy first, then writes the file. When the file changed on
   * disk meanwhile it writes nothing and says so, unless `force` is set.
   */
  save: (token: number, content: string, auto: boolean, keep: number, force: boolean) =>
    call<SaveOutcome>("save_document", { token, content, auto, keep, force }),
  /** True when another program or computer changed the open file. */
  changedOnDisk: (token: number) => optional<boolean>(false, "check_external_change", { token }),
  /**
   * Reads the open file again. `previous` (the document as last saved here) is
   * kept in the version archive first, since an autosave may not have archived it.
   */
  reload: (token: number, previous: string, keep: number) =>
    call<{ content: string; docId: string | null }>("reload_document", { token, previous, keep }),
  /** Saves next to the original as "<name> (conflict <date>)" and returns the new file. */
  saveConflictCopy: (token: number, content: string) => call<SavedDoc>("save_conflict_copy", { token, content }),
  saveAs: (content: string, suggestedName: string, keep: number) =>
    call<SavedDoc | null>("save_document_as", { content, suggestedName, keep }),
  /** The name (never the path) of the folder Open and Save As start in. */
  documentsFolder: () => optional<string | null>(null, "get_documents_folder"),
  chooseDocumentsFolder: () => call<string | null>("choose_documents_folder"),
  clearDocumentsFolder: () => call<void>("clear_documents_folder"),
  listVersions: (token: number) => call<VersionEntry[]>("list_versions", { token }),
  readVersion: (token: number, id: string) => call<string>("read_version", { token, id }),
  exportText: (format: TextExport, content: string, suggestedName: string) =>
    call<string | null>("export_text", { format, content, suggestedName }),
  exportDocx: (parts: DocxPart[], suggestedName: string) => call<string | null>("export_docx", { parts, suggestedName }),
  setDocumentState(title: string, dirty: boolean) {
    if (!inApp) document.title = `${dirty ? "*" : ""}${title} - PaperPad`;
    return optional(undefined, "set_document_state", { title, dirty });
  },
  /** Shows the native Open dialog for an image. Returns its bytes, or null when cancelled. */
  async pickImage(): Promise<ArrayBuffer | null> {
    const bytes = await call<ArrayBuffer>("pick_image");
    return bytes.byteLength ? bytes : null;
  },
  recoveryWrite: (content: string) => optional(undefined, "recovery_write", { content }),
  recoveryRead: () => optional<string | null>(null, "recovery_read"),
  recoveryClear: () => optional(undefined, "recovery_clear"),
};
