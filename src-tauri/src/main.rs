#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "macos")]
static PENDING_TERMINATION: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
static APP_HANDLE_FOR_TERMINATE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
fn macos_cancel_termination() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use std::sync::atomic::Ordering;
    if PENDING_TERMINATION.swap(false, Ordering::SeqCst) {
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let app = NSApplication::sharedApplication(mtm);
            app.replyToApplicationShouldTerminate(false);
        }
    }
}

#[cfg(target_os = "macos")]
unsafe fn setup_termination_intercept(app_handle: tauri::AppHandle) {
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use std::ffi::c_void;
    use std::os::raw::c_char;

    APP_HANDLE_FOR_TERMINATE.set(app_handle).ok();

    extern "C" {
        fn class_getInstanceMethod(cls: *const c_void, sel: Sel) -> *mut c_void;
        fn class_addMethod(
            cls: *const c_void,
            sel: Sel,
            imp: *const c_void,
            types: *const c_char,
        ) -> bool;
        fn method_setImplementation(m: *mut c_void, imp: *const c_void) -> *const c_void;
    }

    unsafe extern "C" fn our_should_terminate(
        _this: *mut AnyObject,
        _sel: Sel,
        _sender: *mut AnyObject,
    ) -> std::os::raw::c_ulong {
        use std::sync::atomic::Ordering;
        PENDING_TERMINATION.store(true, Ordering::SeqCst);
        if let Some(app) = APP_HANDLE_FOR_TERMINATE.get() {
            emit_close_request(app);
        }
        2 // NSTerminateLater
    }

    let mtm = MainThreadMarker::new_unchecked();
    let ns_app = NSApplication::sharedApplication(mtm);

    let delegate: *mut AnyObject = msg_send![&*ns_app, delegate];
    if delegate.is_null() {
        return;
    }

    let cls = (*delegate).class() as *const _ as *const c_void;
    let sel = sel!(applicationShouldTerminate:);
    let method = class_getInstanceMethod(cls, sel);

    if !method.is_null() {
        method_setImplementation(method, our_should_terminate as *const c_void);
    } else {
        // Tauri's delegate doesn't implement this optional method — add it
        // Type encoding: Q=NSUInteger(return)  @=id(self)  :=SEL(_cmd)  @=id(sender)
        let types = b"Q@:@\0";
        class_addMethod(
            cls,
            sel,
            our_should_terminate as *const c_void,
            types.as_ptr() as *const c_char,
        );
    }
}

#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
const CLOSE_WINDOW_MENU_ID: &str = "boardfish-close-window";
#[cfg(target_os = "macos")]
const WINDOW_CLOSE_MENU_ID: &str = "boardfish-window-close";

struct StartupFile(Mutex<Option<String>>);
struct ClipboardImageCache(Mutex<HashMap<String, CachedClipboardImage>>);
static CLIPBOARD_DEBUG: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct CachedClipboardImage {
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
}

fn clipboard_debug(label: &str, start: std::time::Instant) {
    if CLIPBOARD_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish clipboard] {} {:.2}ms",
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
async fn save_board(path: String, board: serde_json::Value) -> Result<(), String> {
    let json = serde_json::to_string(&board).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
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
        let mut builder = app.dialog().file().add_filter("Boardfish Board", &["bf"]);
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

    let Some(path) = path else {
        return Ok(false);
    };
    tokio::fs::write(path, text.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn save_image_as(
    app: tauri::AppHandle,
    data_url: String,
    default_name: Option<String>,
) -> Result<bool, String> {
    use base64::{engine::general_purpose, Engine as _};
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
    use base64::{engine::general_purpose, Engine as _};
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
            format!(
                "{:06x}",
                (nanos ^ (saved_count as u64 * 0x9e3779b9)) & 0xFFFFFF
            )
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
fn exit_app() {
    std::process::exit(0);
}

#[tauri::command]
fn cancel_pending_termination() {
    #[cfg(target_os = "macos")]
    macos_cancel_termination();
}

#[cfg(target_os = "macos")]
fn native_clipboard_sequence() -> u64 {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let pasteboard: *mut AnyObject = msg_send![class!(NSPasteboard), generalPasteboard];
        if pasteboard.is_null() {
            return 0;
        }
        let change_count: isize = msg_send![pasteboard, changeCount];
        change_count.max(0) as u64
    }
}

#[cfg(target_os = "windows")]
fn native_clipboard_sequence() -> u64 {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }

    unsafe { GetClipboardSequenceNumber() as u64 }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn native_clipboard_sequence() -> u64 {
    0
}

#[tauri::command]
fn clipboard_sequence() -> Result<u64, String> {
    Ok(native_clipboard_sequence())
}

#[tauri::command]
fn set_clipboard_debug(enabled: bool) {
    CLIPBOARD_DEBUG.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let total = std::time::Instant::now();
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())?;
    clipboard_debug("copy_text_to_clipboard total", total);
    Ok(())
}

#[tauri::command]
async fn cache_image_for_clipboard(
    state: tauri::State<'_, ClipboardImageCache>,
    img_key: String,
    data_url: String,
) -> Result<(), String> {
    let total = std::time::Instant::now();
    let cached = tokio::task::spawn_blocking(move || {
        let decode = std::time::Instant::now();
        let result = decode_data_url_to_cached_image(&data_url);
        clipboard_debug("cache_image_for_clipboard decode worker", decode);
        result
    })
    .await
    .map_err(|e| e.to_string())??;
    let lock = std::time::Instant::now();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key, cached);
    clipboard_debug("cache_image_for_clipboard lock+insert", lock);
    clipboard_debug("cache_image_for_clipboard total", total);
    Ok(())
}

#[tauri::command]
async fn copy_cached_image_to_clipboard(
    state: tauri::State<'_, ClipboardImageCache>,
    img_key: String,
) -> Result<(), String> {
    copy_cached_image_to_clipboard_transformed(state, img_key, false, false).await
}

#[tauri::command]
async fn copy_cached_image_to_clipboard_transformed(
    state: tauri::State<'_, ClipboardImageCache>,
    img_key: String,
    flip_x: bool,
    flip_y: bool,
) -> Result<(), String> {
    let total = std::time::Instant::now();
    let lookup = std::time::Instant::now();
    let cached = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&img_key)
        .cloned()
        .ok_or("clipboard image cache miss")?;
    clipboard_debug("copy_cached_image_to_clipboard_transformed lookup", lookup);
    let result = tokio::task::spawn_blocking(move || {
        let transform = std::time::Instant::now();
        let rgba = transform_rgba(cached.width, cached.height, cached.rgba, flip_x, flip_y);
        clipboard_debug(
            "copy_cached_image_to_clipboard_transformed transform worker",
            transform,
        );
        let write = std::time::Instant::now();
        let result = write_rgba_to_clipboard(cached.width, cached.height, rgba);
        clipboard_debug(
            "copy_cached_image_to_clipboard_transformed write worker",
            write,
        );
        result
    })
    .await
    .map_err(|e| e.to_string())?;
    clipboard_debug("copy_cached_image_to_clipboard_transformed total", total);
    result
}

#[tauri::command]
async fn copy_image_data_url_to_clipboard(data_url: String) -> Result<(), String> {
    copy_image_data_url_to_clipboard_transformed(data_url, false, false).await
}

#[tauri::command]
async fn copy_image_data_url_to_clipboard_transformed(
    data_url: String,
    flip_x: bool,
    flip_y: bool,
) -> Result<(), String> {
    let total = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let cached = decode_data_url_to_cached_image(&data_url)?;
        let transform = std::time::Instant::now();
        let rgba = transform_rgba(cached.width, cached.height, cached.rgba, flip_x, flip_y);
        clipboard_debug(
            "copy_image_data_url_to_clipboard_transformed transform worker",
            transform,
        );
        write_rgba_to_clipboard(cached.width, cached.height, rgba)
    })
    .await
    .map_err(|e| e.to_string())?;
    clipboard_debug("copy_image_data_url_to_clipboard_transformed total", total);
    result
}

fn transform_rgba(
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
    flip_x: bool,
    flip_y: bool,
) -> Arc<[u8]> {
    if !flip_x && !flip_y {
        return rgba;
    }

    let width = width as usize;
    let height = height as usize;
    let mut out = vec![0u8; width * height * 4];
    for y in 0..height {
        let src_y = if flip_y { height - 1 - y } else { y };
        for x in 0..width {
            let src_x = if flip_x { width - 1 - x } else { x };
            let src = (src_y * width + src_x) * 4;
            let dst = (y * width + x) * 4;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    Arc::from(out)
}

fn decode_data_url_to_cached_image(data_url: &str) -> Result<CachedClipboardImage, String> {
    use base64::{engine::general_purpose, Engine as _};
    let total = std::time::Instant::now();
    let base64_data = data_url.split(',').nth(1).ok_or("invalid data URL")?;
    let base64_decode = std::time::Instant::now();
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    clipboard_debug("decode_data_url base64", base64_decode);
    let image_decode = std::time::Instant::now();
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    clipboard_debug("decode_data_url image decode", image_decode);
    let rgba_convert = std::time::Instant::now();
    let rgba = img.to_rgba8();
    clipboard_debug("decode_data_url rgba convert", rgba_convert);
    let (width, height) = rgba.dimensions();
    clipboard_debug("decode_data_url total", total);
    Ok(CachedClipboardImage {
        width,
        height,
        rgba: Arc::from(rgba.into_raw()),
    })
}

#[tauri::command]
async fn read_image_from_clipboard() -> Result<String, String> {
    let total = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(|| {
        use base64::{engine::general_purpose, Engine as _};
        let read = std::time::Instant::now();
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let img = clipboard.get_image().map_err(|e| e.to_string())?;
        clipboard_debug("read_image_from_clipboard get_image", read);
        let encode = std::time::Instant::now();
        let rgba =
            image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())
                .ok_or("invalid image dimensions")?;
        let mut png_bytes: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .map_err(|e| e.to_string())?;
        clipboard_debug("read_image_from_clipboard png encode", encode);
        Ok(format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(&png_bytes)
        ))
    })
    .await
    .map_err(|e| e.to_string())?;
    clipboard_debug("read_image_from_clipboard total", total);
    result
}

#[tauri::command]
async fn read_image_from_clipboard_cached(
    state: tauri::State<'_, ClipboardImageCache>,
    img_key: String,
) -> Result<String, String> {
    let total = std::time::Instant::now();
    let (data_url, cached) = tokio::task::spawn_blocking(|| {
        use base64::{engine::general_purpose, Engine as _};
        let read = std::time::Instant::now();
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let img = clipboard.get_image().map_err(|e| e.to_string())?;
        clipboard_debug("read_image_from_clipboard_cached get_image", read);

        let width = img.width as u32;
        let height = img.height as u32;
        let rgba_bytes = img.bytes.into_owned();
        let cached = CachedClipboardImage {
            width,
            height,
            rgba: Arc::from(rgba_bytes.clone()),
        };

        let encode = std::time::Instant::now();
        let rgba = image::RgbaImage::from_raw(width, height, rgba_bytes)
            .ok_or("invalid image dimensions")?;
        let mut png_bytes: Vec<u8> = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(
                &mut std::io::Cursor::new(&mut png_bytes),
                image::ImageFormat::Png,
            )
            .map_err(|e| e.to_string())?;
        clipboard_debug("read_image_from_clipboard_cached png encode", encode);
        Ok::<_, String>((
            format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(&png_bytes)
            ),
            cached,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    let lock = std::time::Instant::now();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key, cached);
    clipboard_debug("read_image_from_clipboard_cached lock+insert", lock);
    clipboard_debug("read_image_from_clipboard_cached total", total);
    Ok(data_url)
}

#[tauri::command]
async fn read_text_from_clipboard() -> Result<String, String> {
    let total = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(|| {
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .get_text()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    clipboard_debug("read_text_from_clipboard total", total);
    result
}

#[tauri::command]
fn clear_clipboard_image_cache(state: tauri::State<ClipboardImageCache>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

fn write_rgba_to_clipboard(width: u32, height: u32, rgba: Arc<[u8]>) -> Result<(), String> {
    // Fast path: in-memory clipboard write (no disk I/O or subprocess).
    let total = std::time::Instant::now();
    let arboard_write = std::time::Instant::now();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    if clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Borrowed(&rgba),
        })
        .is_ok()
    {
        clipboard_debug("write_rgba_to_clipboard arboard set_image", arboard_write);
        clipboard_debug("write_rgba_to_clipboard total", total);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // Fallback for systems where direct image clipboard APIs are unreliable.
        let fallback = std::time::Instant::now();
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
        clipboard_debug("write_rgba_to_clipboard macos fallback", fallback);
        clipboard_debug("write_rgba_to_clipboard total", total);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("image clipboard write failed".to_string())
    }
}

fn emit_close_request(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.set_focus().ok();
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
            cancel_pending_termination,
            copy_text_to_clipboard,
            clipboard_sequence,
            set_clipboard_debug,
            cache_image_for_clipboard,
            copy_cached_image_to_clipboard,
            copy_cached_image_to_clipboard_transformed,
            copy_image_data_url_to_clipboard,
            copy_image_data_url_to_clipboard_transformed,
            read_image_from_clipboard,
            read_image_from_clipboard_cached,
            read_text_from_clipboard,
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

            #[cfg(target_os = "macos")]
            {
                let pkg_info = app_handle.package_info();
                let config = app_handle.config();
                let about_metadata = AboutMetadata {
                    name: Some(pkg_info.name.clone()),
                    version: Some(pkg_info.version.to_string()),
                    copyright: config.bundle.copyright.clone(),
                    authors: config.bundle.publisher.clone().map(|p| vec![p]),
                    ..Default::default()
                };

                let close_window = MenuItem::with_id(
                    &app_handle,
                    CLOSE_WINDOW_MENU_ID,
                    "Close Window",
                    true,
                    Some("CmdOrCtrl+W"),
                )?;
                let window_close = MenuItem::with_id(
                    &app_handle,
                    WINDOW_CLOSE_MENU_ID,
                    "Close Window",
                    true,
                    None::<&str>,
                )?;
                let window_menu = Submenu::with_id_and_items(
                    &app_handle,
                    WINDOW_SUBMENU_ID,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(&app_handle, None)?,
                        &PredefinedMenuItem::maximize(&app_handle, None)?,
                        &PredefinedMenuItem::separator(&app_handle)?,
                        &window_close,
                    ],
                )?;
                let menu = Menu::with_items(
                    &app_handle,
                    &[
                        &Submenu::with_items(
                            &app_handle,
                            pkg_info.name.clone(),
                            true,
                            &[
                                &PredefinedMenuItem::about(
                                    &app_handle,
                                    None,
                                    Some(about_metadata),
                                )?,
                                &PredefinedMenuItem::separator(&app_handle)?,
                                &PredefinedMenuItem::services(&app_handle, None)?,
                                &PredefinedMenuItem::separator(&app_handle)?,
                                &PredefinedMenuItem::hide(&app_handle, None)?,
                                &PredefinedMenuItem::hide_others(&app_handle, None)?,
                                &PredefinedMenuItem::separator(&app_handle)?,
                                &PredefinedMenuItem::quit(&app_handle, None)?,
                            ],
                        )?,
                        &Submenu::with_items(&app_handle, "File", true, &[&close_window])?,
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
                        &Submenu::with_items(
                            &app_handle,
                            "View",
                            true,
                            &[&PredefinedMenuItem::fullscreen(&app_handle, None)?],
                        )?,
                        &window_menu,
                    ],
                )?;
                app.set_menu(menu)?;

                app.on_menu_event(|app, event| {
                    let id = event.id().0.as_str();
                    if id == CLOSE_WINDOW_MENU_ID || id == WINDOW_CLOSE_MENU_ID {
                        emit_close_request(app);
                    }
                });
            }

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title_bar_style(tauri::TitleBarStyle::Visible);
            }

            #[cfg(target_os = "macos")]
            unsafe {
                setup_termination_intercept(app_handle.clone());
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                api.prevent_exit();
                #[cfg(target_os = "macos")]
                macos_cancel_termination();
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
