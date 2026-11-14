// Declaring the app commands here makes Tauri generate one permission per
// command (allow-<name>). Without this every registered command would be
// callable from any window. With it, a command only works if a capability
// in ./capabilities grants it.
const COMMANDS: &[&str] = &[
    "open_document",
    "open_recent",
    "list_recent",
    "save_document",
    "save_document_as",
    "get_documents_folder",
    "choose_documents_folder",
    "clear_documents_folder",
    "check_external_change",
    "reload_document",
    "save_conflict_copy",
    "list_versions",
    "read_version",
    "export_text",
    "export_docx",
    "pick_image",
    "set_document_state",
    "recovery_write",
    "recovery_read",
    "recovery_clear",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
