//! Process-wide state shared by the commands.
//!
//! The webview never sees a filesystem path. When the user picks a file in a
//! native dialog, Rust stores the path here and hands the frontend an opaque
//! numeric token. Later saves must present that token, so a compromised page
//! cannot ask us to write anywhere the user did not choose.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

pub const MAX_RECENT: usize = 16;

#[derive(Default)]
pub struct AppState {
    tokens: Mutex<HashMap<u64, PathBuf>>,
    next_token: AtomicU64,
    /// Mirrors the editor's "unsaved changes" flag for the close guard.
    pub dirty: AtomicBool,
    recent: Mutex<Vec<PathBuf>>,
    data_dir: Mutex<Option<PathBuf>>,
    /// The folder the user keeps their documents in (often one a sync client
    /// watches). Open and Save As dialogs start there.
    documents_dir: Mutex<Option<PathBuf>>,
    /// The document ID of each open document (from its file), keying its version history.
    doc_ids: Mutex<HashMap<u64, String>>,
    /// What each open file held when PaperPad last read or wrote it. A different
    /// file on disk later means another program or computer changed it.
    known: Mutex<HashMap<u64, Fingerprint>>,
}

/// Length and hash of a file's bytes.
pub type Fingerprint = (u64, u64);

pub fn fingerprint(bytes: &[u8]) -> Fingerprint {
    (bytes.len() as u64, crate::archive::fnv1a(bytes))
}

impl AppState {
    pub fn issue_token(&self, path: PathBuf) -> u64 {
        let token = self.next_token.fetch_add(1, Ordering::Relaxed) + 1;
        if let Ok(mut map) = self.tokens.lock() {
            map.insert(token, path);
        }
        token
    }

    pub fn path_for(&self, token: u64) -> Option<PathBuf> {
        self.tokens.lock().ok()?.get(&token).cloned()
    }

    pub fn set_doc_id(&self, token: u64, id: Option<String>) {
        if let Ok(mut map) = self.doc_ids.lock() {
            match id {
                Some(id) => map.insert(token, id),
                None => map.remove(&token),
            };
        }
    }

    pub fn doc_id(&self, token: u64) -> Option<String> {
        self.doc_ids.lock().ok()?.get(&token).cloned()
    }

    pub fn set_known(&self, token: u64, print: Fingerprint) {
        if let Ok(mut map) = self.known.lock() {
            map.insert(token, print);
        }
    }

    pub fn known(&self, token: u64) -> Option<Fingerprint> {
        self.known.lock().ok()?.get(&token).copied()
    }

    pub fn set_data_dir(&self, dir: PathBuf) {
        if let Ok(mut d) = self.data_dir.lock() {
            *d = Some(dir);
        }
    }

    pub fn data_dir(&self) -> Option<PathBuf> {
        self.data_dir.lock().ok()?.clone()
    }

    // ---- documents folder --------------------------------------------------

    pub fn load_documents_dir(&self) {
        let Some(file) = self.data_dir().map(|d| d.join("documents-folder.json")) else { return };
        let Ok(text) = std::fs::read_to_string(file) else { return };
        let Ok(dir) = serde_json::from_str::<PathBuf>(&text) else { return };
        if let Ok(mut d) = self.documents_dir.lock() {
            *d = Some(dir);
        }
    }

    /// The chosen folder, only while it still exists.
    pub fn documents_dir(&self) -> Option<PathBuf> {
        self.documents_dir.lock().ok()?.clone().filter(|d| d.is_dir())
    }

    pub fn set_documents_dir(&self, dir: Option<PathBuf>) {
        if let Ok(mut d) = self.documents_dir.lock() {
            *d = dir.clone();
        }
        let Some(data) = self.data_dir() else { return };
        let file = data.join("documents-folder.json");
        match dir {
            Some(dir) => {
                if std::fs::create_dir_all(&data).is_ok() {
                    if let Ok(json) = serde_json::to_string(&dir) {
                        let _ = std::fs::write(file, json);
                    }
                }
            }
            None => {
                let _ = std::fs::remove_file(file);
            }
        }
    }

    // ---- recent files ------------------------------------------------------

    pub fn load_recent(&self) {
        let Some(file) = self.data_dir().map(|d| d.join("recent.json")) else { return };
        let Ok(text) = std::fs::read_to_string(file) else { return };
        let Ok(list) = serde_json::from_str::<Vec<PathBuf>>(&text) else { return };
        if let Ok(mut recent) = self.recent.lock() {
            *recent = list.into_iter().take(MAX_RECENT).collect();
        }
    }

    fn persist_recent(&self, list: &[PathBuf]) {
        let Some(dir) = self.data_dir() else { return };
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        if let Ok(json) = serde_json::to_string(list) {
            let _ = std::fs::write(dir.join("recent.json"), json);
        }
    }

    pub fn touch_recent(&self, path: &Path) {
        let snapshot = {
            let Ok(mut recent) = self.recent.lock() else { return };
            recent.retain(|p| p != path);
            recent.insert(0, path.to_path_buf());
            recent.truncate(MAX_RECENT);
            recent.clone()
        };
        self.persist_recent(&snapshot);
    }

    pub fn forget_recent(&self, path: &Path) {
        let snapshot = {
            let Ok(mut recent) = self.recent.lock() else { return };
            recent.retain(|p| p != path);
            recent.clone()
        };
        self.persist_recent(&snapshot);
    }

    pub fn recent(&self) -> Vec<PathBuf> {
        self.recent.lock().map(|r| r.clone()).unwrap_or_default()
    }
}
