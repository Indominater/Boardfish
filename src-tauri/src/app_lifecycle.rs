use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{Emitter, Manager};

use crate::app_theme::{configure_startup_theme, read_stored_app_theme};
use crate::image_sources::ImageSourceCache;

static CLOSE_REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);
static CLOSE_ACK_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) struct StartupFile(pub(crate) Mutex<Option<String>>);

#[derive(Clone, serde::Serialize)]
struct FileDropPayload {
    paths: Vec<String>,
}

pub(crate) fn startup_file_state(path: Option<String>) -> StartupFile {
    StartupFile(Mutex::new(path))
}

#[tauri::command]
pub(crate) fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
pub(crate) fn set_title(window: tauri::Window, title: String) {
    window.set_title(&title).ok();
    #[cfg(target_os = "macos")]
    unsafe {
        crate::platform_macos::configure_window_title_bar(&window);
    }
    #[cfg(target_os = "windows")]
    unsafe {
        crate::platform_windows::configure_window_title_bar(
            &window,
            crate::app_theme::is_dark_theme(),
        );
    }
}

#[tauri::command]
pub(crate) fn show_app_window(window: tauri::WebviewWindow) {
    show_startup_window(&window);
}

fn show_startup_window(window: &tauri::WebviewWindow) {
    eprintln!("[boardfish startup] showing main window");
    if let Err(error) = window.show() {
        eprintln!("[boardfish startup] show failed: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[boardfish startup] set_focus failed: {error}");
    }
}

fn schedule_startup_show_fallback(window: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        if !window.is_visible().unwrap_or(false) {
            eprintln!("[boardfish startup] frontend show timed out; using native fallback");
            show_startup_window(&window);
        }
    });
}

#[tauri::command]
pub(crate) fn exit_app(source_state: tauri::State<ImageSourceCache>) {
    if let Err(error) = source_state.clear() {
        eprintln!("[boardfish image cache] exit cleanup failed: {error}");
    }
    std::process::exit(0);
}

#[tauri::command]
pub(crate) fn cancel_pending_termination() {
    #[cfg(target_os = "macos")]
    crate::platform_macos::cancel_termination();
}

#[tauri::command]
pub(crate) fn acknowledge_close_request(seq: u64) {
    CLOSE_ACK_SEQ.fetch_max(seq, Ordering::SeqCst);
}

pub(crate) fn emit_close_request(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let seq = CLOSE_REQUEST_SEQ.fetch_add(1, Ordering::SeqCst);
        window.show().ok();
        window.set_focus().ok();
        window.emit("boardfish://close-requested", seq).ok();
        schedule_close_fallback(seq);
    }
}

fn schedule_close_fallback(seq: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        if CLOSE_ACK_SEQ.load(Ordering::SeqCst) < seq {
            std::process::exit(0);
        }
    });
}

pub(crate) fn handle_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let seq = CLOSE_REQUEST_SEQ.fetch_add(1, Ordering::SeqCst);
            window.emit("boardfish://close-requested", seq).ok();
            schedule_close_fallback(seq);
        }
        tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
            let payload = FileDropPayload {
                paths: paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect(),
            };
            if let Err(error) = window.emit("boardfish://file-drop", payload) {
                eprintln!("[boardfish file-drop] emit failed: {error}");
            }
        }
        _ => {}
    }
}

pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let _ = app;

    #[cfg(target_os = "macos")]
    {
        let app_handle = app.handle().clone();
        crate::platform_macos::setup_menu(app)?;
        if let Some(window) = app.get_webview_window("main") {
            let dark = read_stored_app_theme(&app_handle);
            let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
            configure_startup_theme(&window, dark);
            schedule_startup_show_fallback(window);
        }
        unsafe {
            // Keep the close confirmation path alive for Cmd+Q and dock quits.
            crate::platform_macos::setup_termination_intercept(app_handle);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            let dark = read_stored_app_theme(app.handle());
            configure_startup_theme(&window, dark);
            schedule_startup_show_fallback(window);
        }
    }

    Ok(())
}

pub(crate) fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Resumed = &event {
        if let Some(window) = app_handle.get_webview_window("main") {
            window.emit("boardfish://app-resumed", ()).ok();
        }
    }

    if let tauri::RunEvent::ExitRequested { api, .. } = &event {
        api.prevent_exit();
        #[cfg(target_os = "macos")]
        crate::platform_macos::cancel_termination();
        emit_close_request(app_handle);
        return;
    }

    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Opened { urls } = event {
        for url in urls {
            if url.scheme() == "file" {
                if let Ok(path) = url.to_file_path() {
                    if let Some(path_str) = path.to_str() {
                        let state = app_handle.state::<StartupFile>();
                        *state.0.lock().unwrap() = Some(path_str.to_string());
                        app_handle.emit("boardfish://open-file", path_str).ok();
                    }
                }
            }
        }
    }
}
