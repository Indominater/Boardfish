use std::sync::Arc;

use crate::image_sources::CachedImageSource;

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
    for (key, source) in sources {
        let path = format!("images/{}.{}", key, source.ext);
        zip.start_file(path, image_options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&source.bytes).map_err(|e| e.to_string())?;
        image_bytes += source.bytes.len();
    }
    zip.finish().map_err(|e| e.to_string())?;
    let write_ms = write_start.elapsed().as_secs_f64() * 1000.0;

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

pub(crate) fn read_board_file(path: &str) -> Result<BoardReadResult, String> {
    use std::io::Read;

    let total_start = std::time::Instant::now();
    let mut stats = BoardReadStats::default();

    let read_start = std::time::Instant::now();
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    stats.read_ms = read_start.elapsed().as_secs_f64() * 1000.0;
    stats.file_bytes = bytes.len();

    if !bytes.starts_with(b"PK\x03\x04") {
        return Err("unsupported Boardfish file; expected container .bf".to_string());
    }

    let zip_start = std::time::Instant::now();
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    stats.zip_open_ms = zip_start.elapsed().as_secs_f64() * 1000.0;

    let mut board: serde_json::Value = {
        let json_read_start = std::time::Instant::now();
        let mut board_file = archive.by_name("board.json").map_err(|e| e.to_string())?;
        let mut board_json = String::new();
        board_file
            .read_to_string(&mut board_json)
            .map_err(|e| e.to_string())?;
        stats.board_json_read_ms = json_read_start.elapsed().as_secs_f64() * 1000.0;
        stats.board_json_bytes = board_json.len();

        let parse_start = std::time::Instant::now();
        let parsed = serde_json::from_str(&board_json).map_err(|e| e.to_string())?;
        stats.board_json_parse_ms = parse_start.elapsed().as_secs_f64() * 1000.0;
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

    use super::{read_board_file, write_board_container};
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

        let result = read_board_file(path.to_str().unwrap()).unwrap();
        assert_eq!(result.sources.len(), 1);
        assert_eq!(result.sources[0].0, "img-1");
        assert_eq!(&*result.sources[0].1.bytes, &[1, 2, 3, 4]);
        assert_eq!(
            result.board["imageStore"]["img-1"]["native"],
            serde_json::Value::Bool(true)
        );

        let _ = std::fs::remove_file(path);
    }
}
