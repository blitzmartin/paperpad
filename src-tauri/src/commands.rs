//! Commands callable from the webview. Each one is granted individually in
//! capabilities/default.json (see build.rs).
//!
//! Rules every command follows:
//! - paths come only from native dialogs or from the recent list, never from JS;
//! - inputs are size-limited and format names are matched against a closed set;
//! - writes are atomic (temp file + rename) so a crash never truncates a document.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;
use crate::zip;

/// Largest document we read or write (16 MiB of text is a very long book).
const MAX_DOC_BYTES: usize = 16 * 1024 * 1024;

type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Html,
    Markdown,
    Text,
    Rtf,
}

impl Format {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "html" => Some(Self::Html),
            "md" => Some(Self::Markdown),
            "txt" => Some(Self::Text),
            "rtf" => Some(Self::Rtf),
            _ => None,
        }
    }

    fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "html" | "htm" => Some(Self::Html),
            "md" | "markdown" => Some(Self::Markdown),
            "txt" | "text" => Some(Self::Text),
            "rtf" => Some(Self::Rtf),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::Markdown => "md",
            Self::Text => "txt",
            Self::Rtf => "rtf",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Html => "PaperPad document (HTML)",
            Self::Markdown => "Markdown",
            Self::Text => "Plain text",
            Self::Rtf => "Rich Text Format",
        }
    }

    fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Html => &["html", "htm"],
            Self::Markdown => &["md", "markdown"],
            Self::Text => &["txt"],
            Self::Rtf => &["rtf"],
        }
    }

    /// Formats PaperPad can open and save back in place.
    fn is_editable(self) -> bool {
        matches!(self, Self::Html | Self::Markdown | Self::Text)
    }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    token: u64,
    name: String,
    format: &'static str,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDoc {
    token: u64,
    name: String,
    format: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentEntry {
    index: usize,
    name: String,
    /// Only the parent folder name, enough to tell two files apart.
    folder: String,
}

#[derive(Deserialize)]
pub struct ZipPart {
    name: String,
    content: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".into())
}

/// Turns a frontend-suggested name into a safe bare file stem.
fn clean_stem(name: &str) -> String {
    let stem: String = name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(120)
        .collect();
    let stem = stem.trim().trim_matches('.').to_string();
    if stem.is_empty() {
        "Untitled".into()
    } else {
        stem
    }
}

/// Appends the default extension when the user typed a name without one
/// (Linux dialogs do not add it automatically).
fn ensure_extension(path: PathBuf, allowed: &[&str]) -> PathBuf {
    let ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| allowed.iter().any(|a| a.eq_ignore_ascii_case(e)))
        .unwrap_or(false);
    if ok {
        path
    } else {
        let mut s = path.into_os_string();
        s.push(".");
        s.push(allowed[0]);
        PathBuf::from(s)
    }
}

fn read_text(path: &Path) -> CmdResult<String> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a regular file".into());
    }
    if meta.len() as usize > MAX_DOC_BYTES {
        return Err("File is larger than 16 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

/// Writes through a temporary sibling file, flushes it to disk, then renames
/// it over the destination. Rename is atomic on the same volume.
fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
    if bytes.len() > MAX_DOC_BYTES * 2 {
        return Err("Document too large".into());
    }
    let dir = path.parent().ok_or("Invalid destination")?;
    let tmp = dir.join(format!(".{}.paperpad-tmp", file_name(path)));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Cannot write file: {e}"));
    }
    Ok(())
}

fn check_size(content: &str) -> CmdResult<()> {
    if content.len() > MAX_DOC_BYTES {
        Err("Document too large".into())
    } else {
        Ok(())
    }
}

fn opened(state: &AppState, path: PathBuf) -> CmdResult<OpenedDoc> {
    let format = Format::from_path(&path)
        .filter(|f| f.is_editable())
        .ok_or("Unsupported file type")?;
    let content = read_text(&path)?;
    state.touch_recent(&path);
    Ok(OpenedDoc {
        name: file_name(&path),
        format: format.name(),
        content,
        token: state.issue_token(path),
    })
}

fn save_dialog(window: &Window, format: Format, suggested: &str) -> Option<PathBuf> {
    let stem = clean_stem(suggested);
    let path = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title("Save as")
        .set_file_name(format!("{stem}.{}", format.extensions()[0]))
        .add_filter(format.label(), format.extensions())
        .blocking_save_file()?
        .into_path()
        .ok()?;
    Some(ensure_extension(path, format.extensions()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Shows the native Open dialog. Returns None when the user cancels.
#[tauri::command]
pub async fn open_document(window: Window, state: State<'_, AppState>) -> CmdResult<Option<OpenedDoc>> {
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open")
        .add_filter("All supported", &["html", "htm", "md", "markdown", "txt"])
        .add_filter(Format::Html.label(), Format::Html.extensions())
        .add_filter(Format::Markdown.label(), Format::Markdown.extensions())
        .add_filter(Format::Text.label(), Format::Text.extensions())
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    opened(&state, path).map(Some)
}

#[tauri::command]
pub async fn open_recent(index: usize, state: State<'_, AppState>) -> CmdResult<OpenedDoc> {
    let path = state.recent().get(index).cloned().ok_or("No such recent file")?;
    if !path.is_file() {
        state.forget_recent(&path);
        return Err(format!("{} no longer exists", file_name(&path)));
    }
    opened(&state, path)
}

#[tauri::command]
pub fn list_recent(state: State<'_, AppState>) -> Vec<RecentEntry> {
    state
        .recent()
        .iter()
        .enumerate()
        .map(|(index, p)| RecentEntry {
            index,
            name: file_name(p),
            folder: p
                .parent()
                .and_then(|d| d.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        })
        .collect()
}

/// Saves in place to a file the user opened or saved earlier in this session.
#[tauri::command]
pub async fn save_document(token: u64, content: String, state: State<'_, AppState>) -> CmdResult<()> {
    check_size(&content)?;
    let path = state.path_for(token).ok_or("Unknown document")?;
    let format = Format::from_path(&path).ok_or("Unsupported file type")?;
    if !format.is_editable() {
        return Err("This format can only be exported".into());
    }
    write_atomic(&path, content.as_bytes())?;
    state.touch_recent(&path);
    Ok(())
}

/// Save As always produces the native format (HTML).
#[tauri::command]
pub async fn save_document_as(
    window: Window,
    content: String,
    suggested_name: String,
    state: State<'_, AppState>,
) -> CmdResult<Option<SavedDoc>> {
    check_size(&content)?;
    let Some(path) = save_dialog(&window, Format::Html, &suggested_name) else {
        return Ok(None);
    };
    write_atomic(&path, content.as_bytes())?;
    state.touch_recent(&path);
    Ok(Some(SavedDoc {
        name: file_name(&path),
        format: Format::Html.name(),
        token: state.issue_token(path),
    }))
}

/// Exports text-based formats. Returns the chosen file name, or None on cancel.
#[tauri::command]
pub async fn export_text(
    window: Window,
    format: String,
    content: String,
    suggested_name: String,
) -> CmdResult<Option<String>> {
    check_size(&content)?;
    let format = Format::from_name(&format).ok_or("Unknown export format")?;
    let Some(path) = save_dialog(&window, format, &suggested_name) else {
        return Ok(None);
    };
    write_atomic(&path, content.as_bytes())?;
    Ok(Some(file_name(&path)))
}

/// Package part names a .docx produced by PaperPad may contain.
const DOCX_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/settings.xml",
    "word/_rels/document.xml.rels",
];

#[tauri::command]
pub async fn export_docx(window: Window, parts: Vec<ZipPart>, suggested_name: String) -> CmdResult<Option<String>> {
    let total: usize = parts.iter().map(|p| p.content.len()).sum();
    if total > MAX_DOC_BYTES * 2 {
        return Err("Document too large".into());
    }
    if parts.iter().any(|p| !DOCX_PARTS.contains(&p.name.as_str())) {
        return Err("Unexpected package part".into());
    }
    let entries: Vec<(&str, &[u8])> = parts.iter().map(|p| (p.name.as_str(), p.content.as_bytes())).collect();
    let bytes = zip::build(&entries)?;

    let stem = clean_stem(&suggested_name);
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Export as Word document")
        .set_file_name(format!("{stem}.docx"))
        .add_filter("Word document", &["docx"])
        .blocking_save_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let path = ensure_extension(path, &["docx"]);
    write_atomic(&path, &bytes)?;
    Ok(Some(file_name(&path)))
}

/// Updates the native title bar and the unsaved-changes flag.
#[tauri::command]
pub fn set_document_state(window: Window, title: String, dirty: bool, state: State<'_, AppState>) -> CmdResult<()> {
    state.dirty.store(dirty, Ordering::Relaxed);
    let clean: String = title.chars().filter(|c| !c.is_control()).take(200).collect();
    let marker = if dirty { "*" } else { "" };
    window
        .set_title(&format!("{marker}{clean} - PaperPad"))
        .map_err(|e| e.to_string())
}

// ---- crash recovery ---------------------------------------------------------

fn recovery_path(state: &AppState) -> CmdResult<PathBuf> {
    state
        .data_dir()
        .map(|d| d.join("recovery.html"))
        .ok_or_else(|| "No app data folder".into())
}

#[tauri::command]
pub async fn recovery_write(content: String, state: State<'_, AppState>) -> CmdResult<()> {
    check_size(&content)?;
    let path = recovery_path(&state)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    write_atomic(&path, content.as_bytes())
}

#[tauri::command]
pub async fn recovery_read(state: State<'_, AppState>) -> CmdResult<Option<String>> {
    let path = recovery_path(&state)?;
    if !path.is_file() {
        return Ok(None);
    }
    read_text(&path).map(Some)
}

#[tauri::command]
pub fn recovery_clear(state: State<'_, AppState>) -> CmdResult<()> {
    clear_recovery(&state);
    Ok(())
}

pub fn clear_recovery(state: &AppState) {
    if let Ok(path) = recovery_path(state) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_stem_strips_paths() {
        assert_eq!(clean_stem("../../etc/passwd"), "etcpasswd");
        assert_eq!(clean_stem("  "), "Untitled");
        assert_eq!(clean_stem("Letter to Ada"), "Letter to Ada");
    }

    #[test]
    fn extension_is_appended() {
        let p = ensure_extension(PathBuf::from("/tmp/notes"), &["html", "htm"]);
        assert_eq!(p, PathBuf::from("/tmp/notes.html"));
        let p = ensure_extension(PathBuf::from("/tmp/notes.HTM"), &["html", "htm"]);
        assert_eq!(p, PathBuf::from("/tmp/notes.HTM"));
        let p = ensure_extension(PathBuf::from("/tmp/v1.2"), &["md"]);
        assert_eq!(p, PathBuf::from("/tmp/v1.2.md"));
    }
}
