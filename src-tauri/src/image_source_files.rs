use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static IMAGE_ASSET_BATCH_COUNTER: AtomicU64 = AtomicU64::new(1);
static IMAGE_ASSET_SESSION_MILLIS: OnceLock<u128> = OnceLock::new();
const STALE_IMAGE_CACHE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

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

fn image_source_cache_dir() -> PathBuf {
    std::env::temp_dir().join("boardfish-image-cache")
}

fn current_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn image_source_session_dir() -> PathBuf {
    let millis = *IMAGE_ASSET_SESSION_MILLIS.get_or_init(current_time_millis);
    image_source_cache_dir().join(format!("{}-{millis}", std::process::id()))
}

pub(crate) fn image_source_batch_dir() -> PathBuf {
    let batch = IMAGE_ASSET_BATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = current_time_millis();
    image_source_session_dir().join(format!("batch-{millis}-{batch}"))
}

pub(crate) fn image_source_file_path(dir: &Path, key: &str, ext: &str) -> PathBuf {
    let key = sanitize_image_cache_key(key);
    let ext = sanitize_image_cache_key(ext);
    dir.join(format!("{key}.{ext}"))
}

fn remove_empty_cache_dirs_from(dir: &Path, root: &Path) {
    let mut current = dir.to_path_buf();
    while current.starts_with(root) && current != root {
        match std::fs::remove_dir(&current) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => break,
        }
        if !current.pop() {
            break;
        }
    }
}

pub(crate) fn cleanup_materialized_paths(mut paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }

    let root = image_source_cache_dir();
    paths.sort();
    paths.dedup();
    for path in paths {
        if !path.starts_with(&root) {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(_) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => eprintln!(
                "[boardfish image cache] remove materialized file failed: {}: {err}",
                path.display()
            ),
        }
        if let Some(parent) = path.parent() {
            remove_empty_cache_dirs_from(parent, &root);
        }
    }
}

fn metadata_age(metadata: &std::fs::Metadata, now: SystemTime) -> Option<Duration> {
    metadata
        .modified()
        .ok()
        .or_else(|| metadata.created().ok())
        .and_then(|time| now.duration_since(time).ok())
}

fn cleanup_stale_image_source_cache_inner(
    root: &Path,
    current_session: &Path,
) -> Result<(usize, usize), String> {
    if !root.exists() {
        return Ok((0, 0));
    }

    let now = SystemTime::now();
    let mut removed = 0usize;
    let mut errors = 0usize;
    for entry_result in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let path = entry.path();
        if path == current_session {
            continue;
        }
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                errors += 1;
                continue;
            }
        };
        let Some(age) = metadata_age(&metadata, now) else {
            continue;
        };
        if age < STALE_IMAGE_CACHE_MAX_AGE {
            continue;
        }
        let result = if metadata.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        match result {
            Ok(_) => removed += 1,
            Err(_) => errors += 1,
        }
    }
    Ok((removed, errors))
}

pub(crate) fn cleanup_stale_image_source_cache() {
    let root = image_source_cache_dir();
    let current_session = image_source_session_dir();
    std::thread::spawn(move || {
        match cleanup_stale_image_source_cache_inner(&root, &current_session) {
            Ok((removed, errors)) if removed > 0 || errors > 0 => eprintln!(
                "[boardfish image cache] stale cleanup removed {removed} entries with {errors} errors"
            ),
            Ok(_) => {}
            Err(err) => eprintln!("[boardfish image cache] stale cleanup failed: {err}"),
        }
    });
}
