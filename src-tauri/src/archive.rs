//! Version archive. Every save also writes a copy of the saved content as
//! `<name>_<YYYYMMDD-HHMMSS>.<ext>` (UTC) in PaperPad's own data folder, one
//! folder per document, before the real file is written.
//!
//! A PaperPad `.html` file carries a document ID (`data-id` on its article
//! element). The folder is named after the ID, so the history follows the
//! document when it is renamed or moved. Files without an ID (Markdown, text,
//! old PaperPad files) use a folder named after the path instead.
//!
//! The archive lives outside the folder of the document on purpose: a folder
//! that a sync client watches stays free of history files, and every computer
//! keeps its own history. The webview never sees a path. It names a version
//! only by its id (the timestamp), which is checked against a strict pattern.

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::write_atomic;

/// Autosave writes at most one new version in this many seconds.
pub const AUTO_INTERVAL_SECS: u64 = 300;
/// Bounds for the number of versions kept per document.
pub const MIN_KEEP: usize = 5;
pub const MAX_KEEP: usize = 500;

/// A document as the archive sees it: where it is now and, if it has one, its ID.
#[derive(Clone, Copy)]
pub struct Doc<'a> {
    pub path: &'a Path,
    pub id: Option<&'a str>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Version {
    /// `YYYYMMDD-HHMMSS`, plus `-NN` when two versions share a second.
    pub id: String,
    /// Seconds since 1970 when the version was written.
    pub time: u64,
    pub bytes: u64,
    /// File name inside the document's archive folder.
    file: String,
}

/// FNV-1a. Stable across releases, unlike `DefaultHasher`.
pub fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3))
}

/// A lowercase UUID such as `crypto.randomUUID()` makes. Nothing else can name a folder.
pub fn valid_uuid(s: &str) -> bool {
    s.len() == 36
        && s.bytes().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
        })
}

/// The document ID stored in the article element of a PaperPad file, if any.
pub fn extract_doc_id(html: &str) -> Option<String> {
    let start = html.find("<article class=\"paperpad\"")?;
    let tag = &html[start..];
    let tag = &tag[..tag.find('>')?];
    let id = tag.split(" data-id=\"").nth(1)?.get(..36)?;
    valid_uuid(id).then(|| id.to_string())
}

/// The folder that holds the versions of one document.
pub fn doc_dir(data_dir: &Path, doc: Doc) -> PathBuf {
    let archive = data_dir.join("archive");
    if let Some(id) = doc.id.filter(|id| valid_uuid(id)) {
        return archive.join(id);
    }
    // No ID: a readable name plus a hash of the full path, so two files
    // called "Notes" do not share history.
    let stem: String = base_name(doc.path).chars().filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_')).take(60).collect();
    let stem = if stem.trim().is_empty() { "Untitled".to_string() } else { stem.trim().to_string() };
    let mut key = doc.path.to_string_lossy().into_owned();
    if cfg!(windows) {
        key = key.to_lowercase();
    }
    archive.join(format!("{stem}-{:08x}", fnv1a(key.as_bytes()) as u32))
}

fn extension(doc: Doc) -> String {
    doc.path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "html".into())
}

fn base_name(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Civil date and time (UTC) from seconds since 1970 (Howard Hinnant's algorithm).
pub fn stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}{month:02}{day:02}-{:02}{:02}{:02}", rem / 3_600, rem % 3_600 / 60, rem % 60)
}

/// `YYYYMMDD-HHMMSS` with an optional `-NN`: nothing else can name a version.
pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    let digits = |r: std::ops::Range<usize>| b.get(r).is_some_and(|s| s.iter().all(u8::is_ascii_digit));
    (b.len() == 15 || b.len() == 18) && digits(0..8) && b[8] == b'-' && digits(9..15) && (b.len() == 15 || (b[15] == b'-' && digits(16..18)))
}

fn version_file(doc: Doc, id: &str) -> String {
    format!("{}_{id}.{}", base_name(doc.path), extension(doc))
}

/// All versions of a document, newest first. Any `<name>_<id>.<ext>` file in
/// the document's folder counts, so a renamed document keeps its history.
pub fn list(data_dir: &Path, doc: Doc) -> Vec<Version> {
    let suffix = format!(".{}", extension(doc));
    let Ok(entries) = fs::read_dir(doc_dir(data_dir, doc)) else { return Vec::new() };
    let mut out: Vec<Version> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            let (_, id) = file.strip_suffix(&suffix)?.rsplit_once('_')?;
            if !valid_id(id) {
                return None;
            }
            let id = id.to_string();
            let meta = e.metadata().ok().filter(|m| m.is_file())?;
            let time = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
            Some(Version { id, time, bytes: meta.len(), file })
        })
        .collect();
    // Ids are fixed width, so the text order is the time order.
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

/// The content of one version, or None when the id is not a version of this document.
pub fn read(data_dir: &Path, doc: Doc, id: &str) -> Option<Vec<u8>> {
    if !valid_id(id) {
        return None;
    }
    let version = list(data_dir, doc).into_iter().find(|v| v.id == id)?;
    fs::read(doc_dir(data_dir, doc).join(version.file)).ok()
}

fn free_id(dir: &Path, doc: Doc, secs: u64) -> String {
    let base = stamp(secs);
    if !dir.join(version_file(doc, &base)).exists() {
        return base;
    }
    (2..100)
        .map(|n| format!("{base}-{n:02}"))
        .find(|id| !dir.join(version_file(doc, id)).exists())
        .unwrap_or_else(|| format!("{base}-99"))
}

/// Writes `content` as a new version of `doc` unless it equals the newest one,
/// or, for an autosave, the newest one is less than `AUTO_INTERVAL_SECS` old.
/// The first time, the file as it is on disk is kept too, so the content that
/// a first save replaces is not lost. Then the oldest versions beyond `keep`
/// are deleted. Returns whether a version was written.
pub fn snapshot(data_dir: &Path, doc: Doc, content: &[u8], auto: bool, keep: usize, now: u64) -> Result<bool, String> {
    let dir = doc_dir(data_dir, doc);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut versions = list(data_dir, doc);

    if versions.is_empty() {
        if let Ok(existing) = fs::read(doc.path) {
            if !existing.is_empty() && existing != content {
                let id = free_id(&dir, doc, now);
                write_atomic(&dir.join(version_file(doc, &id)), &existing)?;
                versions = list(data_dir, doc);
            }
        }
    }

    if let Some(newest) = versions.first() {
        if auto && now.saturating_sub(newest.time) < AUTO_INTERVAL_SECS {
            return Ok(false);
        }
        if newest.bytes == content.len() as u64 && read(data_dir, doc, &newest.id).as_deref() == Some(content) {
            return Ok(false);
        }
    }

    let id = free_id(&dir, doc, now);
    write_atomic(&dir.join(version_file(doc, &id)), content)?;

    let keep = keep.clamp(MIN_KEEP, MAX_KEEP);
    for old in list(data_dir, doc).into_iter().skip(keep) {
        let _ = fs::remove_file(dir.join(old.file));
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("paperpad-archive-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const ID: &str = "0b9c6f1e-3d2a-4c8e-9a41-7e5d2f8b6c10";

    fn by_path(path: &Path) -> Doc<'_> {
        Doc { path, id: None }
    }

    #[test]
    fn stamp_is_utc_date_and_time() {
        assert_eq!(stamp(0), "19700101-000000");
        assert_eq!(stamp(1_000_000_000), "20010909-014640");
        assert_eq!(stamp(1_709_164_800 + 3_661), "20240229-010101");
    }

    #[test]
    fn only_timestamp_ids_are_valid() {
        assert!(valid_id("20240229-010101"));
        assert!(valid_id("20240229-010101-02"));
        for bad in ["", "../../x", "20240229-010101-2", "20240229_010101", "2024022-0101011", "20240229-010101-02x", "20240229-01010a"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn only_lowercase_uuids_name_a_folder() {
        assert!(valid_uuid(ID));
        for bad in ["", "../../../../etc", "0B9C6F1E-3D2A-4C8E-9A41-7E5D2F8B6C10", "0b9c6f1e-3d2a-4c8e-9a41-7e5d2f8b6c1", "0b9c6f1e_3d2a-4c8e-9a41-7e5d2f8b6c10"] {
            assert!(!valid_uuid(bad), "{bad}");
        }
    }

    #[test]
    fn the_document_id_is_read_from_the_article_tag_only() {
        let html = format!("<body><article class=\"paperpad\" data-font=\"x\" data-id=\"{ID}\"><p>hi</p></article></body>");
        assert_eq!(extract_doc_id(&html).as_deref(), Some(ID));
        // An ID in the text, or a malformed one, does not count.
        let in_text = format!("<article class=\"paperpad\"><p> data-id=\"{ID}\"</p></article>");
        assert_eq!(extract_doc_id(&in_text), None);
        assert_eq!(extract_doc_id("<article class=\"paperpad\" data-id=\"../../etc\">"), None);
        assert_eq!(extract_doc_id("<p>plain</p>"), None);
    }

    #[test]
    fn same_name_in_two_folders_has_two_histories_without_an_id() {
        let data = Path::new("data");
        let (a, b) = (Path::new("/a/Notes.html"), Path::new("/b/Notes.html"));
        assert_ne!(doc_dir(data, by_path(a)), doc_dir(data, by_path(b)));
        assert_eq!(doc_dir(data, by_path(a)), doc_dir(data, by_path(a)));
        // With an ID the path does not matter: the history follows the document.
        let (x, y) = (Doc { path: a, id: Some(ID) }, Doc { path: b, id: Some(ID) });
        assert_eq!(doc_dir(data, x), doc_dir(data, y));
        assert!(doc_dir(data, x).ends_with(ID));
    }

    #[test]
    fn history_survives_a_rename_when_the_document_has_an_id() {
        let data = temp("rename");
        let old = data.join("Draft.html");
        assert_eq!(snapshot(&data, Doc { path: &old, id: Some(ID) }, b"one", false, 50, 1_000_000), Ok(true));
        let renamed = data.join("Final copy.html");
        let doc = Doc { path: &renamed, id: Some(ID) };
        assert_eq!(snapshot(&data, doc, b"two", false, 50, 1_000_100), Ok(true));
        let versions = list(&data, doc);
        assert_eq!(versions.len(), 2);
        assert_eq!(read(&data, doc, &versions[1].id).as_deref(), Some(&b"one"[..]));
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn snapshots_skip_duplicates_and_throttle_autosave() {
        let data = temp("throttle");
        let path = data.join("Letter.html");
        let doc = by_path(&path);
        assert_eq!(snapshot(&data, doc, b"one", false, 50, 1_000_000), Ok(true));
        // Same content: nothing new.
        assert_eq!(snapshot(&data, doc, b"one", false, 50, 1_000_100), Ok(false));
        // An autosave soon after is skipped, a manual save is not.
        assert_eq!(snapshot(&data, doc, b"two", true, 50, 1_000_000), Ok(false));
        assert_eq!(snapshot(&data, doc, b"two", false, 50, 1_000_000), Ok(true));
        let versions = list(&data, doc);
        assert_eq!(versions.len(), 2);
        // Two in the same second get a suffix and stay in order.
        assert_eq!(versions[0].id, "19700112-134640-02");
        assert_eq!(read(&data, doc, &versions[0].id).as_deref(), Some(&b"two"[..]));
        assert_eq!(read(&data, doc, "../../Letter").as_deref(), None);
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn the_first_save_keeps_the_file_it_replaces() {
        let data = temp("baseline");
        let path = data.join("Old.html");
        let doc = by_path(&path);
        fs::write(&path, b"from before").unwrap();
        assert_eq!(snapshot(&data, doc, b"new", false, 50, 2_000_000), Ok(true));
        let versions = list(&data, doc);
        assert_eq!(versions.len(), 2);
        assert_eq!(read(&data, doc, &versions[1].id).as_deref(), Some(&b"from before"[..]));
        assert_eq!(read(&data, doc, &versions[0].id).as_deref(), Some(&b"new"[..]));
        let _ = fs::remove_dir_all(&data);
    }

    #[test]
    fn the_oldest_versions_are_deleted() {
        let data = temp("prune");
        let path = data.join("Long.html");
        let doc = by_path(&path);
        for i in 0..8u64 {
            assert_eq!(snapshot(&data, doc, format!("v{i}").as_bytes(), false, 5, 3_000_000 + i * 10), Ok(true));
        }
        let versions = list(&data, doc);
        assert_eq!(versions.len(), 5);
        assert_eq!(read(&data, doc, &versions[0].id).as_deref(), Some(&b"v7"[..]));
        assert_eq!(read(&data, doc, &versions[4].id).as_deref(), Some(&b"v3"[..]));
        let _ = fs::remove_dir_all(&data);
    }
}
