use crate::board_io::{
    read_board_file_with_limits, validate_board_limits as validate_board_limits_with,
    write_board_container, BoardLimits, BoardReadStats, BoardWriteStats,
};
use crate::board_types::validate_board_value;
use crate::image_sources::ImageSourceCache;
use crate::memory_limits::{BOARD_MAX_CONTENT_BYTES, BOARD_MAX_OBJECTS};
use tauri::Manager;

const BOARD_LIMITS: BoardLimits = BoardLimits {
    max_objects: BOARD_MAX_OBJECTS,
    max_content_bytes: BOARD_MAX_CONTENT_BYTES,
};

#[derive(serde::Serialize)]
pub(crate) struct SaveBoardResponse {
    format: &'static str,
    json_bytes: usize,
    image_bytes: usize,
    image_count: usize,
    validate_ms: f64,
    source_lookup_ms: f64,
    serialize_ms: f64,
    write_ms: f64,
    zip_ms: f64,
    total_ms: f64,
}

#[derive(serde::Serialize)]
pub(crate) struct ReadBoardDebug {
    format: &'static str,
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
    total_ms: f64,
}

#[derive(serde::Serialize)]
pub(crate) struct ReadBoardResponse {
    board: serde_json::Value,
    debug: ReadBoardDebug,
}

impl SaveBoardResponse {
    fn from_stats(
        stats: BoardWriteStats,
        total_ms: f64,
        validate_ms: f64,
        source_lookup_ms: f64,
    ) -> Self {
        Self {
            format: "container",
            json_bytes: stats.json_bytes,
            image_bytes: stats.image_bytes,
            image_count: stats.image_count,
            validate_ms,
            source_lookup_ms,
            serialize_ms: stats.serialize_ms,
            write_ms: stats.write_ms,
            zip_ms: stats.zip_ms,
            total_ms,
        }
    }
}

impl From<BoardReadStats> for ReadBoardDebug {
    fn from(stats: BoardReadStats) -> Self {
        Self {
            format: "container",
            file_bytes: stats.file_bytes,
            read_ms: stats.read_ms,
            zip_open_ms: stats.zip_open_ms,
            board_json_bytes: stats.board_json_bytes,
            board_json_read_ms: stats.board_json_read_ms,
            board_json_parse_ms: stats.board_json_parse_ms,
            image_count: stats.image_count,
            image_bytes: stats.image_bytes,
            image_read_ms: stats.image_read_ms,
            cache_insert_ms: stats.cache_insert_ms,
            total_ms: stats.total_ms,
        }
    }
}

fn validate_board_limits(
    board: &serde_json::Value,
    board_json_bytes: usize,
    image_bytes: usize,
) -> Result<(), String> {
    validate_board_limits_with(BOARD_LIMITS, board, board_json_bytes, image_bytes)
}

#[tauri::command]
pub(crate) async fn save_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
    board: serde_json::Value,
) -> Result<SaveBoardResponse, String> {
    let total_start = std::time::Instant::now();
    let validate_start = std::time::Instant::now();
    validate_board_value(&board)?;
    let validate_ms = validate_start.elapsed().as_secs_f64() * 1000.0;

    let source_lookup_start = std::time::Instant::now();
    let image_keys = board
        .get("imageStore")
        .and_then(|v| v.as_object())
        .map(|store| store.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let sources = state.get_many(&image_keys)?;
    let source_lookup_ms = source_lookup_start.elapsed().as_secs_f64() * 1000.0;
    let serialize_start = std::time::Instant::now();
    let board_json = serde_json::to_vec(&board).map_err(|e| e.to_string())?;
    let serialize_ms = serialize_start.elapsed().as_secs_f64() * 1000.0;
    let image_bytes = sources.iter().fold(0usize, |sum, (_, source)| {
        sum.saturating_add(source.bytes.len())
    });
    validate_board_limits(&board, board_json.len(), image_bytes)?;
    drop(board);

    let result = tokio::task::spawn_blocking(move || {
        write_board_container(&path, board_json, sources, serialize_ms)
    })
    .await
    .map_err(|e| e.to_string())??;

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;

    Ok(SaveBoardResponse::from_stats(
        result,
        total_ms,
        validate_ms,
        source_lookup_ms,
    ))
}

#[tauri::command]
pub(crate) async fn read_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
) -> Result<ReadBoardResponse, String> {
    let mut result =
        tokio::task::spawn_blocking(move || read_board_file_with_limits(&path, Some(BOARD_LIMITS)))
            .await
            .map_err(|e| e.to_string())??;
    validate_board_value(&result.board)?;

    {
        let cache_start = std::time::Instant::now();
        state.replace_all(std::mem::take(&mut result.sources))?;
        result.stats.cache_insert_ms = cache_start.elapsed().as_secs_f64() * 1000.0;
    }

    Ok(ReadBoardResponse {
        board: result.board,
        debug: result.stats.into(),
    })
}

fn safe_debug_filename(filename: &str) -> String {
    let mut out: String = filename
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '_' | '-' => ch,
            _ => '-',
        })
        .collect();
    while out.contains("..") {
        out = out.replace("..", ".");
    }
    if !out.ends_with(".json") {
        out.push_str(".json");
    }
    if out.is_empty() || out == ".json" {
        "boardfish-debug.json".to_string()
    } else {
        out
    }
}

fn fallback_downloads_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(|home| std::path::PathBuf::from(home).join("Downloads"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join("Downloads"))
    }
}

#[tauri::command]
pub(crate) async fn write_debug_log_file(
    app: tauri::AppHandle,
    filename: String,
    json: String,
) -> Result<String, String> {
    let downloads = app
        .path()
        .download_dir()
        .ok()
        .or_else(fallback_downloads_dir)
        .ok_or_else(|| "Downloads directory not available".to_string())?;
    tokio::fs::create_dir_all(&downloads)
        .await
        .map_err(|e| e.to_string())?;
    let path = downloads.join(safe_debug_filename(&filename));
    tokio::fs::write(&path, json.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}
