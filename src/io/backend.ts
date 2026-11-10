// Typed wrappers around the Rust commands in src-tauri/src/commands.rs.
// This is the only file that talks to the backend. The frontend never
// handles file paths: Rust shows the dialogs and returns opaque tokens.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocxPart } from "../export/docx.ts";
import type { EditableFormat } from "./native.ts";

export interface OpenedDoc {
  token: number;
  name: string;
  format: EditableFormat;
  content: string;
}

export interface SavedDoc {
  token: number;
  name: string;
  format: EditableFormat;
}

export interface RecentEntry {
  index: number;
  name: string;
  folder: string;
}

export type TextExport = "md" | "txt" | "rtf" | "html";

export const inApp = isTauri();

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inApp) return Promise.reject(new Error("File access needs the desktop app (npm run tauri dev)."));
  return invoke<T>(cmd, args);
}

export const backend = {
  open: () => call<OpenedDoc | null>("open_document"),
  openRecent: (index: number) => call<OpenedDoc>("open_recent", { index }),
  listRecent: () => (inApp ? call<RecentEntry[]>("list_recent") : Promise.resolve([])),
  save: (token: number, content: string) => call<void>("save_document", { token, content }),
  saveAs: (content: string, suggestedName: string) => call<SavedDoc | null>("save_document_as", { content, suggestedName }),
  exportText: (format: TextExport, content: string, suggestedName: string) =>
    call<string | null>("export_text", { format, content, suggestedName }),
  exportDocx: (parts: DocxPart[], suggestedName: string) => call<string | null>("export_docx", { parts, suggestedName }),
  setDocumentState: (title: string, dirty: boolean) =>
    inApp ? call<void>("set_document_state", { title, dirty }) : ((document.title = `${dirty ? "*" : ""}${title} - PaperPad`), Promise.resolve()),
  recoveryWrite: (content: string) => (inApp ? call<void>("recovery_write", { content }) : Promise.resolve()),
  recoveryRead: () => (inApp ? call<string | null>("recovery_read") : Promise.resolve(null)),
  recoveryClear: () => (inApp ? call<void>("recovery_clear") : Promise.resolve()),
};
