#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "macos")]
static PENDING_TERMINATION: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
static APP_HANDLE_FOR_TERMINATE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

static CLOSE_REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);
static CLOSE_ACK_SEQ: AtomicU64 = AtomicU64::new(0);

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
unsafe fn configure_macos_ns_title_bar(ns_window_ptr: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    if ns_window_ptr.is_null() {
        return;
    }

    let ns_window = &*(ns_window_ptr as *mut AnyObject);
    let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];
    let _: () = msg_send![ns_window, setTitleVisibility: 1isize];
}

#[cfg(target_os = "macos")]
unsafe fn configure_macos_window_title_bar(window: &tauri::Window) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        configure_macos_ns_title_bar(ns_window_ptr);
    }
}

#[cfg(target_os = "macos")]
unsafe fn configure_macos_webview_title_bar(window: &tauri::WebviewWindow) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        configure_macos_ns_title_bar(ns_window_ptr);
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
struct ImageSourceCache(Mutex<HashMap<String, CachedImageSource>>);
static CLIPBOARD_DEBUG: AtomicBool = AtomicBool::new(false);
static SAVE_DEBUG: AtomicBool = AtomicBool::new(false);
static OPEN_DEBUG: AtomicBool = AtomicBool::new(false);
static IMAGE_ASSET_BATCH_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct CachedClipboardImage {
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
}

#[derive(Clone)]
struct CachedImageSource {
    mime: String,
    ext: String,
    bytes: Arc<[u8]>,
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardCopyTiming {
    path: String,
    cache_hit: bool,
    flipped: bool,
    width: u32,
    height: u32,
    pixels: u64,
    rgba_mb: f64,
    total_ms: f64,
    lookup_ms: Option<f64>,
    decode_ms: Option<f64>,
    base64_ms: Option<f64>,
    image_decode_ms: Option<f64>,
    rgba_convert_ms: Option<f64>,
    transform_ms: Option<f64>,
    clipboard_write_ms: Option<f64>,
    arboard_ms: Option<f64>,
    macos_fallback_ms: Option<f64>,
}

fn elapsed_ms(start: std::time::Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

fn rgba_mb(width: u32, height: u32) -> f64 {
    let bytes = width as f64 * height as f64 * 4.0;
    (bytes / 1024.0 / 1024.0 * 100.0).round() / 100.0
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

fn clipboard_debug_msg(message: &str) {
    if CLIPBOARD_DEBUG.load(Ordering::Relaxed) {
        eprintln!("[boardfish clipboard] {}", message);
    }
}

fn save_debug(label: &str, start: std::time::Instant) {
    if SAVE_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish save] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

fn open_debug(label: &str, start: std::time::Instant) {
    if OPEN_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish open] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

struct BoardWriteStats {
    json_bytes: usize,
    image_bytes: usize,
    image_count: usize,
    serialize_ms: f64,
    write_ms: f64,
    zip_ms: f64,
}

fn write_board_container(
    path: &str,
    board: serde_json::Value,
    sources: Vec<(String, CachedImageSource)>,
) -> Result<BoardWriteStats, String> {
    use std::io::Write;
    use zip::write::FileOptions;

    let zip_start = std::time::Instant::now();
    let serialize_start = std::time::Instant::now();
    let board_json = serde_json::to_vec(&board).map_err(|e| e.to_string())?;
    let serialize_ms = serialize_start.elapsed().as_secs_f64() * 1000.0;
    save_debug("container serialize board.json", serialize_start);

    let write_start = std::time::Instant::now();
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let json_options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("board.json", json_options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&board_json).map_err(|e| e.to_string())?;

    let image_options = FileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut image_bytes = 0usize;
    for (key, source) in sources {
        let path = format!("images/{}.{}", key, source.ext);
        zip.start_file(path, image_options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&source.bytes).map_err(|e| e.to_string())?;
        image_bytes += source.bytes.len();
    }
    zip.finish().map_err(|e| e.to_string())?;
    let write_ms = write_start.elapsed().as_secs_f64() * 1000.0;
    save_debug("container write zip", write_start);

    Ok(BoardWriteStats {
        json_bytes: board_json.len(),
        image_bytes,
        image_count: board
            .get("imageStore")
            .and_then(|v| v.as_object())
            .map(|o| o.len())
            .unwrap_or(0),
        serialize_ms,
        write_ms,
        zip_ms: zip_start.elapsed().as_secs_f64() * 1000.0,
    })
}

#[derive(Default)]
struct BoardReadStats {
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
    base64_ms: f64,
    total_ms: f64,
}

struct BoardReadResult {
    board: serde_json::Value,
    sources: Vec<(String, CachedImageSource)>,
    stats: BoardReadStats,
}

fn read_board_file(path: &str) -> Result<BoardReadResult, String> {
    use std::io::Read;

    let total_start = std::time::Instant::now();
    let mut stats = BoardReadStats::default();

    let read_start = std::time::Instant::now();
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    stats.read_ms = read_start.elapsed().as_secs_f64() * 1000.0;
    stats.file_bytes = bytes.len();
    open_debug("read file bytes", read_start);

    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("unsupported Boardfish file; expected container .bf".to_string());
    }

    let zip_start = std::time::Instant::now();
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    stats.zip_open_ms = zip_start.elapsed().as_secs_f64() * 1000.0;
    open_debug("open zip archive", zip_start);

    let mut board: serde_json::Value = {
        let json_read_start = std::time::Instant::now();
        let mut board_file = archive.by_name("board.json").map_err(|e| e.to_string())?;
        let mut board_json = String::new();
        board_file
            .read_to_string(&mut board_json)
            .map_err(|e| e.to_string())?;
        stats.board_json_read_ms = json_read_start.elapsed().as_secs_f64() * 1000.0;
        stats.board_json_bytes = board_json.len();
        open_debug("read board.json", json_read_start);

        let parse_start = std::time::Instant::now();
        let parsed = serde_json::from_str(&board_json).map_err(|e| e.to_string())?;
        stats.board_json_parse_ms = parse_start.elapsed().as_secs_f64() * 1000.0;
        open_debug("parse board.json", parse_start);
        parsed
    };

    let entries = board
        .get("imageStore")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let mut image_store = serde_json::Map::new();
    let mut sources = Vec::with_capacity(entries.len());
    for (key, meta) in entries {
        let entry_path = meta
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                let ext = meta.get("ext").and_then(|v| v.as_str()).unwrap_or("png");
                format!("images/{}.{}", key, ext)
            });
        let mime = meta
            .get("mime")
            .and_then(|v| v.as_str())
            .unwrap_or("image/png")
            .to_string();
        let ext = meta
            .get("ext")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| if mime == "image/jpeg" { "jpg" } else { "png" })
            .to_string();

        let image_read_start = std::time::Instant::now();
        let mut image_file = archive.by_name(&entry_path).map_err(|e| e.to_string())?;
        let mut image_bytes = Vec::with_capacity(image_file.size() as usize);
        image_file
            .read_to_end(&mut image_bytes)
            .map_err(|e| e.to_string())?;
        stats.image_read_ms += image_read_start.elapsed().as_secs_f64() * 1000.0;
        stats.image_count += 1;
        stats.image_bytes += image_bytes.len();

        let source = CachedImageSource {
            mime: mime.clone(),
            ext: ext.clone(),
            bytes: Arc::from(image_bytes),
        };
        image_store.insert(
            key.clone(),
            serde_json::json!({
                "native": true,
                "path": entry_path,
                "mime": mime,
                "ext": ext,
            }),
        );
        sources.push((key, source));
    }
    board["imageStore"] = serde_json::Value::Object(image_store);
    open_debug("read all images", total_start);
    stats.total_ms = total_start.elapsed().as_secs_f64() * 1000.0;
    Ok(BoardReadResult {
        board,
        sources,
        stats,
    })
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
) -> Result<serde_json::Value, String> {
    let total_start = std::time::Instant::now();
    let image_keys = board
        .get("imageStore")
        .and_then(|v| v.as_object())
        .map(|store| store.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let sources = {
        let cache = state.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(image_keys.len());
        for key in &image_keys {
            let source = cache
                .get(key)
                .cloned()
                .ok_or_else(|| format!("image source cache missing for {key}"))?;
            sources.push((key.clone(), source));
        }
        sources
    };

    let result = tokio::task::spawn_blocking(move || write_board_container(&path, board, sources))
        .await
        .map_err(|e| e.to_string())??;

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;
    save_debug("total", total_start);

    Ok(serde_json::json!({
        "format": "container",
        "json_bytes": result.json_bytes,
        "image_bytes": result.image_bytes,
        "image_count": result.image_count,
        "serialize_ms": result.serialize_ms,
        "write_ms": result.write_ms,
        "zip_ms": result.zip_ms,
        "total_ms": total_ms,
    }))
}

#[tauri::command]
async fn read_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
) -> Result<serde_json::Value, String> {
    let mut result = tokio::task::spawn_blocking(move || read_board_file(&path))
        .await
        .map_err(|e| e.to_string())??;

    {
        let cache_start = std::time::Instant::now();
        let mut cache = state.0.lock().map_err(|e| e.to_string())?;
        for (key, source) in result.sources.drain(..) {
            cache.insert(key, source);
        }
        result.stats.cache_insert_ms = cache_start.elapsed().as_secs_f64() * 1000.0;
    }

    Ok(serde_json::json!({
        "board": result.board,
        "debug": {
            "format": "container",
            "file_bytes": result.stats.file_bytes,
            "read_ms": result.stats.read_ms,
            "zip_open_ms": result.stats.zip_open_ms,
            "board_json_bytes": result.stats.board_json_bytes,
            "board_json_read_ms": result.stats.board_json_read_ms,
            "board_json_parse_ms": result.stats.board_json_parse_ms,
            "image_count": result.stats.image_count,
            "image_bytes": result.stats.image_bytes,
            "image_read_ms": result.stats.image_read_ms,
            "cache_insert_ms": result.stats.cache_insert_ms,
            "base64_ms": result.stats.base64_ms,
            "total_ms": result.stats.total_ms,
        }
    }))
}

fn image_mime_ext_from_path(path: &str) -> (&'static str, &'static str) {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => ("image/jpeg", "jpg"),
        _ => ("image/png", "png"),
    }
}

#[tauri::command]
async fn register_image_file_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    path: String,
) -> Result<serde_json::Value, String> {
    let total = std::time::Instant::now();
    let (source, width, height) = tokio::task::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let (mime, ext) = image_mime_ext_from_path(&path);
        let dimensions = image::io::Reader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .into_dimensions()
            .map_err(|e| e.to_string())?;
        Ok::<_, String>((
            CachedImageSource {
                mime: mime.to_string(),
                ext: ext.to_string(),
                bytes: Arc::from(bytes),
            },
            dimensions.0,
            dimensions.1,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;
    let bytes = source.bytes.len();
    let mime = source.mime.clone();
    let ext = source.ext.clone();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key, source);
    save_debug("register_image_file_source total", total);
    Ok(serde_json::json!({
        "bytes": bytes,
        "mime": mime,
        "ext": ext,
        "width": width,
        "height": height,
    }))
}

#[tauri::command]
fn get_cached_image_data_url(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let source = state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&img_key)
        .cloned()
        .ok_or_else(|| format!("image source cache missing for {img_key}"))?;
    Ok(format!(
        "data:{};base64,{}",
        source.mime,
        general_purpose::STANDARD.encode(&source.bytes)
    ))
}

fn sanitize_image_cache_key(key: &str) -> String {
    key.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn image_source_cache_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("boardfish-image-cache")
}

fn image_source_batch_dir() -> std::path::PathBuf {
    let batch = IMAGE_ASSET_BATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    image_source_cache_dir().join(format!("{}-{millis}-{batch}", std::process::id()))
}

fn image_source_file_path(
    dir: &std::path::Path,
    key: &str,
    source: &CachedImageSource,
) -> std::path::PathBuf {
    let key = sanitize_image_cache_key(key);
    let ext = sanitize_image_cache_key(&source.ext);
    dir.join(format!("{key}.{ext}"))
}

#[tauri::command]
async fn materialize_cached_image_sources(
    state: tauri::State<'_, ImageSourceCache>,
    img_keys: Vec<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let sources = {
        let cache = state.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(img_keys.len());
        for key in img_keys {
            let source = cache
                .get(&key)
                .cloned()
                .ok_or_else(|| format!("image source cache missing for {key}"))?;
            sources.push((key, source));
        }
        sources
    };

    tokio::task::spawn_blocking(move || {
        let dir = image_source_batch_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut result = Vec::with_capacity(sources.len());
        for (key, source) in sources {
            let path = image_source_file_path(&dir, &key, &source);
            std::fs::write(&path, &source.bytes).map_err(|e| e.to_string())?;
            result.push(serde_json::json!({
                "img_key": key,
                "path": path.to_string_lossy(),
                "mime": source.mime,
                "bytes": source.bytes.len(),
            }));
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
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
async fn pick_image_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Images", &["png", "jpg", "jpeg"])
            .blocking_pick_files()
            .map(|paths| paths.into_iter().map(|p| p.to_string()).collect())
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
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
async fn save_text_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let hex = {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos() as u64)
            .unwrap_or(0);
        format!("{:06x}", nanos & 0xFFFFFF)
    };
    let default_name = format!("text_{}.txt", hex);
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Text", &["txt"])
            .set_file_name(default_name)
            .blocking_save_file()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_text_file(path: String, text: String) -> Result<(), String> {
    tokio::fs::write(path, text.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_image_file_dialog(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    tokio::task::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .add_filter("Image", &["png", "jpg", "jpeg"]);
        if let Some(name) = default_name {
            builder = builder.set_file_name(name);
        }
        builder.blocking_save_file().map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_image_file(path: String, data_url: String) -> Result<(), String> {
    use base64::{engine::general_purpose, Engine as _};

    let (_, base64_data) = data_url.split_once(',').ok_or("invalid data URL")?;
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    tokio::fs::write(path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn ext_from_data_url_header(header: &str) -> &'static str {
    if header.starts_with("data:image/jpeg") {
        "jpg"
    } else {
        "png"
    }
}

fn mime_from_data_url_header(header: &str) -> &'static str {
    if header.starts_with("data:image/jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    }
}

fn cached_source_from_data_url(data_url: &str) -> Result<CachedImageSource, String> {
    use base64::{engine::general_purpose, Engine as _};
    let (header, base64_data) = data_url.split_once(',').ok_or("invalid data URL")?;
    Ok(CachedImageSource {
        mime: mime_from_data_url_header(header).to_string(),
        ext: ext_from_data_url_header(header).to_string(),
        bytes: Arc::from(
            general_purpose::STANDARD
                .decode(base64_data)
                .map_err(|e| e.to_string())?,
        ),
    })
}

#[tauri::command]
async fn register_image_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    data_url: String,
) -> Result<serde_json::Value, String> {
    let total = std::time::Instant::now();
    let source = tokio::task::spawn_blocking(move || cached_source_from_data_url(&data_url))
        .await
        .map_err(|e| e.to_string())??;
    let bytes = source.bytes.len();
    let mime = source.mime.clone();
    let ext = source.ext.clone();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key, source);
    save_debug("register_image_source total", total);
    Ok(serde_json::json!({
        "bytes": bytes,
        "mime": mime,
        "ext": ext,
    }))
}

#[tauri::command]
async fn register_transformed_image_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    temp_key: String,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
) -> Result<serde_json::Value, String> {
    let total = std::time::Instant::now();
    let source = {
        let cache = state.0.lock().map_err(|e| e.to_string())?;
        cache
            .get(&img_key)
            .cloned()
            .ok_or_else(|| format!("image source cache missing for {img_key}"))?
    };

    let normalized_rotation = rotation % 360;
    let result = tokio::task::spawn_blocking(move || {
        let decode_start = std::time::Instant::now();
        let mut img = image::load_from_memory(&source.bytes).map_err(|e| e.to_string())?;
        let decode_ms = elapsed_ms(decode_start);

        let transform_start = std::time::Instant::now();
        img = match normalized_rotation {
            90 => img.rotate90(),
            180 => img.rotate180(),
            270 => img.rotate270(),
            _ => img,
        };
        if flip_x {
            img = img.fliph();
        }
        if flip_y {
            img = img.flipv();
        }
        let width = img.width();
        let height = img.height();
        let transform_ms = elapsed_ms(transform_start);

        let encode_start = std::time::Instant::now();
        let rgba = img.to_rgba8();
        let mut png_bytes = Vec::new();
        {
            use image::codecs::png::{CompressionType, FilterType, PngEncoder};
            use image::{ColorType, ImageEncoder};
            let encoder = PngEncoder::new_with_quality(
                &mut png_bytes,
                CompressionType::Fast,
                FilterType::NoFilter,
            );
            encoder
                .write_image(rgba.as_raw(), width, height, ColorType::Rgba8)
                .map_err(|e| e.to_string())?;
        }
        let encode_ms = elapsed_ms(encode_start);
        let bytes = png_bytes.len();

        Ok::<_, String>((
            CachedImageSource {
                mime: "image/png".to_string(),
                ext: "png".to_string(),
                bytes: Arc::from(png_bytes),
            },
            serde_json::json!({
                "bytes": bytes,
                "mime": "image/png",
                "ext": "png",
                "width": width,
                "height": height,
                "flipX": flip_x,
                "flipY": flip_y,
                "rotation": normalized_rotation,
                "decodeMs": decode_ms,
                "transformMs": transform_ms,
                "encodeMs": encode_ms,
            }),
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    let (transformed_source, mut debug) = result;
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(temp_key.clone(), transformed_source);
    debug["imgKey"] = serde_json::Value::String(img_key);
    debug["tempKey"] = serde_json::Value::String(temp_key);
    debug["totalMs"] = serde_json::Value::from(elapsed_ms(total));
    save_debug("register_transformed_image_source total", total);
    Ok(debug)
}

#[tauri::command]
fn remove_cached_image_sources(
    state: tauri::State<'_, ImageSourceCache>,
    img_keys: Vec<String>,
) -> Result<usize, String> {
    let mut cache = state.0.lock().map_err(|e| e.to_string())?;
    let mut removed = 0usize;
    for key in img_keys {
        if cache.remove(&key).is_some() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|p| p.to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_images_to_existing_folder_by_keys(
    state: tauri::State<'_, ImageSourceCache>,
    folder: String,
    img_keys: Vec<String>,
) -> Result<serde_json::Value, String> {
    let total_start = std::time::Instant::now();
    if img_keys.is_empty() {
        return Ok(serde_json::json!({
            "savedCount": 0usize,
            "failedCount": 0usize,
            "missingCount": 0usize,
            "bytes": 0usize,
            "errors": [],
        }));
    }

    let mut missing = Vec::new();
    let sources: Vec<(String, CachedImageSource)> = {
        let cache = state.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(img_keys.len());
        for key in &img_keys {
            if let Some(source) = cache.get(key) {
                sources.push((key.clone(), source.clone()));
            } else {
                missing.push(key.clone());
            }
        }
        sources
    };

    let base = std::path::PathBuf::from(folder);
    let mut saved_count = 0usize;
    let mut failed_count = 0usize;
    let mut bytes_written = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (i, (_key, source)) in sources.iter().enumerate() {
        let hex = {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() as u64)
                .unwrap_or(i as u64);
            format!("{:06x}", (nanos ^ (i as u64 * 0x9e3779b9)) & 0xFFFFFF)
        };
        let filename = format!("image_{}.{}", hex, source.ext);
        let path = base.join(&filename);
        match tokio::fs::write(&path, &*source.bytes).await {
            Ok(_) => {
                saved_count += 1;
                bytes_written += source.bytes.len();
            }
            Err(err) => {
                failed_count += 1;
                if errors.len() < 10 {
                    errors.push(format!("{}: {}", filename, err));
                }
            }
        }
    }

    save_debug("save_images_to_existing_folder_by_keys total", total_start);
    Ok(serde_json::json!({
        "savedCount": saved_count,
        "failedCount": failed_count,
        "missingCount": missing.len(),
        "requestedCount": img_keys.len(),
        "sourceCount": sources.len(),
        "bytes": bytes_written,
        "errors": errors,
        "missing": missing.iter().take(10).collect::<Vec<_>>(),
    }))
}

#[tauri::command]
fn set_title(window: tauri::Window, title: String) {
    window.set_title(&title).ok();
    #[cfg(target_os = "macos")]
    unsafe {
        configure_macos_window_title_bar(&window);
    }
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

#[tauri::command]
fn acknowledge_close_request(seq: u64) {
    CLOSE_ACK_SEQ.fetch_max(seq, Ordering::SeqCst);
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
fn set_save_debug(enabled: bool) {
    SAVE_DEBUG.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_open_debug(enabled: bool) {
    OPEN_DEBUG.store(enabled, Ordering::Relaxed);
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
async fn copy_image_data_url_to_clipboard_transformed(
    data_url: String,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
) -> Result<ClipboardCopyTiming, String> {
    let total = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let (cached, decode_timing) = decode_data_url_to_cached_image_timed(&data_url)?;
        let normalized_rotation = rotation % 360;
        let transform = std::time::Instant::now();
        let (width, height, rgba) = transform_rgba(
            cached.width,
            cached.height,
            cached.rgba,
            flip_x,
            flip_y,
            normalized_rotation,
        )?;
        let transform_ms = elapsed_ms(transform);
        clipboard_debug(
            "copy_image_data_url_to_clipboard_transformed transform worker",
            transform,
        );
        let write_timing = write_rgba_to_clipboard(width, height, rgba)?;
        let mut timing = ClipboardCopyTiming {
            path: "data-url-rgba".to_string(),
            cache_hit: false,
            flipped: flip_x || flip_y,
            width,
            height,
            pixels: width as u64 * height as u64,
            rgba_mb: rgba_mb(width, height),
            decode_ms: decode_timing.decode_ms,
            base64_ms: decode_timing.base64_ms,
            image_decode_ms: decode_timing.image_decode_ms,
            rgba_convert_ms: decode_timing.rgba_convert_ms,
            transform_ms: Some(transform_ms),
            clipboard_write_ms: write_timing.clipboard_write_ms,
            arboard_ms: write_timing.arboard_ms,
            macos_fallback_ms: write_timing.macos_fallback_ms,
            ..Default::default()
        };
        timing.total_ms = elapsed_ms(total);
        Ok::<_, String>(timing)
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
    rotation: u32,
) -> Result<(u32, u32, Arc<[u8]>), String> {
    let normalized_rotation = rotation % 360;
    if !flip_x && !flip_y && normalized_rotation == 0 {
        return Ok((width, height, rgba));
    }

    let mut img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or("invalid RGBA buffer dimensions")?;
    img = match normalized_rotation {
        90 => image::imageops::rotate90(&img),
        180 => image::imageops::rotate180(&img),
        270 => image::imageops::rotate270(&img),
        _ => img,
    };
    if flip_x {
        image::imageops::flip_horizontal_in_place(&mut img);
    }
    if flip_y {
        image::imageops::flip_vertical_in_place(&mut img);
    }
    let width = img.width();
    let height = img.height();
    Ok((width, height, Arc::from(img.into_raw())))
}

fn decode_data_url_to_cached_image_timed(
    data_url: &str,
) -> Result<(CachedClipboardImage, ClipboardCopyTiming), String> {
    use base64::{engine::general_purpose, Engine as _};
    let total = std::time::Instant::now();
    let base64_data = data_url.split(',').nth(1).ok_or("invalid data URL")?;
    let base64_decode = std::time::Instant::now();
    let bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| e.to_string())?;
    let base64_ms = elapsed_ms(base64_decode);
    clipboard_debug("decode_data_url base64", base64_decode);
    let image_decode = std::time::Instant::now();
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let image_decode_ms = elapsed_ms(image_decode);
    clipboard_debug("decode_data_url image decode", image_decode);
    let rgba_convert = std::time::Instant::now();
    let rgba = img.to_rgba8();
    let rgba_convert_ms = elapsed_ms(rgba_convert);
    clipboard_debug("decode_data_url rgba convert", rgba_convert);
    let (width, height) = rgba.dimensions();
    let decode_ms = elapsed_ms(total);
    clipboard_debug("decode_data_url total", total);
    let cached = CachedClipboardImage {
        width,
        height,
        rgba: Arc::from(rgba.into_raw()),
    };
    Ok((
        cached,
        ClipboardCopyTiming {
            width,
            height,
            pixels: width as u64 * height as u64,
            rgba_mb: rgba_mb(width, height),
            decode_ms: Some(decode_ms),
            base64_ms: Some(base64_ms),
            image_decode_ms: Some(image_decode_ms),
            rgba_convert_ms: Some(rgba_convert_ms),
            ..Default::default()
        },
    ))
}

#[tauri::command]
async fn read_image_from_clipboard_cached(
    state: tauri::State<'_, ClipboardImageCache>,
    source_state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
) -> Result<String, String> {
    let total = std::time::Instant::now();
    let (data_url, cached, source) = tokio::task::spawn_blocking(|| {
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
        let source = CachedImageSource {
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            bytes: Arc::from(png_bytes.clone()),
        };
        Ok::<_, String>((
            format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(&png_bytes)
            ),
            cached,
            source,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    let lock = std::time::Instant::now();
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key.clone(), cached);
    source_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(img_key, source);
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
fn clear_clipboard_image_cache(
    state: tauri::State<ClipboardImageCache>,
    source_state: tauri::State<ImageSourceCache>,
) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.clear();
    source_state.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

fn write_rgba_to_clipboard(
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
) -> Result<ClipboardCopyTiming, String> {
    let total = std::time::Instant::now();
    let arboard_write = std::time::Instant::now();
    let result = arboard::Clipboard::new()
        .map_err(|e| e.to_string())
        .and_then(|mut cb| {
            cb.set_image(arboard::ImageData {
                width: width as usize,
                height: height as usize,
                bytes: std::borrow::Cow::Borrowed(&rgba),
            })
            .map_err(|e| e.to_string())
        });
    let arboard_ms = elapsed_ms(arboard_write);
    clipboard_debug("write_rgba_to_clipboard arboard set_image", arboard_write);
    if let Err(ref e) = result {
        clipboard_debug_msg(&format!("write_rgba_to_clipboard failed error={e}"));
    } else {
        clipboard_debug("write_rgba_to_clipboard total", total);
    }
    result?;

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
        let macos_fallback_ms = elapsed_ms(fallback);
        clipboard_debug("write_rgba_to_clipboard macos fallback", fallback);
        clipboard_debug("write_rgba_to_clipboard total", total);
        Ok(ClipboardCopyTiming {
            path: "write-rgba".to_string(),
            width,
            height,
            pixels: width as u64 * height as u64,
            rgba_mb: rgba_mb(width, height),
            clipboard_write_ms: Some(elapsed_ms(total)),
            arboard_ms: Some(arboard_ms),
            macos_fallback_ms: Some(macos_fallback_ms),
            ..Default::default()
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(ClipboardCopyTiming {
            path: "write-rgba".to_string(),
            width,
            height,
            pixels: width as u64 * height as u64,
            rgba_mb: rgba_mb(width, height),
            clipboard_write_ms: Some(elapsed_ms(total)),
            arboard_ms: Some(arboard_ms),
            ..Default::default()
        })
    }
}

fn emit_close_request(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let seq = CLOSE_REQUEST_SEQ.fetch_add(1, Ordering::SeqCst);
        window.show().ok();
        window.set_focus().ok();
        window.emit("boardfish://close-requested", seq).ok();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if CLOSE_ACK_SEQ.load(Ordering::SeqCst) < seq {
                std::process::exit(0);
            }
        });
    }
}

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartupFile(Mutex::new(startup_file)))
        .manage(ClipboardImageCache(Mutex::new(HashMap::new())))
        .manage(ImageSourceCache(Mutex::new(HashMap::new())))
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
            clear_clipboard_image_cache
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let seq = CLOSE_REQUEST_SEQ.fetch_add(1, Ordering::SeqCst);
                window.emit("boardfish://close-requested", seq).ok();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    if CLOSE_ACK_SEQ.load(Ordering::SeqCst) < seq {
                        std::process::exit(0);
                    }
                });
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
            #[cfg(not(target_os = "macos"))]
            let _ = app;

            #[cfg(target_os = "macos")]
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
                let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                unsafe {
                    configure_macos_webview_title_bar(&window);
                }
            }

            #[cfg(target_os = "macos")]
            unsafe {
                // Keep the close confirmation path alive for Cmd+Q and dock quits.
                setup_termination_intercept(app_handle.clone());
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
