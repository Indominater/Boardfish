#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct StartupFile(Mutex<Option<String>>);

#[tauri::command]
fn get_startup_file(state: tauri::State<StartupFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[tauri::command]
async fn save_board(path: String, board: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string(&board).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json.as_bytes()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Boardfish Board", &["bf"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn save_file_dialog(app: tauri::AppHandle, default_name: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .add_filter("Boardfish Board", &["bf"]);
        if let Some(name) = default_name {
            builder = builder.set_file_name(name);
        }
        builder.blocking_save_file().map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn set_title(window: tauri::Window, title: String) {
    window.set_title(&title).ok();
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn copy_image_to_clipboard(data_url: String) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = data_url.split(',').nth(1).ok_or("invalid data URL")?;
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: rgba.into_raw().into(),
        })
        .map_err(|e| e.to_string())
}

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(StartupFile(Mutex::new(startup_file)))
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            save_board,
            read_text_file,
            read_binary_file_base64,
            open_file_dialog,
            save_file_dialog,
            set_title,
            exit_app,
            copy_image_to_clipboard
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.emit("boardfish://close-requested", ()).unwrap();
            }
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) => {
                let scale = window.scale_factor().unwrap_or(1.0);
                let payload = serde_json::json!({
                    "paths": paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>(),
                    "x": position.x / scale,
                    "y": position.y / scale
                });
                window.emit("boardfish://file-drop", payload).unwrap();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if url.scheme() == "file" {
                        if let Ok(path) = url.to_file_path() {
                            if let Some(path_str) = path.to_str() {
                                // Store for cold-launch: JS may not have called get_startup_file yet
                                let state = app_handle.state::<StartupFile>();
                                *state.0.lock().unwrap() = Some(path_str.to_string());
                                // Also emit for already-running case
                                app_handle.emit("boardfish://open-file", path_str).ok();
                            }
                        }
                    }
                }
            }
        });
}
