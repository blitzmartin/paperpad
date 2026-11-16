#[cfg(target_os = "android")]
mod android_io;
mod archive;
mod base64;
mod commands;
mod state;
mod zip;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime};

use state::AppState;

/// Defense in depth: the webview may only ever show the bundled app.
/// A dropped link, a stray click or injected script cannot navigate it away.
fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let host = url.host_str().unwrap_or_default();
            let bundled = url.scheme() == "tauri" || host == "tauri.localhost";
            let dev_server = cfg!(debug_assertions) && host == "127.0.0.1";
            bundled || dev_server
        })
        .build()
}

// On Android the app starts from this function, called by the generated
// Kotlin activity. On desktop the attribute does nothing (main.rs calls it).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // The dialog plugin is used from Rust only. Its JS commands exist but
        // no capability grants them, so the webview cannot call them.
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard())
        .manage(AppState::default())
        .setup(|app| {
            let state = app.state::<AppState>();
            if let Ok(dir) = app.path().app_data_dir() {
                state.set_data_dir(dir);
                state.load_recent();
                state.load_documents_dir();
            }
            Ok(())
        });
    #[cfg(desktop)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::open_recent,
            commands::list_recent,
            commands::save_document,
            commands::save_document_as,
            commands::get_documents_folder,
            commands::choose_documents_folder,
            commands::clear_documents_folder,
            commands::check_external_change,
            commands::reload_document,
            commands::save_conflict_copy,
            commands::list_versions,
            commands::read_version,
            commands::export_text,
            commands::export_docx,
            commands::pick_image,
            commands::set_document_state,
            commands::recovery_write,
            commands::recovery_read,
            commands::recovery_clear,
        ])
        .on_window_event(close_guard);
    // Android documents are content:// URIs, opened through android_io and its
    // Kotlin plugin. Recent files, the documents folder and export are not
    // there yet (see ANDROID.md). The last four commands are the desktop ones.
    // capabilities/android.json grants exactly this list.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(android_io::init()).invoke_handler(tauri::generate_handler![
        android_io::open_document,
        android_io::save_document,
        android_io::save_document_as,
        android_io::check_external_change,
        android_io::reload_document,
        android_io::save_conflict_copy,
        android_io::list_versions,
        android_io::read_version,
        android_io::pick_image,
        commands::set_document_state,
        commands::recovery_write,
        commands::recovery_read,
        commands::recovery_clear,
    ]);
    builder.run(tauri::generate_context!()).expect("error while running PaperPad");
}

/// Asks before closing a window with unsaved changes. The frontend reports
/// them through set_document_state, so the webview needs no window
/// permissions. Desktop only: Android never sends CloseRequested (the system
/// ends the app when it likes), so autosave and crash recovery cover it there.
#[cfg(desktop)]
fn close_guard(window: &tauri::Window, event: &tauri::WindowEvent) {
    use std::sync::atomic::Ordering;
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };
    let state = window.state::<AppState>();
    if !state.dirty.load(Ordering::Relaxed) {
        return;
    }
    api.prevent_close();
    let target = window.clone();
    window
        .dialog()
        .message("You have unsaved changes. Close PaperPad and discard them?")
        .title("PaperPad")
        .kind(MessageDialogKind::Warning)
        .parent(window)
        .buttons(MessageDialogButtons::OkCancelCustom("Discard and close".into(), "Cancel".into()))
        .show(move |discard| {
            if discard {
                let state = target.state::<AppState>();
                state.dirty.store(false, Ordering::Relaxed);
                commands::clear_recovery(&state);
                let _ = target.destroy();
            }
        });
}
