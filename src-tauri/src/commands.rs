//! Commands callable from the webview. Each one is granted individually in
//! capabilities/desktop.json and capabilities/android.json (see build.rs).
//!
//! The document commands here work on filesystem paths and are the desktop
//! ones. Android gets `content://` URIs instead and has its own versions in
//! android_io.rs, which reuse the formats, limits and archive helpers below.
//!
//! Rules every command follows:
//! - paths come only from native dialogs or from the recent list, never from JS;
//! - inputs are size-limited and format names are matched against a closed set;
//! - writes are atomic (temp file + rename) so a crash never truncates a document.

// On Android only the shared helpers and commands are used (see lib.rs).
#![cfg_attr(target_os = "android", allow(dead_code, unused_imports))]

use std::borrow::Cow;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{State, Window};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

use crate::archive;
use crate::base64;
use crate::state::{fingerprint, AppState, Fingerprint};
use crate::zip;

/// Largest document we read or write. Text alone rarely passes 1 MiB; the
/// rest is room for images, which are stored in the document (base64).
/// MAX_DOC_CHARS in src/editor/image.ts must match.
pub(crate) const MAX_DOC_BYTES: usize = 32 * 1024 * 1024;
/// Largest image file that can be added. The webview scales it down first.
pub(crate) const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

pub(crate) type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format {
    Html,
    Markdown,
    Text,
    Rtf,
}

impl Format {
    const ALL: [Self; 4] = [Self::Html, Self::Markdown, Self::Text, Self::Rtf];
    /// Formats PaperPad can open and save back in place.
    const EDITABLE: [Self; 3] = [Self::Html, Self::Markdown, Self::Text];

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|f| f.name() == name)
    }

    pub(crate) fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Self::ALL.into_iter().find(|f| f.extensions().contains(&ext.as_str()))
    }

    pub(crate) fn name(self) -> &'static str {
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

    pub(crate) fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::Html => &["html", "htm"],
            Self::Markdown => &["md", "markdown"],
            Self::Text => &["txt", "text"],
            Self::Rtf => &["rtf"],
        }
    }

    pub(crate) fn is_editable(self) -> bool {
        Self::EDITABLE.contains(&self)
    }
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDoc {
    pub(crate) token: u64,
    pub(crate) name: String,
    pub(crate) format: &'static str,
    pub(crate) content: String,
    /// The document ID of a PaperPad file, if it has one.
    pub(crate) doc_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDoc {
    pub(crate) token: u64,
    pub(crate) name: String,
    pub(crate) format: &'static str,
    /// Set when the version archive could not be written.
    pub(crate) warning: Option<String>,
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
    /// The content is base64: an image under word/media.
    #[serde(default)]
    base64: bool,
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
pub(crate) fn clean_stem(name: &str) -> String {
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

/// A document's bytes as text, without the byte order mark some editors add.
pub(crate) fn decode_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.strip_prefix('\u{feff}').unwrap_or(&text).to_string()
}

/// Reads a document as text, with the fingerprint of the bytes on disk.
fn read_file(path: &Path) -> CmdResult<(String, Fingerprint)> {
    let meta = fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a regular file".into());
    }
    if meta.len() as usize > MAX_DOC_BYTES {
        return Err("File is larger than 32 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read file: {e}"))?;
    Ok((decode_text(&bytes), fingerprint(&bytes)))
}

fn read_text(path: &Path) -> CmdResult<String> {
    read_file(path).map(|(text, _)| text)
}

/// True when the file on disk is not what PaperPad last read or wrote: another
/// program, or another computer through a cloud app, changed it since.
fn changed_on_disk(state: &AppState, token: u64, path: &Path) -> bool {
    let Some(known) = state.known(token) else { return false };
    if !path.is_file() {
        return false;
    }
    match fs::metadata(path) {
        Ok(m) if m.len() as usize <= MAX_DOC_BYTES * 2 => fs::read(path).map_or(true, |b| fingerprint(&b) != known),
        _ => true,
    }
}

/// Writes through a temporary sibling file, flushes it to disk, then renames
/// it over the destination. Rename is atomic on the same volume.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> CmdResult<()> {
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

pub(crate) fn check_size(content: &str) -> CmdResult<()> {
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
    let (content, print) = read_file(&path)?;
    state.touch_recent(&path);
    let doc_id = if format == Format::Html { archive::extract_doc_id(&content) } else { None };
    let name = file_name(&path);
    let token = state.issue_token(path);
    state.set_known(token, print);
    state.set_doc_id(token, doc_id.clone());
    Ok(OpenedDoc { name, format: format.name(), content, doc_id, token })
}

/// A native file dialog for this window. On desktop it is attached to the
/// window (modal, centered on it); Android dialogs have no parent window.
fn file_dialog(window: &Window) -> FileDialogBuilder<tauri::Wry> {
    let dialog = window.dialog().file();
    #[cfg(desktop)]
    let dialog = dialog.set_parent(window);
    dialog
}

/// The path of the file the user picked, or None when they cancelled.
///
/// A pick that is not a filesystem path (an Android `content://` URI) is an
/// error, never a cancel: treated as a cancel, Save would look like it worked
/// and the user would think the document was saved. On desktop the dialog
/// always returns a path.
fn picked_path(picked: Option<FilePath>) -> CmdResult<Option<PathBuf>> {
    picked
        .map(|p| p.into_path().map_err(|_| "PaperPad cannot use this location yet. Nothing was read or written.".to_string()))
        .transpose()
}

/// Shows a native Save dialog for one file type. Returns None when the user cancels.
fn save_dialog(window: &Window, title: &str, label: &str, extensions: &[&str], suggested: &str, start: Option<PathBuf>) -> CmdResult<Option<PathBuf>> {
    let mut dialog = file_dialog(window)
        .set_title(title)
        .set_file_name(format!("{}.{}", clean_stem(suggested), extensions[0]))
        .add_filter(label, extensions);
    if let Some(dir) = start {
        dialog = dialog.set_directory(dir);
    }
    Ok(picked_path(dialog.blocking_save_file())?.map(|path| ensure_extension(path, extensions)))
}

fn save_dialog_for(window: &Window, format: Format, suggested: &str, start: Option<PathBuf>) -> CmdResult<Option<PathBuf>> {
    save_dialog(window, "Save as", format.label(), format.extensions(), suggested, start)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Shows the native Open dialog. Returns None when the user cancels.
// Android: android_io::open_document.
#[cfg(desktop)]
#[tauri::command]
pub async fn open_document(window: Window, state: State<'_, AppState>) -> CmdResult<Option<OpenedDoc>> {
    let all: Vec<&str> = Format::EDITABLE.iter().flat_map(|f| f.extensions().iter().copied()).collect();
    let mut dialog = file_dialog(&window).set_title("Open").add_filter("All supported", &all);
    for f in Format::EDITABLE {
        dialog = dialog.add_filter(f.label(), f.extensions());
    }
    if let Some(dir) = state.documents_dir() {
        dialog = dialog.set_directory(dir);
    }
    let picked = dialog.blocking_pick_file();
    let Some(path) = picked_path(picked)? else {
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

/// Writes a copy of what is about to be saved to the version archive. A
/// problem here never stops the save: it comes back as a warning to show.
pub(crate) fn archive_copy(state: &AppState, doc: archive::Doc, bytes: &[u8], auto: bool, keep: u32) -> Result<(), String> {
    let data_dir = state.data_dir().ok_or("No app data folder")?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    archive::snapshot(&data_dir, doc, bytes, auto, keep as usize, now).map(|_| ())
}

/// The warning shown when the archive failed but the save itself went through.
pub(crate) fn archive_warning(result: Result<(), String>) -> Option<String> {
    result.err().map(|e| format!("Saved, but the version history could not be written: {e}"))
}

/// The ID in a PaperPad file's content. Other formats have none.
pub(crate) fn doc_id_of(format: Format, content: &str) -> Option<String> {
    if format == Format::Html {
        archive::extract_doc_id(content)
    } else {
        None
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    /// The file on disk changed since PaperPad read or wrote it, so nothing was written.
    pub(crate) conflict: bool,
    /// Set when the version archive could not be written.
    pub(crate) warning: Option<String>,
}

/// Saves in place to a file the user opened or saved earlier in this session.
/// The version archive is written first, then the file. `auto` marks an
/// autosave, which is archived less often.
///
/// If the file on disk is no longer what PaperPad last read or wrote (another
/// computer saved it through a cloud app, say), nothing is written and the
/// outcome says so. With `force` the file is replaced anyway, but its content
/// is kept in the version archive first.
// Android: android_io::save_document.
#[cfg(desktop)]
#[tauri::command]
pub async fn save_document(
    token: u64,
    content: String,
    auto: bool,
    keep: u32,
    force: bool,
    state: State<'_, AppState>,
) -> CmdResult<SaveOutcome> {
    check_size(&content)?;
    let path = state.path_for(token).ok_or("Unknown document")?;
    let format = Format::from_path(&path).ok_or("Unsupported file type")?;
    if !format.is_editable() {
        return Err("This format can only be exported".into());
    }
    let id = doc_id_of(format, &content);
    let doc = archive::Doc { path: &path, id: id.as_deref() };
    if changed_on_disk(&state, token, &path) {
        if !force {
            return Ok(SaveOutcome { conflict: true, warning: None });
        }
        // Keep what is about to be replaced. If that fails, do not replace it.
        let theirs = fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
        let old_id = state.doc_id(token);
        let old_doc = archive::Doc { path: &path, id: old_id.as_deref().or(doc.id) };
        archive_copy(&state, old_doc, &theirs, false, keep).map_err(|e| format!("Could not keep the other version first: {e}"))?;
    }
    let warning = archive_warning(archive_copy(&state, doc, content.as_bytes(), auto, keep));
    write_atomic(&path, content.as_bytes())?;
    state.set_known(token, fingerprint(content.as_bytes()));
    state.set_doc_id(token, id);
    state.touch_recent(&path);
    Ok(SaveOutcome { conflict: false, warning })
}

/// True when the open file was changed on disk by someone else. Async so that
/// reading and hashing a large file does not block the main thread.
// Android: android_io::check_external_change.
#[cfg(desktop)]
#[tauri::command]
pub async fn check_external_change(token: u64, state: State<'_, AppState>) -> CmdResult<bool> {
    Ok(state.path_for(token).is_some_and(|path| changed_on_disk(&state, token, &path)))
}

/// Before a reload replaces the open file, keeps the content PaperPad last
/// read or wrote in the version archive. An autosave may not have archived it
/// (one version per 5 minutes), and the file on disk no longer holds it.
/// `previous` counts only when it is exactly that content (same fingerprint):
/// the webview cannot put anything else in the archive this way.
fn keep_previous(state: &AppState, token: u64, path: &Path, previous: &str, keep: u32) -> CmdResult<()> {
    check_size(previous)?;
    if previous.is_empty() || state.known(token) != Some(fingerprint(previous.as_bytes())) {
        return Ok(());
    }
    let id = state.doc_id(token);
    archive_copy(state, archive::Doc { path, id: id.as_deref() }, previous.as_bytes(), false, keep)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadedDoc {
    pub(crate) content: String,
    pub(crate) doc_id: Option<String>,
}

/// Reads the open file again, after it changed on disk. The token stays the same.
/// `previous` is the document as last saved in the editor: it is archived first
/// (see `keep_previous`), and if that fails nothing is reloaded.
// Android: android_io::reload_document.
#[cfg(desktop)]
#[tauri::command]
pub async fn reload_document(token: u64, previous: String, keep: u32, state: State<'_, AppState>) -> CmdResult<ReloadedDoc> {
    let path = state.path_for(token).ok_or("Unknown document")?;
    let format = Format::from_path(&path).filter(|f| f.is_editable()).ok_or("Unsupported file type")?;
    keep_previous(&state, token, &path, &previous, keep)?;
    let (content, print) = read_file(&path)?;
    let doc_id = doc_id_of(format, &content);
    state.set_known(token, print);
    state.set_doc_id(token, doc_id.clone());
    Ok(ReloadedDoc { content, doc_id })
}

/// Saves the user's version as a new file next to the original, named
/// `<name> (conflict <date>).<ext>`, and leaves the original untouched. The
/// returned token is the new file's: the editor continues with it.
// Android: android_io::save_conflict_copy.
#[cfg(desktop)]
#[tauri::command]
pub async fn save_conflict_copy(token: u64, content: String, state: State<'_, AppState>) -> CmdResult<SavedDoc> {
    check_size(&content)?;
    let original = state.path_for(token).ok_or("Unknown document")?;
    let format = Format::from_path(&original).filter(|f| f.is_editable()).ok_or("Unsupported file type")?;
    let dir = original.parent().ok_or("Invalid destination")?;
    let stem = original.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into());
    let ext = original.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| format.extensions()[0].into());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let label = archive::stamp(now);
    let path = (1..100)
        .map(|n| if n == 1 { format!("{stem} (conflict {label}).{ext}") } else { format!("{stem} (conflict {label} {n}).{ext}") })
        .map(|name| dir.join(name))
        .find(|p| !p.exists())
        .ok_or("Too many conflict copies")?;
    write_atomic(&path, content.as_bytes())?;
    state.touch_recent(&path);
    let doc_id = doc_id_of(format, &content);
    let name = file_name(&path);
    let new_token = state.issue_token(path);
    state.set_known(new_token, fingerprint(content.as_bytes()));
    state.set_doc_id(new_token, doc_id);
    Ok(SavedDoc { name, format: format.name(), token: new_token, warning: None })
}

/// Save As always produces the native format (HTML).
// Android: android_io::save_document_as.
#[cfg(desktop)]
#[tauri::command]
pub async fn save_document_as(
    window: Window,
    content: String,
    suggested_name: String,
    keep: u32,
    state: State<'_, AppState>,
) -> CmdResult<Option<SavedDoc>> {
    check_size(&content)?;
    let Some(path) = save_dialog_for(&window, Format::Html, &suggested_name, state.documents_dir())? else {
        return Ok(None);
    };
    let id = doc_id_of(Format::Html, &content);
    let warning = archive_warning(archive_copy(&state, archive::Doc { path: &path, id: id.as_deref() }, content.as_bytes(), false, keep));
    write_atomic(&path, content.as_bytes())?;
    state.touch_recent(&path);
    let name = file_name(&path);
    let token = state.issue_token(path);
    state.set_known(token, fingerprint(content.as_bytes()));
    state.set_doc_id(token, id);
    Ok(Some(SavedDoc { name, format: Format::Html.name(), token, warning }))
}

// ---- documents folder -------------------------------------------------------

/// Only the folder's own name leaves Rust, never its path.
fn folder_label(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned())
}

/// The name of the documents folder, or None when none is chosen or it is gone.
#[tauri::command]
pub fn get_documents_folder(state: State<'_, AppState>) -> Option<String> {
    state.documents_dir().map(|d| folder_label(&d))
}

/// Shows the native folder picker and remembers the choice. Returns the new
/// folder's name, or None when the user cancels.
///
/// Desktop only: the dialog plugin has no folder picker on Android, so this
/// command is neither compiled nor registered there (see ANDROID.md).
#[cfg(desktop)]
#[tauri::command]
pub async fn choose_documents_folder(window: Window, state: State<'_, AppState>) -> CmdResult<Option<String>> {
    let mut dialog = file_dialog(&window).set_title("Choose your PaperPad folder");
    if let Some(dir) = state.documents_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(dir) = dialog.blocking_pick_folder().and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    if !dir.is_dir() {
        return Err("That is not a folder".into());
    }
    let label = folder_label(&dir);
    state.set_documents_dir(Some(dir));
    Ok(Some(label))
}

#[tauri::command]
pub fn clear_documents_folder(state: State<'_, AppState>) {
    state.set_documents_dir(None);
}

// ---- version history --------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    id: String,
    /// Milliseconds since 1970, for the webview to show in local time.
    time_ms: u64,
    bytes: u64,
}

/// The saved versions of a document, newest first.
pub(crate) fn versions_of(state: &AppState, doc: archive::Doc) -> CmdResult<Vec<VersionEntry>> {
    let data_dir = state.data_dir().ok_or("No app data folder")?;
    Ok(archive::list(&data_dir, doc)
        .into_iter()
        .map(|v| VersionEntry { id: v.id, time_ms: v.time * 1000, bytes: v.bytes })
        .collect())
}

/// The content of one saved version of a document.
pub(crate) fn version_text(state: &AppState, doc: archive::Doc, id: &str) -> CmdResult<String> {
    let data_dir = state.data_dir().ok_or("No app data folder")?;
    let bytes = archive::read(&data_dir, doc, id).ok_or("That version no longer exists")?;
    Ok(decode_text(&bytes))
}

/// The saved versions of an open document, newest first.
// Android: android_io::list_versions.
#[cfg(desktop)]
#[tauri::command]
pub fn list_versions(token: u64, state: State<'_, AppState>) -> CmdResult<Vec<VersionEntry>> {
    let path = state.path_for(token).ok_or("Unknown document")?;
    let id = state.doc_id(token);
    versions_of(&state, archive::Doc { path: &path, id: id.as_deref() })
}

/// The content of one saved version. The webview decides what to do with it;
/// nothing is written until the user saves.
// Android: android_io::read_version.
#[cfg(desktop)]
#[tauri::command]
pub async fn read_version(token: u64, id: String, state: State<'_, AppState>) -> CmdResult<String> {
    let path = state.path_for(token).ok_or("Unknown document")?;
    let doc_id = state.doc_id(token);
    version_text(&state, archive::Doc { path: &path, id: doc_id.as_deref() }, &id)
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
    let Some(path) = save_dialog_for(&window, format, &suggested_name, None)? else {
        return Ok(None);
    };
    write_atomic(&path, content.as_bytes())?;
    Ok(Some(file_name(&path)))
}

/// Package part names a .docx produced by PaperPad may contain
/// (src/export/docx.ts; tests/export.test.ts checks the two stay in sync).
const DOCX_PARTS: &[&str] = &[
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/core.xml",
    "docProps/app.xml",
    "word/document.xml",
    "word/styles.xml",
    "word/numbering.xml",
    "word/footer1.xml",
    "word/_rels/document.xml.rels",
];

/// An image part as src/export/docx.ts names them: word/media/image<n>.png or .jpeg.
fn is_media_part(name: &str) -> bool {
    let Some((n, ext)) = name.strip_prefix("word/media/image").and_then(|r| r.split_once('.')) else {
        return false;
    };
    (1..=5).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit()) && matches!(ext, "png" | "jpeg")
}

#[tauri::command]
pub async fn export_docx(window: Window, parts: Vec<ZipPart>, suggested_name: String) -> CmdResult<Option<String>> {
    let total: usize = parts.iter().map(|p| p.content.len()).sum();
    if total > MAX_DOC_BYTES * 2 {
        return Err("Document too large".into());
    }
    // XML parts come from the fixed list; only images are base64 and only under word/media.
    let allowed = |p: &ZipPart| if p.base64 { is_media_part(&p.name) } else { DOCX_PARTS.contains(&p.name.as_str()) };
    if !parts.iter().all(allowed) {
        return Err("Unexpected package part".into());
    }
    let data = parts
        .iter()
        .map(|p| {
            if p.base64 {
                base64::decode(&p.content).map(Cow::Owned).ok_or("Invalid image data")
            } else {
                Ok(Cow::Borrowed(p.content.as_bytes()))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    let entries: Vec<(&str, &[u8])> = parts.iter().zip(&data).map(|(p, d)| (p.name.as_str(), d.as_ref())).collect();
    let bytes = zip::build(&entries)?;

    let Some(path) = save_dialog(&window, "Export as Word document", "Word document", &["docx"], &suggested_name, None)? else {
        return Ok(None);
    };
    write_atomic(&path, &bytes)?;
    Ok(Some(file_name(&path)))
}

// ---- images -----------------------------------------------------------------

/// The image types the webview can decode, recognized by their first bytes.
pub(crate) fn is_image(b: &[u8]) -> bool {
    b.starts_with(b"\x89PNG\r\n\x1a\n")
        || b.starts_with(&[0xff, 0xd8, 0xff])
        || b.starts_with(b"GIF8")
        || (b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP"))
        || b.starts_with(b"BM")
}

/// Shows the native Open dialog for an image and returns its bytes, never
/// its path. The webview scales and converts it (src/ui/image-import.ts)
/// and stores it in the document. Empty bytes mean the user cancelled.
// Android: android_io::pick_image.
#[cfg(desktop)]
#[tauri::command]
pub async fn pick_image(window: Window) -> CmdResult<Response> {
    let picked = file_dialog(&window)
        .set_title("Add image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file();
    let Some(path) = picked_path(picked)? else {
        return Ok(Response::new(Vec::new()));
    };
    let meta = fs::metadata(&path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a regular file".into());
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("The image is larger than 32 MB".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Cannot read file: {e}"))?;
    if !is_image(&bytes) {
        return Err("This is not a PNG, JPEG, GIF, WebP or BMP image".into());
    }
    Ok(Response::new(bytes))
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
    fn formats_are_found_by_name_and_extension() {
        assert!(Format::from_name("md") == Some(Format::Markdown));
        assert!(Format::from_name("docx").is_none());
        assert!(Format::from_path(Path::new("a/Notes.HTM")) == Some(Format::Html));
        assert!(Format::from_path(Path::new("notes.text")) == Some(Format::Text));
        assert!(Format::from_path(Path::new("notes.rtf")).is_some_and(|f| !f.is_editable()));
        assert!(Format::from_path(Path::new("notes")).is_none());
    }

    #[test]
    fn only_numbered_png_and_jpeg_media_parts_are_allowed() {
        assert!(is_media_part("word/media/image1.png"));
        assert!(is_media_part("word/media/image12.jpeg"));
        for bad in ["word/media/image.png", "word/media/image1.svg", "word/media/image1.png/../x", "word/media/imageA.png", "word/media/image123456.png", "word/document.xml"] {
            assert!(!is_media_part(bad), "{bad}");
        }
    }

    #[test]
    fn images_are_recognized_by_their_first_bytes() {
        assert!(is_image(b"\x89PNG\r\n\x1a\nrest"));
        assert!(is_image(&[0xff, 0xd8, 0xff, 0xe0]));
        assert!(is_image(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!is_image(b"<svg xmlns="));
        assert!(!is_image(b"RIFF\0\0\0\0WAVE"));
    }

    #[test]
    fn a_file_changed_behind_our_back_is_noticed() {
        let dir = std::env::temp_dir().join(format!("paperpad-changed-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.html");
        fs::write(&path, b"mine").unwrap();
        let state = AppState::default();
        let token = state.issue_token(path.clone());
        // Nothing known about the file yet: nothing to compare.
        assert!(!changed_on_disk(&state, token, &path));
        state.set_known(token, fingerprint(b"mine"));
        assert!(!changed_on_disk(&state, token, &path));
        // Another computer saved it through the cloud app.
        fs::write(&path, b"theirs").unwrap();
        assert!(changed_on_disk(&state, token, &path));
        // Once we have read or written it again, it is the known file.
        state.set_known(token, fingerprint(b"theirs"));
        assert!(!changed_on_disk(&state, token, &path));
        // A file that is gone is not a conflict: saving just writes it again.
        fs::remove_file(&path).unwrap();
        assert!(!changed_on_disk(&state, token, &path));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_reload_keeps_what_paperpad_last_wrote() {
        let dir = std::env::temp_dir().join(format!("paperpad-reload-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.html");
        let state = AppState::default();
        state.set_data_dir(dir.join("data"));
        let token = state.issue_token(path.clone());
        let doc = archive::Doc { path: &path, id: None };
        // Saved once (archived), then autosaved within 5 minutes (not archived).
        archive_copy(&state, doc, b"one", false, 50).unwrap();
        archive_copy(&state, doc, b"two", true, 50).unwrap();
        state.set_known(token, fingerprint(b"two"));
        fs::write(&path, b"theirs").unwrap();
        // Content that is not what PaperPad wrote is ignored.
        keep_previous(&state, token, &path, "forged", 50).unwrap();
        let data = state.data_dir().unwrap();
        assert_eq!(archive::list(&data, doc).len(), 1);
        keep_previous(&state, token, &path, "two", 50).unwrap();
        let versions = archive::list(&data, doc);
        assert_eq!(versions.len(), 2);
        assert_eq!(archive::read(&data, doc, &versions[0].id).as_deref(), Some(&b"two"[..]));
        // Already archived: not repeated.
        keep_previous(&state, token, &path, "two", 50).unwrap();
        assert_eq!(archive::list(&data, doc).len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pick_that_is_not_a_path_is_an_error_not_a_cancel() {
        assert_eq!(picked_path(None), Ok(None));
        let path = std::env::temp_dir().join("a.html");
        assert_eq!(picked_path(Some(FilePath::Path(path.clone()))), Ok(Some(path)));
        let uri = FilePath::Url("content://com.android.providers.downloads.documents/document/msf%3A1".parse().unwrap());
        assert!(picked_path(Some(uri)).is_err());
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
