use crate::board_io::{read_board_file, write_board_container, BoardReadStats, BoardWriteStats};
use crate::board_types::validate_board_value;
use crate::image_sources::ImageSourceCache;
use crate::save_debug;

#[derive(serde::Serialize)]
pub(crate) struct SaveBoardResponse {
    format: &'static str,
    json_bytes: usize,
    image_bytes: usize,
    image_count: usize,
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
    fn from_stats(stats: BoardWriteStats, total_ms: f64) -> Self {
        Self {
            format: "container",
            json_bytes: stats.json_bytes,
            image_bytes: stats.image_bytes,
            image_count: stats.image_count,
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

#[tauri::command]
pub(crate) async fn save_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
    board: serde_json::Value,
) -> Result<SaveBoardResponse, String> {
    let total_start = std::time::Instant::now();
    validate_board_value(&board)?;
    let image_keys = board
        .get("imageStore")
        .and_then(|v| v.as_object())
        .map(|store| store.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    let sources = state.get_many(&image_keys)?;

    let result = tokio::task::spawn_blocking(move || write_board_container(&path, board, sources))
        .await
        .map_err(|e| e.to_string())??;

    let total_ms = total_start.elapsed().as_secs_f64() * 1000.0;
    save_debug("total", total_start);

    Ok(SaveBoardResponse::from_stats(result, total_ms))
}

#[tauri::command]
pub(crate) async fn read_board(
    state: tauri::State<'_, ImageSourceCache>,
    path: String,
) -> Result<ReadBoardResponse, String> {
    let mut result = tokio::task::spawn_blocking(move || read_board_file(&path))
        .await
        .map_err(|e| e.to_string())??;
    validate_board_value(&result.board)?;

    {
        let cache_start = std::time::Instant::now();
        state.replace_all(result.sources.drain(..).collect())?;
        result.stats.cache_insert_ms = cache_start.elapsed().as_secs_f64() * 1000.0;
    }

    Ok(ReadBoardResponse {
        board: result.board,
        debug: result.stats.into(),
    })
}

#[tauri::command]
pub(crate) async fn write_text_file(path: String, text: String) -> Result<(), String> {
    tokio::fs::write(path, text.as_bytes())
        .await
        .map_err(|e| e.to_string())
}
