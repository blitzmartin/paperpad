//! Document commands for Android. Desktop works on filesystem paths
//! (commands.rs). Android pickers return `content://` URIs from the Storage
//! Access Framework, so here a small Kotlin plugin picks, creates and opens
//! documents (gen/android/app/src/main/java/com/paperboardlabs/paperpad/
//! DocumentsPlugin.kt) and Rust reads and writes them through the file
//! descriptor it hands over.
//!
//! Only the transport is separate. Formats, size limits, document IDs, the
//! version archive and the fingerprints that notice changes made elsewhere
//! are the desktop ones, so a file saved here is the same file on desktop.
//!
//! Same security model as desktop: the webview never sees a URI, only the
//! opaque tokens issued here, and the Kotlin plugin opens only URIs the user
//! chose in this session.
//!
//! Differences imposed by the Storage Access Framework:
//! - writes are not atomic (the file is truncated, then written). The version
//!   archive keeps a copy of what is written, and of the file a first save replaces;
//! - "Keep both" in a conflict asks where to save the copy, with the conflict
//!   name proposed: without a folder permission nothing can be created next
//!   to the original;
//! - a cloud provider may serve a cached copy, so a change made on another
//!   device can be noticed late.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, State, Wry};

use crate::archive;
use crate::commands::{
    archive_copy, archive_warning, check_size, clean_stem, decode_text, doc_id_of, is_image, version_text, versions_of, CmdResult,
    Format, OpenedDoc, ReloadedDoc, SaveOutcome, SavedDoc, VersionEntry, MAX_DOC_BYTES, MAX_IMAGE_BYTES,
};
use crate::state::{fingerprint, AppState, Fingerprint};

/// Registers the Kotlin plugin and the state of the open documents.
pub fn init() -> TauriPlugin<Wry> {
    Builder::new("documents")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.paperboardlabs.paperpad", "DocumentsPlugin")?;
            app.manage(Native(handle));
            app.manage(Docs::default());
            Ok(())
        })
        .build()
}

// ---------------------------------------------------------------------------
// Open documents
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct OpenFile {
    uri: String,
    /// The name the provider shows. It decides the format, as the extension does on desktop.
    name: String,
    format: Format,
    /// What the document held when PaperPad last read or wrote it.
    known: Fingerprint,
    doc_id: Option<String>,
}

impl OpenFile {
    /// The archive names a document by a path. The URI plus the file name
    /// works as one: the name gives the version files their name, the URI
    /// keeps two files with the same name apart.
    fn archive_key(&self) -> PathBuf {
        PathBuf::from(&self.uri).join(&self.name)
    }
}

#[derive(Default)]
pub struct Docs {
    next: AtomicU64,
    files: Mutex<HashMap<u64, OpenFile>>,
}

impl Docs {
    fn insert(&self, file: OpenFile) -> u64 {
        let token = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut files) = self.files.lock() {
            files.insert(token, file);
        }
        token
    }

    fn get(&self, token: u64) -> CmdResult<OpenFile> {
        self.files.lock().ok().and_then(|f| f.get(&token).cloned()).ok_or_else(|| "Unknown document".into())
    }

    fn update(&self, token: u64, known: Fingerprint, doc_id: Option<String>) {
        if let Some(file) = self.files.lock().ok().as_mut().and_then(|f| f.get_mut(&token)) {
            file.known = known;
            file.doc_id = doc_id;
        }
    }
}

// ---------------------------------------------------------------------------
// Kotlin plugin
// ---------------------------------------------------------------------------

pub struct Native(PluginHandle<Wry>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickArgs<'a> {
    mime_types: &'a [&'a str],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateArgs<'a> {
    name: &'a str,
    mime_type: &'a str,
}

#[derive(Serialize)]
struct DescriptorArgs<'a> {
    uri: &'a str,
    mode: &'a str,
}

/// No URI means the user cancelled.
#[derive(Deserialize)]
struct Chosen {
    uri: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Descriptor {
    fd: Option<i32>,
}

/// A chosen document: its URI and, when the provider reports it, its name.
type Picked = Option<(String, Option<String>)>;

impl Native {
    fn chosen(&self, command: &str, args: impl Serialize) -> CmdResult<Picked> {
        let chosen: Chosen = self.0.run_mobile_plugin(command, args).map_err(|e| format!("The file picker failed: {e}"))?;
        // A name with a slash would add a level to the archive key.
        Ok(chosen.uri.map(|uri| (uri, chosen.name.map(|n| n.replace('/', "_")))))
    }

    /// The system Open screen (ACTION_OPEN_DOCUMENT).
    fn pick(&self, mime_types: &[&str]) -> CmdResult<Picked> {
        self.chosen("pickDocument", PickArgs { mime_types })
    }

    /// The system Save screen (ACTION_CREATE_DOCUMENT). The provider creates an empty file.
    fn create(&self, name: &str, mime_type: &str) -> CmdResult<Picked> {
        self.chosen("createDocument", CreateArgs { name, mime_type })
    }

    /// `mode` is "r" or "wt" (write, truncating first): the only two the plugin accepts.
    fn file(&self, uri: &str, mode: &str) -> CmdResult<File> {
        let descriptor: Descriptor = self.0.run_mobile_plugin("openDescriptor", DescriptorArgs { uri, mode }).map_err(|e| format!("Cannot open file: {e}"))?;
        let fd = descriptor.fd.ok_or("Cannot open file")?;
        // SAFETY: the plugin detached this descriptor from its ParcelFileDescriptor
        // just now, so nothing else owns it. The File closes it on drop.
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    fn read(&self, uri: &str, limit: u64) -> CmdResult<Vec<u8>> {
        let file = self.file(uri, "r")?;
        let mut bytes = Vec::new();
        // A provider may hand out a pipe, whose size is unknown up front: read
        // one byte past the limit to tell a file that is too large.
        file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| format!("Cannot read file: {e}"))?;
        if bytes.len() as u64 > limit {
            return Err(format!("File is larger than {} MB", limit / (1024 * 1024)));
        }
        Ok(bytes)
    }

    fn write(&self, uri: &str, bytes: &[u8]) -> CmdResult<()> {
        if bytes.len() > MAX_DOC_BYTES * 2 {
            return Err("Document too large".into());
        }
        let fail = |e: std::io::Error| format!("Cannot write file: {e}");
        let mut file = self.file(uri, "wt")?;
        file.write_all(bytes).map_err(fail)?;
        // Some providers ignore the "t" of "wt" and keep the tail of a longer
        // old version. Cutting it is harmless when they did not. A pipe cannot
        // be cut, but it has no old tail either.
        let _ = file.set_len(bytes.len() as u64);
        match file.sync_all() {
            // A pipe cannot be synced: the provider stores what it received when it is closed.
            Err(e) if e.kind() != std::io::ErrorKind::InvalidInput => Err(fail(e)),
            _ => Ok(()),
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// How much of a document is read to compare it, as on desktop.
const COMPARE_LIMIT: u64 = MAX_DOC_BYTES as u64 * 2;

fn mime_type(format: Format) -> &'static str {
    match format {
        Format::Html => "text/html",
        Format::Markdown => "text/markdown",
        _ => "text/plain",
    }
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn archive_is_empty(state: &AppState, doc: archive::Doc) -> bool {
    state.data_dir().is_some_and(|dir| archive::list(&dir, doc).is_empty())
}

/// Asks where to create a new file, writes `content` there and returns its
/// token. With `keep`, a copy goes to the version archive first (Save As does
/// this, a conflict copy does not, as on desktop).
///
/// If the write fails, the provider keeps the empty file it created.
fn create_and_write(
    state: &AppState,
    native: &Native,
    docs: &Docs,
    format: Format,
    proposed: &str,
    content: &str,
    keep: Option<u32>,
) -> CmdResult<Option<SavedDoc>> {
    let Some((uri, name)) = native.create(proposed, mime_type(format))? else {
        return Ok(None);
    };
    let file = OpenFile {
        uri,
        name: name.unwrap_or_else(|| proposed.to_string()),
        format,
        known: fingerprint(content.as_bytes()),
        doc_id: doc_id_of(format, content),
    };
    let warning = keep.and_then(|keep| {
        let key = file.archive_key();
        archive_warning(archive_copy(state, archive::Doc { path: &key, id: file.doc_id.as_deref() }, content.as_bytes(), false, keep))
    });
    native.write(&file.uri, content.as_bytes())?;
    let name = file.name.clone();
    let token = docs.insert(file);
    Ok(Some(SavedDoc { token, name, format: format.name(), warning }))
}

// ---------------------------------------------------------------------------
// Commands (same names, arguments and results as on desktop, except
// save_conflict_copy, which can be cancelled here)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn open_document(native: State<'_, Native>, docs: State<'_, Docs>) -> CmdResult<Option<OpenedDoc>> {
    // Every file type: Android reports Markdown under several MIME types, or
    // none. The name decides, as the extension does on desktop.
    let Some((uri, name)) = native.pick(&["*/*"])? else {
        return Ok(None);
    };
    let name = name.ok_or("This file has no name, so PaperPad cannot tell its type")?;
    let format = Format::from_path(Path::new(&name)).filter(|f| f.is_editable()).ok_or("Unsupported file type")?;
    let bytes = native.read(&uri, MAX_DOC_BYTES as u64)?;
    let content = decode_text(&bytes);
    let doc_id = doc_id_of(format, &content);
    let token = docs.insert(OpenFile { uri, name: name.clone(), format, known: fingerprint(&bytes), doc_id: doc_id.clone() });
    Ok(Some(OpenedDoc { token, name, format: format.name(), content, doc_id }))
}

/// Saves in place, as on desktop: if the document is no longer what PaperPad
/// last read or wrote, nothing is written unless `force` is set, and then
/// the other version is archived first.
// Six arguments from the webview, as on desktop, plus the three states.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn save_document(
    token: u64,
    content: String,
    auto: bool,
    keep: u32,
    force: bool,
    state: State<'_, AppState>,
    native: State<'_, Native>,
    docs: State<'_, Docs>,
) -> CmdResult<SaveOutcome> {
    check_size(&content)?;
    let file = docs.get(token)?;
    let key = file.archive_key();
    let id = doc_id_of(file.format, &content);
    let doc = archive::Doc { path: &key, id: id.as_deref() };
    // One read serves both the conflict check and the copy of the file that
    // a first save replaces. An unreadable file is not a conflict: the write
    // below reports the real problem.
    let theirs = native.read(&file.uri, COMPARE_LIMIT).ok();
    let changed = theirs.as_deref().is_some_and(|b| fingerprint(b) != file.known);
    let before = match theirs {
        Some(theirs) if changed => {
            if !force {
                return Ok(SaveOutcome { conflict: true, warning: None });
            }
            // Keep what is about to be replaced. If that fails, do not replace it.
            let old = archive::Doc { path: &key, id: file.doc_id.as_deref().or(doc.id) };
            archive_copy(&state, old, &theirs, false, keep).map_err(|e| format!("Could not keep the other version first: {e}"))?;
            Ok(())
        }
        // archive::snapshot keeps the replaced file on a first save by reading
        // its path, which a URI is not: the copy is made here instead.
        Some(theirs) if !theirs.is_empty() && archive_is_empty(&state, doc) => archive_copy(&state, doc, &theirs, false, keep),
        _ => Ok(()),
    };
    let current = archive_copy(&state, doc, content.as_bytes(), auto, keep);
    let warning = archive_warning(before.and(current));
    native.write(&file.uri, content.as_bytes())?;
    docs.update(token, fingerprint(content.as_bytes()), id);
    Ok(SaveOutcome { conflict: false, warning })
}

/// Save As always produces the native format (HTML).
#[tauri::command]
pub async fn save_document_as(
    content: String,
    suggested_name: String,
    keep: u32,
    state: State<'_, AppState>,
    native: State<'_, Native>,
    docs: State<'_, Docs>,
) -> CmdResult<Option<SavedDoc>> {
    check_size(&content)?;
    let proposed = format!("{}.html", clean_stem(&suggested_name));
    create_and_write(&state, &native, &docs, Format::Html, &proposed, &content, Some(keep))
}

#[tauri::command]
pub async fn check_external_change(token: u64, native: State<'_, Native>, docs: State<'_, Docs>) -> CmdResult<bool> {
    let Ok(file) = docs.get(token) else { return Ok(false) };
    Ok(native.read(&file.uri, COMPARE_LIMIT).is_ok_and(|b| fingerprint(&b) != file.known))
}

/// Reads the open document again. As on desktop, `previous` is archived first
/// when it is exactly what PaperPad last read or wrote, and if that fails
/// nothing is reloaded.
#[tauri::command]
pub async fn reload_document(
    token: u64,
    previous: String,
    keep: u32,
    state: State<'_, AppState>,
    native: State<'_, Native>,
    docs: State<'_, Docs>,
) -> CmdResult<ReloadedDoc> {
    check_size(&previous)?;
    let file = docs.get(token)?;
    if !previous.is_empty() && fingerprint(previous.as_bytes()) == file.known {
        let key = file.archive_key();
        archive_copy(&state, archive::Doc { path: &key, id: file.doc_id.as_deref() }, previous.as_bytes(), false, keep)?;
    }
    let bytes = native.read(&file.uri, MAX_DOC_BYTES as u64)?;
    let content = decode_text(&bytes);
    let doc_id = doc_id_of(file.format, &content);
    docs.update(token, fingerprint(&bytes), doc_id.clone());
    Ok(ReloadedDoc { content, doc_id })
}

/// "Keep both": asks where to save the user's version, proposing
/// `<name> (conflict <date>).<ext>`. The original stays untouched and the
/// editor continues with the new file. None when the user cancels.
#[tauri::command]
pub async fn save_conflict_copy(
    token: u64,
    content: String,
    state: State<'_, AppState>,
    native: State<'_, Native>,
    docs: State<'_, Docs>,
) -> CmdResult<Option<SavedDoc>> {
    check_size(&content)?;
    let file = docs.get(token)?;
    let name = Path::new(&file.name);
    let stem = name.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into());
    let ext = name.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| file.format.extensions()[0].into());
    let proposed = format!("{stem} (conflict {}).{ext}", archive::stamp(now()));
    create_and_write(&state, &native, &docs, file.format, &proposed, &content, None)
}

#[tauri::command]
pub fn list_versions(token: u64, state: State<'_, AppState>, docs: State<'_, Docs>) -> CmdResult<Vec<VersionEntry>> {
    let file = docs.get(token)?;
    let key = file.archive_key();
    versions_of(&state, archive::Doc { path: &key, id: file.doc_id.as_deref() })
}

#[tauri::command]
pub async fn read_version(token: u64, id: String, state: State<'_, AppState>, docs: State<'_, Docs>) -> CmdResult<String> {
    let file = docs.get(token)?;
    let key = file.archive_key();
    version_text(&state, archive::Doc { path: &key, id: file.doc_id.as_deref() }, &id)
}

/// Returns the bytes of an image the user picks, never its URI. Empty bytes
/// mean the user cancelled.
#[tauri::command]
pub async fn pick_image(native: State<'_, Native>) -> CmdResult<Response> {
    let Some((uri, _)) = native.pick(&["image/*"])? else {
        return Ok(Response::new(Vec::new()));
    };
    let bytes = native.read(&uri, MAX_IMAGE_BYTES)?;
    if !is_image(&bytes) {
        return Err("This is not a PNG, JPEG, GIF, WebP or BMP image".into());
    }
    Ok(Response::new(bytes))
}
