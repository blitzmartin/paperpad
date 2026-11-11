mod base64;
mod commands;
mod state;
mod zip;

use std::sync::atomic::Ordering;

use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Manager, Runtime, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

pub fn run() {
    tauri::Builder::default()
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
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close guard: the frontend reports unsaved changes through
            // set_document_state, so the webview needs no window permissions.
            if let WindowEvent::CloseRequested { api, .. } = event {
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
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Discard and close".into(),
                        "Cancel".into(),
                    ))
                    .show(move |discard| {
                        if discard {
                            let state = target.state::<AppState>();
                            state.dirty.store(false, Ordering::Relaxed);
                            commands::clear_recovery(&state);
                            let _ = target.destroy();
                        }
                    });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::open_recent,
            commands::list_recent,
            commands::save_document,
            commands::save_document_as,
            commands::export_text,
            commands::export_docx,
            commands::pick_image,
            commands::set_document_state,
            commands::recovery_write,
            commands::recovery_read,
            commands::recovery_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PaperPad");
}
