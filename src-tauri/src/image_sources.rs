use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::image_data_url::cached_source_from_data_url;
use crate::image_source_files::{
    cleanup_materialized_paths, image_source_batch_dir, image_source_file_path,
};
use crate::image_transform::transform_dynamic_image;
use crate::{elapsed_ms, save_debug};

#[derive(Clone)]
pub(crate) struct CachedImageSource {
    pub(crate) mime: String,
    pub(crate) ext: String,
    pub(crate) bytes: Arc<[u8]>,
}

struct CachedImageSourceEntry {
    source: CachedImageSource,
    materialized_paths: Vec<PathBuf>,
}

type CachedImageSources = Vec<(String, CachedImageSource)>;
type CachedImageSourcesWithMissing = (CachedImageSources, Vec<String>);

#[derive(Default)]
pub(crate) struct ImageSourceCache(Mutex<HashMap<String, CachedImageSourceEntry>>);

impl ImageSourceCache {
    pub(crate) fn get(&self, key: &str) -> Result<CachedImageSource, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get(key)
            .map(|entry| entry.source.clone())
            .ok_or_else(|| format!("image source cache missing for {key}"))
    }

    pub(crate) fn get_many(&self, keys: &[String]) -> Result<CachedImageSources, String> {
        let cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(keys.len());
        for key in keys {
            let source = cache
                .get(key)
                .map(|entry| entry.source.clone())
                .ok_or_else(|| format!("image source cache missing for {key}"))?;
            sources.push((key.clone(), source));
        }
        Ok(sources)
    }

    fn get_many_with_missing(
        &self,
        keys: &[String],
    ) -> Result<CachedImageSourcesWithMissing, String> {
        let cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(keys.len());
        let mut missing = Vec::new();
        for key in keys {
            if let Some(entry) = cache.get(key) {
                sources.push((key.clone(), entry.source.clone()));
            } else {
                missing.push(key.clone());
            }
        }
        Ok((sources, missing))
    }

    pub(crate) fn insert(&self, key: String, source: CachedImageSource) -> Result<(), String> {
        let stale_paths = self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(
                key,
                CachedImageSourceEntry {
                    source,
                    materialized_paths: Vec::new(),
                },
            )
            .map(|entry| entry.materialized_paths)
            .unwrap_or_default();
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }

    pub(crate) fn replace_all(
        &self,
        sources: Vec<(String, CachedImageSource)>,
    ) -> Result<(), String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let stale_paths = drain_materialized_paths(&mut cache);
        cache.clear();
        for (key, source) in sources {
            cache.insert(
                key,
                CachedImageSourceEntry {
                    source,
                    materialized_paths: Vec::new(),
                },
            );
        }
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }

    fn record_materialized(&self, paths: Vec<(String, PathBuf)>) -> Result<(), String> {
        let mut orphaned_paths = Vec::new();
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        for (key, path) in paths {
            if let Some(entry) = cache.get_mut(&key) {
                entry.materialized_paths.push(path);
            } else {
                orphaned_paths.push(path);
            }
        }
        drop(cache);
        cleanup_materialized_paths(orphaned_paths);
        Ok(())
    }

    fn remove_many(&self, keys: Vec<String>) -> Result<usize, String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut removed = 0usize;
        let mut stale_paths = Vec::new();
        for key in keys {
            if let Some(entry) = cache.remove(&key) {
                stale_paths.extend(entry.materialized_paths);
                removed += 1;
            }
        }
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(removed)
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let stale_paths = drain_materialized_paths(&mut cache);
        cache.clear();
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }
}

impl Drop for ImageSourceCache {
    fn drop(&mut self) {
        if let Ok(mut cache) = self.0.lock() {
            let stale_paths = drain_materialized_paths(&mut cache);
            cache.clear();
            cleanup_materialized_paths(stale_paths);
        }
    }
}

fn drain_materialized_paths(cache: &mut HashMap<String, CachedImageSourceEntry>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for entry in cache.values_mut() {
        paths.append(&mut entry.materialized_paths);
    }
    paths
}

#[derive(serde::Serialize)]
pub(crate) struct ImageSourceResponse {
    bytes: usize,
    mime: String,
    ext: String,
}

#[derive(serde::Serialize)]
pub(crate) struct ImageFileSourceResponse {
    bytes: usize,
    mime: String,
    ext: String,
    width: u32,
    height: u32,
}

#[derive(serde::Serialize)]
pub(crate) struct MaterializedImageSource {
    img_key: String,
    path: String,
    mime: String,
    bytes: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransformedImageSourceResponse {
    bytes: usize,
    mime: &'static str,
    ext: &'static str,
    width: u32,
    height: u32,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
    decode_ms: f64,
    transform_ms: f64,
    encode_ms: f64,
    img_key: String,
    temp_key: String,
    total_ms: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveImagesResponse {
    saved_count: usize,
    failed_count: usize,
    missing_count: usize,
    requested_count: usize,
    source_count: usize,
    bytes: usize,
    errors: Vec<String>,
    missing: Vec<String>,
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
pub(crate) async fn register_image_file_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    path: String,
) -> Result<ImageFileSourceResponse, String> {
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
    state.insert(img_key, source)?;
    save_debug("register_image_file_source total", total);
    Ok(ImageFileSourceResponse {
        bytes,
        mime,
        ext,
        width,
        height,
    })
}

#[tauri::command]
pub(crate) fn get_cached_image_data_url(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let source = state.get(&img_key)?;
    Ok(format!(
        "data:{};base64,{}",
        source.mime,
        general_purpose::STANDARD.encode(&source.bytes)
    ))
}

#[tauri::command]
pub(crate) async fn materialize_cached_image_sources(
    state: tauri::State<'_, ImageSourceCache>,
    img_keys: Vec<String>,
) -> Result<Vec<MaterializedImageSource>, String> {
    let sources = state.get_many(&img_keys)?;

    let materialized = tokio::task::spawn_blocking(move || {
        let dir = image_source_batch_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut result = Vec::with_capacity(sources.len());
        for (key, source) in sources {
            let path = image_source_file_path(&dir, &key, &source.ext);
            std::fs::write(&path, &source.bytes).map_err(|e| e.to_string())?;
            result.push((
                MaterializedImageSource {
                    img_key: key,
                    path: path.to_string_lossy().to_string(),
                    mime: source.mime,
                    bytes: source.bytes.len(),
                },
                path,
            ));
        }
        Ok::<_, String>(result)
    })
    .await
    .map_err(|e| e.to_string())??;

    state.record_materialized(
        materialized
            .iter()
            .map(|(entry, path)| (entry.img_key.clone(), path.clone()))
            .collect(),
    )?;

    Ok(materialized
        .into_iter()
        .map(|(entry, _path)| entry)
        .collect())
}

#[tauri::command]
pub(crate) async fn write_image_file_by_key(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
    img_key: String,
) -> Result<ImageSourceResponse, String> {
    let source = state.get(&img_key)?;
    let bytes = source.bytes.len();
    let mime = source.mime.clone();
    let ext = source.ext.clone();
    tokio::fs::write(path, &*source.bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ImageSourceResponse { bytes, mime, ext })
}

#[tauri::command]
pub(crate) async fn register_image_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    data_url: String,
) -> Result<ImageSourceResponse, String> {
    let total = std::time::Instant::now();
    let source = tokio::task::spawn_blocking(move || cached_source_from_data_url(&data_url))
        .await
        .map_err(|e| e.to_string())??;
    let bytes = source.bytes.len();
    let mime = source.mime.clone();
    let ext = source.ext.clone();
    state.insert(img_key, source)?;
    save_debug("register_image_source total", total);
    Ok(ImageSourceResponse { bytes, mime, ext })
}

#[tauri::command]
pub(crate) async fn register_transformed_image_source(
    state: tauri::State<'_, ImageSourceCache>,
    img_key: String,
    temp_key: String,
    flip_x: bool,
    flip_y: bool,
    rotation: u32,
) -> Result<TransformedImageSourceResponse, String> {
    let total = std::time::Instant::now();
    let source = state.get(&img_key)?;

    let normalized_rotation = rotation % 360;
    let result = tokio::task::spawn_blocking(move || {
        let decode_start = std::time::Instant::now();
        let mut img = image::load_from_memory(&source.bytes).map_err(|e| e.to_string())?;
        let decode_ms = elapsed_ms(decode_start);

        let transform_start = std::time::Instant::now();
        img = transform_dynamic_image(img, flip_x, flip_y, normalized_rotation);
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
            (bytes, width, height, decode_ms, transform_ms, encode_ms),
        ))
    })
    .await
    .map_err(|e| e.to_string())??;

    let (transformed_source, (bytes, width, height, decode_ms, transform_ms, encode_ms)) = result;
    state.insert(temp_key.clone(), transformed_source)?;
    save_debug("register_transformed_image_source total", total);
    Ok(TransformedImageSourceResponse {
        bytes,
        mime: "image/png",
        ext: "png",
        width,
        height,
        flip_x,
        flip_y,
        rotation: normalized_rotation,
        decode_ms,
        transform_ms,
        encode_ms,
        img_key,
        temp_key,
        total_ms: elapsed_ms(total),
    })
}

#[tauri::command]
pub(crate) fn remove_cached_image_sources(
    state: tauri::State<'_, ImageSourceCache>,
    img_keys: Vec<String>,
) -> Result<usize, String> {
    state.remove_many(img_keys)
}

#[tauri::command]
pub(crate) async fn save_images_to_existing_folder_by_keys(
    state: tauri::State<'_, ImageSourceCache>,
    folder: String,
    img_keys: Vec<String>,
) -> Result<SaveImagesResponse, String> {
    let total_start = std::time::Instant::now();
    if img_keys.is_empty() {
        return Ok(SaveImagesResponse {
            saved_count: 0,
            failed_count: 0,
            missing_count: 0,
            requested_count: 0,
            source_count: 0,
            bytes: 0,
            errors: Vec::new(),
            missing: Vec::new(),
        });
    }

    let (sources, missing) = state.get_many_with_missing(&img_keys)?;

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
    Ok(SaveImagesResponse {
        saved_count,
        failed_count,
        missing_count: missing.len(),
        requested_count: img_keys.len(),
        source_count: sources.len(),
        bytes: bytes_written,
        errors,
        missing: missing.into_iter().take(10).collect(),
    })
}

#[tauri::command]
pub(crate) fn clear_image_source_cache(
    source_state: tauri::State<ImageSourceCache>,
) -> Result<(), String> {
    source_state.clear()
}
