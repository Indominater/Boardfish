use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::image_sources::{CachedImageSource, ImageSourceCache};
use crate::image_transform::transform_dynamic_image;
use crate::{elapsed_ms, rgba_mb};

static CLIPBOARD_DEBUG: AtomicBool = AtomicBool::new(false);

#[derive(Clone)]
struct CachedClipboardImage {
    width: u32,
    height: u32,
    rgba: Arc<[u8]>,
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardCopyTiming {
    path: String,
    flipped: bool,
    width: u32,
    height: u32,
    pixels: u64,
    rgba_mb: f64,
    total_ms: f64,
    decode_ms: Option<f64>,
    base64_ms: Option<f64>,
    image_decode_ms: Option<f64>,
    rgba_convert_ms: Option<f64>,
    transform_ms: Option<f64>,
    clipboard_write_ms: Option<f64>,
    arboard_ms: Option<f64>,
    macos_fallback_ms: Option<f64>,
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClipboardReadImageResponse {
    img_key: String,
    path: String,
    width: u32,
    height: u32,
    pixels: u64,
    rgba_mb: f64,
    bytes: usize,
    mime: String,
    ext: String,
    total_ms: f64,
    read_ms: Option<f64>,
    png_encode_ms: Option<f64>,
    cache_insert_ms: Option<f64>,
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
pub(crate) fn clipboard_sequence() -> Result<u64, String> {
    Ok(native_clipboard_sequence())
}

#[tauri::command]
pub(crate) fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let total = std::time::Instant::now();
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())?;
    clipboard_debug("copy_text_to_clipboard total", total);
    Ok(())
}

#[tauri::command]
pub(crate) async fn copy_image_data_url_to_clipboard_transformed(
    data_url: String,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
) -> Result<ClipboardCopyTiming, String> {
    let total = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        let (cached, decode_timing) = decode_data_url_to_cached_image_timed(&data_url)?;
        let transform = std::time::Instant::now();
        let (width, height, rgba) = transform_rgba(
            cached.width,
            cached.height,
            cached.rgba,
            flip_x,
            flip_y,
            rotation,
        )?;
        let transform_ms = elapsed_ms(transform);
        clipboard_debug(
            "copy_image_data_url_to_clipboard_transformed transform worker",
            transform,
        );
        let write_timing = write_rgba_to_clipboard(width, height, rgba)?;
        let mut timing = ClipboardCopyTiming {
            path: "data-url-rgba".to_string(),
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

    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or("invalid RGBA buffer dimensions")?;
    let img = transform_dynamic_image(
        image::DynamicImage::ImageRgba8(img),
        flip_x,
        flip_y,
        normalized_rotation,
    )
    .to_rgba8();
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
pub(crate) async fn read_image_from_clipboard_cached(
    source_state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    source_token: Option<String>,
) -> Result<ClipboardReadImageResponse, String> {
    let total = std::time::Instant::now();
    let img_key_for_worker = img_key.clone();
    let (source, mut response) = tokio::task::spawn_blocking(move || {
        let read = std::time::Instant::now();
        let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        let img = clipboard.get_image().map_err(|e| e.to_string())?;
        let read_ms = elapsed_ms(read);
        clipboard_debug("read_image_from_clipboard_cached get_image", read);

        let width = img.width as u32;
        let height = img.height as u32;
        let rgba_bytes = img.bytes.into_owned();

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
        let png_encode_ms = elapsed_ms(encode);
        clipboard_debug("read_image_from_clipboard_cached png encode", encode);
        let bytes = png_bytes.len();
        let source = CachedImageSource {
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            bytes: Arc::from(png_bytes),
        };
        let response = ClipboardReadImageResponse {
            img_key: img_key_for_worker,
            path: "native-image-cache".to_string(),
            width,
            height,
            pixels: width as u64 * height as u64,
            rgba_mb: rgba_mb(width, height),
            bytes,
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            read_ms: Some(read_ms),
            png_encode_ms: Some(png_encode_ms),
            ..Default::default()
        };
        Ok::<_, String>((source, response))
    })
    .await
    .map_err(|e| e.to_string())??;

    let lock = std::time::Instant::now();
    source_state.insert(img_key, source, source_token)?;
    response.cache_insert_ms = Some(elapsed_ms(lock));
    response.total_ms = elapsed_ms(total);
    clipboard_debug("read_image_from_clipboard_cached lock+insert", lock);
    clipboard_debug("read_image_from_clipboard_cached total", total);
    Ok(response)
}

#[tauri::command]
pub(crate) async fn read_text_from_clipboard() -> Result<String, String> {
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
