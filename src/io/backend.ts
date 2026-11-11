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
}

export interface OpenedDoc extends SavedDoc {
  content: string;
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
  save: (token: number, content: string) => call<void>("save_document", { token, content }),
  saveAs: (content: string, suggestedName: string) => call<SavedDoc | null>("save_document_as", { content, suggestedName }),
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
