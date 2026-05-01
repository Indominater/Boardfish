use std::sync::Arc;

use crate::image_sources::CachedImageSource;
use crate::{open_debug, save_debug};

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
