#[tauri::command]
pub(crate) async fn open_file_dialog(app: tauri::AppHandle) -> Option<String> {
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
pub(crate) async fn pick_image_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
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
pub(crate) async fn save_file_dialog(
    app: tauri::AppHandle,
    default_name: Option<String>,
) -> Option<String> {
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
pub(crate) async fn save_image_file_dialog(
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
pub(crate) async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
