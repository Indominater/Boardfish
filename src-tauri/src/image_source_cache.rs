use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::image_source_files::cleanup_materialized_paths;

#[derive(Clone)]
pub(crate) struct CachedImageSource {
    pub(crate) mime: String,
    pub(crate) ext: String,
    pub(crate) bytes: Arc<[u8]>,
}

#[derive(Clone)]
pub(crate) struct DecodedImageSource {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) rgba: Arc<[u8]>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageSourceCacheDebugEntry {
    img_key: String,
    mime: String,
    ext: String,
    source_bytes: usize,
    source_mb: f64,
    decoded: bool,
    decoded_bytes: usize,
    decoded_mb: f64,
    width: u32,
    height: u32,
    decoded_last_used: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageSourceCacheDebug {
    source_count: usize,
    decoded_count: usize,
    source_bytes: usize,
    source_mb: f64,
    decoded_bytes: usize,
    decoded_mb: f64,
    decoded_use_counter: u64,
    entries: Vec<ImageSourceCacheDebugEntry>,
}

struct CachedImageSourceEntry {
    source: CachedImageSource,
    materialized_paths: Vec<PathBuf>,
    decoded: Option<DecodedImageSource>,
    decoded_bytes: usize,
    decoded_last_used: u64,
    source_token: Option<String>,
}

type CachedImageSources = Vec<(String, CachedImageSource)>;
type CachedImageSourcesWithMissing = (CachedImageSources, Vec<String>);

#[derive(Default)]
struct ImageSourceCacheInner {
    entries: HashMap<String, CachedImageSourceEntry>,
    decoded_bytes: usize,
    decoded_use_counter: u64,
}

#[derive(Default)]
pub(crate) struct ImageSourceCache(Mutex<ImageSourceCacheInner>);

impl ImageSourceCache {
    pub(crate) fn debug_snapshot(&self) -> Result<ImageSourceCacheDebug, String> {
        let cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut entries = Vec::with_capacity(cache.entries.len());
        let mut source_bytes = 0usize;
        let mut decoded_count = 0usize;

        for (img_key, entry) in &cache.entries {
            source_bytes = source_bytes.saturating_add(entry.source.bytes.len());
            let decoded = entry.decoded.as_ref();
            let decoded_bytes = entry.decoded_bytes;
            if decoded.is_some() {
                decoded_count += 1;
            }
            entries.push(ImageSourceCacheDebugEntry {
                img_key: img_key.clone(),
                mime: entry.source.mime.clone(),
                ext: entry.source.ext.clone(),
                source_bytes: entry.source.bytes.len(),
                source_mb: bytes_mb(entry.source.bytes.len()),
                decoded: decoded.is_some(),
                decoded_bytes,
                decoded_mb: bytes_mb(decoded_bytes),
                width: decoded.map(|d| d.width).unwrap_or(0),
                height: decoded.map(|d| d.height).unwrap_or(0),
                decoded_last_used: entry.decoded_last_used,
            });
        }

        entries.sort_by(|a, b| {
            b.decoded_bytes
                .cmp(&a.decoded_bytes)
                .then_with(|| b.source_bytes.cmp(&a.source_bytes))
                .then_with(|| a.img_key.cmp(&b.img_key))
        });

        Ok(ImageSourceCacheDebug {
            source_count: cache.entries.len(),
            decoded_count,
            source_bytes,
            source_mb: bytes_mb(source_bytes),
            decoded_bytes: cache.decoded_bytes,
            decoded_mb: bytes_mb(cache.decoded_bytes),
            decoded_use_counter: cache.decoded_use_counter,
            entries,
        })
    }

    pub(crate) fn get(&self, key: &str) -> Result<CachedImageSource, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .entries
            .get(key)
            .map(|entry| entry.source.clone())
            .ok_or_else(|| format!("image source cache missing for {key}"))
    }

    pub(crate) fn get_decoded(&self, key: &str) -> Result<Option<DecodedImageSource>, String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let next_use = cache.decoded_use_counter.saturating_add(1);
        let decoded = cache.entries.get_mut(key).and_then(|entry| {
            let decoded = entry.decoded.clone();
            if decoded.is_some() {
                entry.decoded_last_used = next_use;
            }
            decoded
        });
        if decoded.is_some() {
            cache.decoded_use_counter = next_use;
        }
        Ok(decoded)
    }

    pub(crate) fn cache_decoded(
        &self,
        key: &str,
        source_bytes: &Arc<[u8]>,
        decoded: DecodedImageSource,
    ) -> Result<DecodedImageSource, String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let next_use = cache.decoded_use_counter.saturating_add(1);
        let mut bytes_delta: isize = 0;
        if let Some(entry) = cache.entries.get_mut(key) {
            if Arc::ptr_eq(&entry.source.bytes, source_bytes) {
                bytes_delta -= entry.decoded_bytes as isize;
                let decoded_bytes = decoded_image_bytes(&decoded);
                bytes_delta += decoded_bytes as isize;
                entry.decoded = Some(decoded.clone());
                entry.decoded_bytes = decoded_bytes;
                entry.decoded_last_used = next_use;
            }
        }
        cache.decoded_use_counter = next_use;
        if bytes_delta.is_negative() {
            cache.decoded_bytes = cache
                .decoded_bytes
                .saturating_sub(bytes_delta.unsigned_abs());
        } else {
            cache.decoded_bytes = cache.decoded_bytes.saturating_add(bytes_delta as usize);
        }
        Ok(decoded)
    }

    pub(crate) fn get_many(&self, keys: &[String]) -> Result<CachedImageSources, String> {
        let cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(keys.len());
        for key in keys {
            let source = cache
                .entries
                .get(key)
                .map(|entry| entry.source.clone())
                .ok_or_else(|| format!("image source cache missing for {key}"))?;
            sources.push((key.clone(), source));
        }
        Ok(sources)
    }

    pub(crate) fn get_many_with_missing(
        &self,
        keys: &[String],
    ) -> Result<CachedImageSourcesWithMissing, String> {
        let cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::with_capacity(keys.len());
        let mut missing = Vec::new();
        for key in keys {
            if let Some(entry) = cache.entries.get(key) {
                sources.push((key.clone(), entry.source.clone()));
            } else {
                missing.push(key.clone());
            }
        }
        Ok((sources, missing))
    }

    pub(crate) fn insert(
        &self,
        key: String,
        source: CachedImageSource,
        source_token: Option<String>,
    ) -> Result<(), String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let stale = cache.entries.insert(
            key,
            CachedImageSourceEntry {
                source,
                materialized_paths: Vec::new(),
                decoded: None,
                decoded_bytes: 0,
                decoded_last_used: 0,
                source_token,
            },
        );
        let stale_paths = if let Some(entry) = stale {
            cache.decoded_bytes = cache.decoded_bytes.saturating_sub(entry.decoded_bytes);
            entry.materialized_paths
        } else {
            Vec::new()
        };
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }

    pub(crate) fn replace_all(
        &self,
        sources: Vec<(String, CachedImageSource)>,
    ) -> Result<(), String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let stale_paths = drain_materialized_paths(&mut cache.entries);
        cache.entries.clear();
        cache.decoded_bytes = 0;
        for (key, source) in sources {
            cache.entries.insert(
                key,
                CachedImageSourceEntry {
                    source,
                    materialized_paths: Vec::new(),
                    decoded: None,
                    decoded_bytes: 0,
                    decoded_last_used: 0,
                    source_token: None,
                },
            );
        }
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }

    pub(crate) fn record_materialized(&self, paths: Vec<(String, PathBuf)>) -> Result<(), String> {
        let mut orphaned_paths = Vec::new();
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        for (key, path) in paths {
            if let Some(entry) = cache.entries.get_mut(&key) {
                entry.materialized_paths.push(path);
            } else {
                orphaned_paths.push(path);
            }
        }
        drop(cache);
        cleanup_materialized_paths(orphaned_paths);
        Ok(())
    }

    pub(crate) fn remove_many(
        &self,
        keys: Vec<String>,
        source_tokens: Option<Vec<String>>,
    ) -> Result<usize, String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let mut removed = 0usize;
        let mut stale_paths = Vec::new();
        for (index, key) in keys.into_iter().enumerate() {
            let expected_token = source_tokens.as_ref().and_then(|tokens| tokens.get(index));
            let should_remove = match (cache.entries.get(&key), expected_token) {
                (Some(entry), Some(token)) => entry.source_token.as_deref() == Some(token.as_str()),
                (Some(_), None) => true,
                (None, _) => false,
            };
            if !should_remove {
                continue;
            }
            if let Some(entry) = cache.entries.remove(&key) {
                stale_paths.extend(entry.materialized_paths);
                cache.decoded_bytes = cache.decoded_bytes.saturating_sub(entry.decoded_bytes);
                removed += 1;
            }
        }
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(removed)
    }

    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut cache = self.0.lock().map_err(|e| e.to_string())?;
        let stale_paths = drain_materialized_paths(&mut cache.entries);
        cache.entries.clear();
        cache.decoded_bytes = 0;
        drop(cache);
        cleanup_materialized_paths(stale_paths);
        Ok(())
    }
}

impl Drop for ImageSourceCache {
    fn drop(&mut self) {
        if let Ok(mut cache) = self.0.lock() {
            let stale_paths = drain_materialized_paths(&mut cache.entries);
            cache.entries.clear();
            cache.decoded_bytes = 0;
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

fn decoded_image_bytes(decoded: &DecodedImageSource) -> usize {
    decoded.rgba.len()
}

fn bytes_mb(bytes: usize) -> f64 {
    ((bytes as f64 / 1024.0 / 1024.0) * 100.0).round() / 100.0
}
