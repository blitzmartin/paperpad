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

    pub fn set_data_dir(&self, dir: PathBuf) {
        if let Ok(mut d) = self.data_dir.lock() {
            *d = Some(dir);
        }
    }

    pub fn data_dir(&self) -> Option<PathBuf> {
        self.data_dir.lock().ok()?.clone()
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
