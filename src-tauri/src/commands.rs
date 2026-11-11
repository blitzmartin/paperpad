//! Commands callable from the webview. Each one is granted individually in
//! capabilities/default.json (see build.rs).
//!
//! Rules every command follows:
//! - paths come only from native dialogs or from the recent list, never from JS;
//! - inputs are size-limited and format names are matched against a closed set;
//! - writes are atomic (temp file + rename) so a crash never truncates a document.

use std::borrow::Cow;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::base64;
use crate::state::AppState;
use crate::zip;

/// Largest document we read or write. Text alone rarely passes 1 MiB; the
/// rest is room for images, which are stored in the document (base64).
/// MAX_DOC_CHARS in src/editor/image.ts must match.
const MAX_DOC_BYTES: usize = 32 * 1024 * 1024;
/// Largest image file that can be added. The webview scales it down first.
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

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
    const ALL: [Self; 4] = [Self::Html, Self::Markdown, Self::Text, Self::Rtf];
    /// Formats PaperPad can open and save back in place.
    const EDITABLE: [Self; 3] = [Self::Html, Self::Markdown, Self::Text];

    fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|f| f.name() == name)
    }

    fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        Self::ALL.into_iter().find(|f| f.extensions().contains(&ext.as_str()))
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
            Self::Text => &["txt", "text"],
            Self::Rtf => &["rtf"],
        }
    }

    fn is_editable(self) -> bool {
        Self::EDITABLE.contains(&self)
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
        return Err("File is larger than 32 MB".into());
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

/// Shows a native Save dialog for one file type. Returns None when the user cancels.
fn save_dialog(window: &Window, title: &str, label: &str, extensions: &[&str], suggested: &str) -> Option<PathBuf> {
    let path = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .set_file_name(format!("{}.{}", clean_stem(suggested), extensions[0]))
        .add_filter(label, extensions)
        .blocking_save_file()?
        .into_path()
        .ok()?;
    Some(ensure_extension(path, extensions))
}

fn save_dialog_for(window: &Window, format: Format, suggested: &str) -> Option<PathBuf> {
    save_dialog(window, "Save as", format.label(), format.extensions(), suggested)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Shows the native Open dialog. Returns None when the user cancels.
#[tauri::command]
pub async fn open_document(window: Window, state: State<'_, AppState>) -> CmdResult<Option<OpenedDoc>> {
    let all: Vec<&str> = Format::EDITABLE.iter().flat_map(|f| f.extensions().iter().copied()).collect();
    let mut dialog = window.dialog().file().set_parent(&window).set_title("Open").add_filter("All supported", &all);
    for f in Format::EDITABLE {
        dialog = dialog.add_filter(f.label(), f.extensions());
    }
    let picked = dialog.blocking_pick_file();
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
    let Some(path) = save_dialog_for(&window, Format::Html, &suggested_name) else {
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
    let Some(path) = save_dialog_for(&window, format, &suggested_name) else {
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

    let Some(path) = save_dialog(&window, "Export as Word document", "Word document", &["docx"], &suggested_name) else {
        return Ok(None);
    };
    write_atomic(&path, &bytes)?;
    Ok(Some(file_name(&path)))
}

// ---- images -----------------------------------------------------------------

/// The image types the webview can decode, recognized by their first bytes.
fn is_image(b: &[u8]) -> bool {
    b.starts_with(b"\x89PNG\r\n\x1a\n")
        || b.starts_with(&[0xff, 0xd8, 0xff])
        || b.starts_with(b"GIF8")
        || (b.starts_with(b"RIFF") && b.get(8..12) == Some(b"WEBP"))
        || b.starts_with(b"BM")
}

/// Shows the native Open dialog for an image and returns its bytes, never
/// its path. The webview scales and converts it (src/ui/image-import.ts)
/// and stores it in the document. Empty bytes mean the user cancelled.
#[tauri::command]
pub async fn pick_image(window: Window) -> CmdResult<Response> {
    let picked = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Add image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp"])
        .blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
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
    fn extension_is_appended() {
        let p = ensure_extension(PathBuf::from("/tmp/notes"), &["html", "htm"]);
        assert_eq!(p, PathBuf::from("/tmp/notes.html"));
        let p = ensure_extension(PathBuf::from("/tmp/notes.HTM"), &["html", "htm"]);
        assert_eq!(p, PathBuf::from("/tmp/notes.HTM"));
        let p = ensure_extension(PathBuf::from("/tmp/v1.2"), &["md"]);
        assert_eq!(p, PathBuf::from("/tmp/v1.2.md"));
    }
}
