#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

mod board_io;
mod board_types;
mod clipboard;
mod dialogs;
mod image_sources;
#[cfg(target_os = "macos")]
mod platform_macos;

use board_io::{read_board_file, write_board_container};
use board_types::validate_board_value;
use clipboard::{
    clipboard_sequence, copy_image_data_url_to_clipboard_transformed, copy_text_to_clipboard,
    read_image_from_clipboard_cached, read_text_from_clipboard, set_clipboard_debug,
};
use dialogs::{
    open_file_dialog, pick_folder, pick_image_files, save_file_dialog, save_image_file_dialog,
    save_text_file_dialog,
};
use image_sources::{
    clear_image_source_cache, get_cached_image_data_url, materialize_cached_image_sources,
    register_image_file_source, register_image_source, register_transformed_image_source,
    remove_cached_image_sources, save_images_to_existing_folder_by_keys, write_image_file,
    write_image_file_by_key, ImageSourceCache,
};

static CLOSE_REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);
static CLOSE_ACK_SEQ: AtomicU64 = AtomicU64::new(0);

use tauri::{Emitter, Manager};

struct StartupFile(Mutex<Option<String>>);
static SAVE_DEBUG: AtomicBool = AtomicBool::new(false);
static OPEN_DEBUG: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
struct SaveBoardResponse {
    format: &'static str,
    json_bytes: usize,
    image_bytes: usize,
    image_count: usize,
    serialize_ms: f64,
    write_ms: f64,
    zip_ms: f64,
    total_ms: f64,
}

#[derive(serde::Serialize)]
struct ReadBoardDebug {
    format: &'static str,
    file_bytes: usize,
    read_ms: f64,
    zip_open_ms: f64,
    board_json_bytes: usize,
    board_json_read_ms: f64,
    board_json_parse_ms: f64,
    image_count: usize,
    image_bytes: usize,
    image_read_ms: f64,
    cache_insert_ms: f64,
    total_ms: f64,
}

#[derive(serde::Serialize)]
struct ReadBoardResponse {
    board: serde_json::Value,
    debug: ReadBoardDebug,
}

#[derive(Clone, serde::Serialize)]
struct FileDropPayload {
    paths: Vec<String>,
}

pub(crate) fn elapsed_ms(start: std::time::Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

pub(crate) fn rgba_mb(width: u32, height: u32) -> f64 {
    let bytes = width as f64 * height as f64 * 4.0;
    (bytes / 1024.0 / 1024.0 * 100.0).round() / 100.0
}

pub(crate) fn save_debug(label: &str, start: std::time::Instant) {
    if SAVE_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish save] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

pub(crate) fn open_debug(label: &str, start: std::time::Instant) {
    if OPEN_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish open] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
async fn save_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
    board: serde_json::Value,
) -> Result<SaveBoardResponse, String> {
    let total_start = std::time::Instant::now();
    validate_board_value(&board)?;
    let image_keys = board
        .get("imageStore")
        .and_then(|v| v.as_object())
        .map(|store| store.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let sources = state.get_many(&image_keys)?;

    let result = tokio::task::spawn_blocking(move || write_board_container(&path, board, sources))
        .await
        .map_err(|e| e.to_string())??;

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;
    save_debug("total", total_start);

    Ok(SaveBoardResponse {
        format: "container",
        json_bytes: result.json_bytes,
        image_bytes: result.image_bytes,
        image_count: result.image_count,
        serialize_ms: result.serialize_ms,
        write_ms: result.write_ms,
        zip_ms: result.zip_ms,
        total_ms,
    })
}

#[tauri::command]
async fn read_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
) -> Result<ReadBoardResponse, String> {
    let mut result = tokio::task::spawn_blocking(move || read_board_file(&path))
        .await
        .map_err(|e| e.to_string())??;
    validate_board_value(&result.board)?;

    {
        let cache_start = std::time::Instant::now();
        state.insert_many(result.sources.drain(..).collect())?;
        result.stats.cache_insert_ms = cache_start.elapsed().as_secs_f64() * 1000.0;
    }

    Ok(ReadBoardResponse {
        board: result.board,
        debug: ReadBoardDebug {
            format: "container",
            file_bytes: result.stats.file_bytes,
            read_ms: result.stats.read_ms,
            zip_open_ms: result.stats.zip_open_ms,
            board_json_bytes: result.stats.board_json_bytes,
            board_json_read_ms: result.stats.board_json_read_ms,
            board_json_parse_ms: result.stats.board_json_parse_ms,
            image_count: result.stats.image_count,
            image_bytes: result.stats.image_bytes,
            image_read_ms: result.stats.image_read_ms,
            cache_insert_ms: result.stats.cache_insert_ms,
            total_ms: result.stats.total_ms,
        },
    })
}

#[tauri::command]
async fn write_text_file(path: String, text: String) -> Result<(), String> {
    tokio::fs::write(path, text.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_title(window: tauri::Window, title: String) {
    window.set_title(&title).ok();
    #[cfg(target_os = "macos")]
    unsafe {
        platform_macos::configure_window_title_bar(&window);
    }
}

#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn cancel_pending_termination() {
    #[cfg(target_os = "macos")]
    platform_macos::cancel_termination();
}

#[tauri::command]
fn acknowledge_close_request(seq: u64) {
    CLOSE_ACK_SEQ.fetch_max(seq, Ordering::SeqCst);
}

#[tauri::command]
fn set_save_debug(enabled: bool) {
    SAVE_DEBUG.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_open_debug(enabled: bool) {
    OPEN_DEBUG.store(enabled, Ordering::Relaxed);
}

fn emit_close_request(app: &tauri::AppHandle) {
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

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartupFile(Mutex::new(startup_file)))
        .manage(ImageSourceCache::default())
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            save_board,
            save_text_file_dialog,
            write_text_file,
            read_board,
            register_image_file_source,
            get_cached_image_data_url,
            materialize_cached_image_sources,
            open_file_dialog,
            pick_image_files,
            save_file_dialog,
            save_image_file_dialog,
            write_image_file,
            write_image_file_by_key,
            pick_folder,
            save_images_to_existing_folder_by_keys,
            set_title,
            exit_app,
            cancel_pending_termination,
            acknowledge_close_request,
            copy_text_to_clipboard,
            clipboard_sequence,
            set_clipboard_debug,
            set_save_debug,
            set_open_debug,
            register_image_source,
            register_transformed_image_source,
            remove_cached_image_sources,
            copy_image_data_url_to_clipboard_transformed,
            read_image_from_clipboard_cached,
            read_text_from_clipboard,
            clear_image_source_cache
        ])
        .on_window_event(|window, event| match event {
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
                window.emit("boardfish://file-drop", payload).unwrap();
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(not(target_os = "macos"))]
            let _ = app;

            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle().clone();
                platform_macos::setup_menu(app)?;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                    unsafe {
                        platform_macos::configure_webview_title_bar(&window);
                    }
                }
                unsafe {
                    // Keep the close confirmation path alive for Cmd+Q and dock quits.
                    platform_macos::setup_termination_intercept(app_handle);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Resumed = &event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    window.emit("boardfish://app-resumed", ()).ok();
                }
            }

            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                api.prevent_exit();
                #[cfg(target_os = "macos")]
                platform_macos::cancel_termination();
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
        });
}
