use std::sync::Arc;

use crate::image_sources::CachedImageSource;

#[derive(Clone, Copy)]
pub(crate) struct BoardLimits {
    pub(crate) max_objects: usize,
    pub(crate) max_content_bytes: usize,
}

pub(crate) struct BoardWriteStats {
    pub(crate) json_bytes: usize,
    pub(crate) image_bytes: usize,
    pub(crate) image_count: usize,
    pub(crate) serialize_ms: f64,
    pub(crate) write_ms: f64,
    pub(crate) zip_ms: f64,
}

pub(crate) fn write_board_container(
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

    let write_start = std::time::Instant::now();
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let json_options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("board.json", json_options)
        .map_err(|e| e.to_string())?;
    zip.write_all(&board_json).map_err(|e| e.to_string())?;

    let image_options = FileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut image_bytes = 0usize;
    let mut image_count = 0usize;
    for (key, source) in sources {
        let path = format!("images/{}.{}", key, source.ext);
        zip.start_file(path, image_options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&source.bytes).map_err(|e| e.to_string())?;
        image_bytes += source.bytes.len();
        image_count += 1;
    }
    zip.finish().map_err(|e| e.to_string())?;
    let write_ms = write_start.elapsed().as_secs_f64() * 1000.0;

    Ok(BoardWriteStats {
        json_bytes: board_json.len(),
        image_bytes,
        image_count,
        serialize_ms,
        write_ms,
        zip_ms: zip_start.elapsed().as_secs_f64() * 1000.0,
    })
}

#[derive(Default)]
pub(crate) struct BoardReadStats {
    pub(crate) file_bytes: usize,
    pub(crate) read_ms: f64,
    pub(crate) zip_open_ms: f64,
    pub(crate) board_json_bytes: usize,
    pub(crate) board_json_read_ms: f64,
    pub(crate) board_json_parse_ms: f64,
    pub(crate) image_count: usize,
    pub(crate) image_bytes: usize,
    pub(crate) image_read_ms: f64,
    pub(crate) cache_insert_ms: f64,
    pub(crate) total_ms: f64,
}

pub(crate) struct BoardReadResult {
    pub(crate) board: serde_json::Value,
    pub(crate) sources: Vec<(String, CachedImageSource)>,
    pub(crate) stats: BoardReadStats,
}

fn board_object_count(board: &serde_json::Value) -> usize {
    board
        .get("objects")
        .and_then(|value| value.as_array())
        .map(|objects| objects.len())
        .unwrap_or(0)
}

fn format_limit_bytes(bytes: usize) -> String {
    let mb = ((bytes as f64 / 1024.0 / 1024.0) * 10.0).round() / 10.0;
    if (mb.fract()).abs() < f64::EPSILON {
        format!("{} MB", mb as usize)
    } else {
        format!("{mb:.1} MB")
    }
}

pub(crate) fn validate_board_limits(
    limits: BoardLimits,
    board: &serde_json::Value,
    board_json_bytes: usize,
    image_bytes: usize,
) -> Result<(), String> {
    let object_count = board_object_count(board);
    if object_count > limits.max_objects {
        return Err(format!(
            "This board has {object_count} objects; Boardfish is limited to {} objects.",
            limits.max_objects
        ));
    }
    let total_bytes = board_json_bytes.saturating_add(image_bytes);
    if total_bytes > limits.max_content_bytes {
        return Err(format!(
            "This board is {}; Boardfish boards are limited to {}.",
            format_limit_bytes(total_bytes),
            format_limit_bytes(limits.max_content_bytes)
        ));
    }
    Ok(())
}

fn validate_board_content_bytes(
    limits: Option<BoardLimits>,
    board_json_bytes: usize,
    image_bytes: usize,
) -> Result<(), String> {
    let Some(limits) = limits else {
        return Ok(());
    };
    let total_bytes = board_json_bytes.saturating_add(image_bytes);
    if total_bytes > limits.max_content_bytes {
        return Err(format!(
            "This board is {}; Boardfish boards are limited to {}.",
            format_limit_bytes(total_bytes),
            format_limit_bytes(limits.max_content_bytes)
        ));
    }
    Ok(())
}

fn zip_size_to_usize(size: u64) -> Result<usize, String> {
    usize::try_from(size).map_err(|_| "Boardfish container entry is too large.".to_string())
}

fn read_zip_entry_bytes<R: std::io::Read>(
    reader: &mut R,
    advertised_size: usize,
    board_json_bytes: usize,
    existing_image_bytes: usize,
    limits: Option<BoardLimits>,
) -> Result<Vec<u8>, String> {
    validate_board_content_bytes(
        limits,
        board_json_bytes,
        existing_image_bytes.saturating_add(advertised_size),
    )?;

    let mut bytes = Vec::with_capacity(advertised_size);
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        validate_board_content_bytes(
            limits,
            board_json_bytes,
            existing_image_bytes
                .saturating_add(bytes.len())
                .saturating_add(read),
        )?;
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(bytes)
}

pub(crate) fn read_board_file_with_limits(
    path: &str,
    limits: Option<BoardLimits>,
) -> Result<BoardReadResult, String> {
    use std::io::{Read, Seek};

    let total_start = std::time::Instant::now();
    let mut stats = BoardReadStats::default();

    let read_start = std::time::Instant::now();
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    stats.file_bytes = file
        .metadata()
        .ok()
        .and_then(|metadata| usize::try_from(metadata.len()).ok())
        .unwrap_or(usize::MAX);
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if magic != *b"PK\x03\x04" {
        return Err("unsupported Boardfish file; expected container .bf".to_string());
    }
    file.seek(std::io::SeekFrom::Start(0))
        .map_err(|e| e.to_string())?;
    stats.read_ms = read_start.elapsed().as_secs_f64() * 1000.0;

    let zip_start = std::time::Instant::now();
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    stats.zip_open_ms = zip_start.elapsed().as_secs_f64() * 1000.0;

    let mut board: serde_json::Value = {
        let json_read_start = std::time::Instant::now();
        let mut board_file = archive.by_name("board.json").map_err(|e| e.to_string())?;
        let board_json_size = zip_size_to_usize(board_file.size())?;
        let board_json_bytes =
            read_zip_entry_bytes(&mut board_file, board_json_size, 0, 0, limits)?;
        let board_json = String::from_utf8(board_json_bytes).map_err(|e| e.to_string())?;
        stats.board_json_read_ms = json_read_start.elapsed().as_secs_f64() * 1000.0;
        stats.board_json_bytes = board_json.len();
        validate_board_content_bytes(limits, stats.board_json_bytes, 0)?;

        let parse_start = std::time::Instant::now();
        let parsed = serde_json::from_str(&board_json).map_err(|e| e.to_string())?;
        stats.board_json_parse_ms = parse_start.elapsed().as_secs_f64() * 1000.0;
        parsed
    };
    if let Some(limits) = limits {
        validate_board_limits(limits, &board, stats.board_json_bytes, 0)?;
    }

    let entries = board.get("imageStore").and_then(|v| v.as_object());
    let mut image_store = serde_json::Map::new();
    let mut sources = Vec::with_capacity(entries.map_or(0, |entries| entries.len()));
    if let Some(entries) = entries {
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
            let image_size = zip_size_to_usize(image_file.size())?;
            let image_bytes = read_zip_entry_bytes(
                &mut image_file,
                image_size,
                stats.board_json_bytes,
                stats.image_bytes,
                limits,
            )?;
            stats.image_read_ms += image_read_start.elapsed().as_secs_f64() * 1000.0;
            stats.image_count += 1;
            stats.image_bytes += image_bytes.len();
            validate_board_content_bytes(limits, stats.board_json_bytes, stats.image_bytes)?;

            let source = CachedImageSource {
                mime: mime.clone(),
                ext: ext.clone(),
                bytes: Arc::from(image_bytes),
            };
            let source_key = key.clone();
            image_store.insert(
                source_key.clone(),
                serde_json::json!({
                    "native": true,
                    "path": entry_path,
                    "mime": mime,
                    "ext": ext,
                }),
            );
            sources.push((source_key, source));
        }
    }
    board["imageStore"] = serde_json::Value::Object(image_store);
    stats.total_ms = total_start.elapsed().as_secs_f64() * 1000.0;
    Ok(BoardReadResult {
        board,
        sources,
        stats,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{read_board_file_with_limits, write_board_container, BoardLimits};
    use crate::image_sources::CachedImageSource;

    fn temp_board_path() -> std::path::PathBuf {
        let name = format!(
            "boardfish-board-io-test-{}-{}.bf",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        std::env::temp_dir().join(name)
    }

    #[test]
    fn board_container_round_trips_embedded_images() {
        let path = temp_board_path();
        let board = serde_json::json!({
            "version": 3,
            "format": "boardfish-container",
            "viewport": { "panX": 1.0, "panY": 2.0, "zoom": 1.5 },
            "imageStore": {
                "img-1": { "native": true, "path": "images/img-1.png", "mime": "image/png", "ext": "png" }
            },
            "objects": [
                { "id": "obj-1", "type": "image", "x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0, "z": 1.0, "data": { "imgKey": "img-1" } }
            ]
        });
        let source = CachedImageSource {
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            bytes: Arc::from([1_u8, 2, 3, 4]),
        };

        let write_stats = write_board_container(
            path.to_str().unwrap(),
            board,
            vec![("img-1".to_string(), source)],
        )
        .unwrap();
        assert_eq!(write_stats.image_count, 1);
        assert_eq!(write_stats.image_bytes, 4);

        let result = read_board_file_with_limits(path.to_str().unwrap(), None).unwrap();
        assert_eq!(result.sources.len(), 1);
        assert_eq!(result.sources[0].0, "img-1");
        assert_eq!(&*result.sources[0].1.bytes, &[1, 2, 3, 4]);
        assert_eq!(
            result.board["imageStore"]["img-1"]["native"],
            serde_json::Value::Bool(true)
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn board_container_read_rejects_image_bytes_over_content_limit() {
        let path = temp_board_path();
        let board = serde_json::json!({
            "version": 3,
            "format": "boardfish-container",
            "imageStore": {
                "img-1": { "native": true, "path": "images/img-1.png", "mime": "image/png", "ext": "png" }
            },
            "objects": [
                { "id": "obj-1", "type": "image", "x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0, "z": 1.0, "data": { "imgKey": "img-1" } }
            ]
        });
        let source = CachedImageSource {
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            bytes: Arc::from([1_u8, 2, 3, 4]),
        };
        write_board_container(
            path.to_str().unwrap(),
            board,
            vec![("img-1".to_string(), source)],
        )
        .unwrap();
        let result = read_board_file_with_limits(path.to_str().unwrap(), None).unwrap();
        let err = match read_board_file_with_limits(
            path.to_str().unwrap(),
            Some(BoardLimits {
                max_objects: 100,
                max_content_bytes: result.stats.board_json_bytes + 3,
            }),
        ) {
            Ok(_) => panic!("expected board content limit error"),
            Err(err) => err,
        };
        assert!(err.contains("Boardfish boards are limited"));

        let _ = std::fs::remove_file(path);
    }
}
