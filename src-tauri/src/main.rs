#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
use tauri::{Emitter, Manager};

const CLOSE_WINDOW_MENU_ID: &str = "boardfish-close-window";
const WINDOW_CLOSE_MENU_ID: &str = "boardfish-window-close";

struct StartupFile(Mutex<Option<String>>);
struct ClipboardImageCache(Mutex<HashMap<String, CachedClipboardImage>>);

#[derive(Clone)]
struct CachedClipboardImage {
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
}

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
async fn save_text_as(app: tauri::AppHandle, text: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let hex = {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64)
            .unwrap_or(0);
        format!("{:06x}", nanos & 0xFFFFFF)
    };
    let default_name = format!("text_{}.txt", hex);
    let path = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Text", &["txt"])
            .set_file_name(default_name)
            .blocking_save_file()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(path) = path else { return Ok(false); };
    tokio::fs::write(path, text.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn save_image_as(
    app: tauri::AppHandle,
    data_url: String,
    default_name: Option<String>,
) -> Result<bool, String> {
    use base64::{Engine as _, engine::general_purpose};
    use tauri_plugin_dialog::DialogExt;

    let (_, base64_data) = data_url.split_once(',').ok_or("invalid data URL")?;
    let path = tokio::task::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .add_filter("Image", &["png", "jpg", "jpeg", "gif", "webp"]);
        if let Some(name) = default_name {
            builder = builder.set_file_name(name);
        }
        builder.blocking_save_file().map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(path) = path else {
        return Ok(false);
    };

    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    tokio::fs::write(path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

fn ext_from_data_url_header(header: &str) -> &'static str {
    if header.starts_with("data:image/jpeg") {
        "jpg"
    } else if header.starts_with("data:image/gif") {
        "gif"
    } else if header.starts_with("data:image/webp") {
        "webp"
    } else {
        "png"
    }
}

#[tauri::command]
async fn save_images_to_folder(
    app: tauri::AppHandle,
    data_urls: Vec<String>,
) -> Result<usize, String> {
    use base64::{Engine as _, engine::general_purpose};
    use tauri_plugin_dialog::DialogExt;

    if data_urls.is_empty() {
        return Ok(0);
    }

    let folder = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(folder) = folder else {
        return Ok(0);
    };

    let base = std::path::PathBuf::from(folder);
    let mut saved_count = 0usize;

    for data_url in data_urls.iter() {
        let Some((header, base64_data)) = data_url.split_once(',') else {
            continue;
        };
        let ext = ext_from_data_url_header(header);
        let bytes = match general_purpose::STANDARD.decode(base64_data) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let hex = {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as u64)
                .unwrap_or(saved_count as u64);
            format!("{:06x}", (nanos ^ (saved_count as u64 * 0x9e3779b9)) & 0xFFFFFF)
        };
        let filename = format!("image_{}.{}", hex, ext);
        if tokio::fs::write(base.join(filename), &bytes).await.is_ok() {
            saved_count += 1;
        }
    }

    Ok(saved_count)
}

#[tauri::command]
fn set_title(window: tauri::Window, title: String) {
    window.set_title(&title).ok();
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cache_image_for_clipboard(
    state: tauri::State<ClipboardImageCache>,
    img_key: String,
    data_url: String,
) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose};
    let base64_data = data_url.split(',').nth(1).ok_or("invalid data URL")?;
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(
            img_key,
            CachedClipboardImage {
                width,
                height,
                rgba: Arc::from(rgba.into_raw()),
            },
        );
    Ok(())
}

#[tauri::command]
fn copy_cached_image_to_clipboard(
    state: tauri::State<ClipboardImageCache>,
    img_key: String,
) -> Result<(), String> {
    let cached = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&img_key)
        .cloned()
        .ok_or("clipboard image cache miss")?;
    write_rgba_to_clipboard(cached.width, cached.height, cached.rgba)
}

#[tauri::command]
fn clear_clipboard_image_cache(state: tauri::State<ClipboardImageCache>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

fn write_rgba_to_clipboard(width: u32, height: u32, rgba: Arc<[u8]>) -> Result<(), String> {
    // Fast path: in-memory clipboard write (no disk I/O or subprocess).
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    if clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Borrowed(&rgba),
        })
        .is_ok()
    {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // Fallback for systems where direct image clipboard APIs are unreliable.
        let tmp_path = std::env::temp_dir().join("boardfish_clipboard.png");
        let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
            .ok_or("invalid RGBA buffer dimensions")?;
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        dyn_img
            .save_with_format(&tmp_path, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;

        let script = format!(
            "set the clipboard to (read POSIX file \"{}\" as «class PNGf»)",
            tmp_path.to_string_lossy()
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("image clipboard write failed".to_string())
    }
}

fn emit_close_request(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.emit("boardfish://close-requested", ()).ok();
    }
}

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartupFile(Mutex::new(startup_file)))
        .manage(ClipboardImageCache(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            save_board,
            save_text_as,
            read_text_file,
            read_binary_file_base64,
            open_file_dialog,
            save_file_dialog,
            save_image_as,
            save_images_to_folder,
            set_title,
            exit_app,
            copy_text_to_clipboard,
            cache_image_for_clipboard,
            copy_cached_image_to_clipboard,
            clear_clipboard_image_cache
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                window.emit("boardfish://close-requested", ()).unwrap();
            }
            tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                let payload = serde_json::json!({
                    "paths": paths.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>()
                });
                window.emit("boardfish://file-drop", payload).unwrap();
            }
            _ => {}
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            let pkg_info = app_handle.package_info();
            let config = app_handle.config();
            let about_metadata = AboutMetadata {
                name: Some(pkg_info.name.clone()),
                version: Some(pkg_info.version.to_string()),
                copyright: config.bundle.copyright.clone(),
                authors: config.bundle.publisher.clone().map(|p| vec![p]),
                ..Default::default()
            };

            let close_window =
                MenuItem::with_id(&app_handle, CLOSE_WINDOW_MENU_ID, "Close Window", true, Some("CmdOrCtrl+W"))?;
            let window_close =
                MenuItem::with_id(&app_handle, WINDOW_CLOSE_MENU_ID, "Close Window", true, None::<&str>)?;
            let window_menu = Submenu::with_id_and_items(
                &app_handle,
                WINDOW_SUBMENU_ID,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(&app_handle, None)?,
                    &PredefinedMenuItem::maximize(&app_handle, None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::separator(&app_handle)?,
                    &window_close,
                ],
            )?;
            let help_menu = Submenu::with_id_and_items(
                &app_handle,
                HELP_SUBMENU_ID,
                "Help",
                true,
                &[
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::about(&app_handle, None, Some(about_metadata.clone()))?,
                ],
            )?;
            let menu = Menu::with_items(
                &app_handle,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        &app_handle,
                        pkg_info.name.clone(),
                        true,
                        &[
                            &PredefinedMenuItem::about(&app_handle, None, Some(about_metadata))?,
                            &PredefinedMenuItem::separator(&app_handle)?,
                            &PredefinedMenuItem::services(&app_handle, None)?,
                            &PredefinedMenuItem::separator(&app_handle)?,
                            &PredefinedMenuItem::hide(&app_handle, None)?,
                            &PredefinedMenuItem::hide_others(&app_handle, None)?,
                            &PredefinedMenuItem::separator(&app_handle)?,
                            &PredefinedMenuItem::quit(&app_handle, None)?,
                        ],
                    )?,
                    #[cfg(not(any(
                        target_os = "linux",
                        target_os = "dragonfly",
                        target_os = "freebsd",
                        target_os = "netbsd",
                        target_os = "openbsd"
                    )))]
                    &Submenu::with_items(
                        &app_handle,
                        "File",
                        true,
                        &[
                            &close_window,
                            #[cfg(not(target_os = "macos"))]
                            &PredefinedMenuItem::quit(&app_handle, None)?,
                        ],
                    )?,
                    &Submenu::with_items(
                        &app_handle,
                        "Edit",
                        true,
                        &[
                            &PredefinedMenuItem::undo(&app_handle, None)?,
                            &PredefinedMenuItem::redo(&app_handle, None)?,
                            &PredefinedMenuItem::separator(&app_handle)?,
                            &PredefinedMenuItem::cut(&app_handle, None)?,
                            &PredefinedMenuItem::copy(&app_handle, None)?,
                            &PredefinedMenuItem::paste(&app_handle, None)?,
                            &PredefinedMenuItem::select_all(&app_handle, None)?,
                        ],
                    )?,
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        &app_handle,
                        "View",
                        true,
                        &[&PredefinedMenuItem::fullscreen(&app_handle, None)?],
                    )?,
                    &window_menu,
                    &help_menu,
                ],
            )?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let id = event.id().0.as_str();
                if id == CLOSE_WINDOW_MENU_ID || id == WINDOW_CLOSE_MENU_ID {
                    emit_close_request(app);
                }
            });

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title_bar_style(tauri::TitleBarStyle::Visible);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    emit_close_request(app_handle);
                }
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
