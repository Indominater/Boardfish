#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_lifecycle;
mod app_theme;
mod board_commands;
mod board_io;
mod board_types;
mod clipboard;
mod dialogs;
mod image_data_url;
mod image_source_cache;
mod image_source_files;
mod image_source_process;
mod image_sources;
mod image_transform;
mod memory_limits;
#[cfg(target_os = "macos")]
mod platform_macos;
#[cfg(target_os = "windows")]
mod platform_windows;

use app_lifecycle::{
    acknowledge_close_request, cancel_pending_termination, exit_app, get_startup_file,
    get_window_maximized, handle_run_event, handle_window_event, minimize_window,
    request_window_close, set_title, show_app_window, startup_file_state, toggle_maximize_window,
};
use app_theme::set_app_theme;
use board_commands::{read_board, save_board, write_debug_log_file, write_text_file};
use clipboard::{
    clipboard_sequence, copy_image_data_url_to_clipboard_transformed, copy_text_to_clipboard,
    read_image_from_clipboard_cached, read_text_from_clipboard,
};
use dialogs::{
    open_file_dialog, pick_folder, pick_image_files, save_file_dialog, save_image_file_dialog,
    save_text_file_dialog,
};
use image_source_files::cleanup_stale_image_source_cache;
use image_sources::{
    clear_decoded_image_source_cache, clear_image_source_cache, get_cached_image_data_url,
    image_source_cache_debug, materialize_cached_image_sources, prewarm_cached_image_pixels,
    register_image_file_source, register_image_source, register_transformed_image_source,
    remove_cached_image_sources, sample_cached_image_pixel, save_images_to_existing_folder_by_keys,
    write_image_file_by_key, ImageSourceCache,
};

pub(crate) fn elapsed_ms(start: std::time::Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

pub(crate) fn rgba_mb(width: u32, height: u32) -> f64 {
    let bytes = width as f64 * height as f64 * 4.0;
    (bytes / 1024.0 / 1024.0 * 100.0).round() / 100.0
}

fn debug_tools_enabled() -> bool {
    option_env!("BOARDFISH_DEBUG_TOOLS_ENABLED") == Some("true")
}

fn debug_tools_initialization_script() -> String {
    format!(
        "Object.defineProperty(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {{ value: {}, writable: false, configurable: false }});",
        debug_tools_enabled()
    )
}

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);
    cleanup_stale_image_source_cache();

    tauri::Builder::default()
        .append_invoke_initialization_script(debug_tools_initialization_script())
        .plugin(tauri_plugin_dialog::init())
        .manage(startup_file_state(startup_file))
        .manage(ImageSourceCache::default())
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            get_window_maximized,
            save_board,
            save_text_file_dialog,
            write_text_file,
            write_debug_log_file,
            read_board,
            register_image_file_source,
            get_cached_image_data_url,
            prewarm_cached_image_pixels,
            image_source_cache_debug,
            sample_cached_image_pixel,
            materialize_cached_image_sources,
            open_file_dialog,
            pick_image_files,
            save_file_dialog,
            save_image_file_dialog,
            write_image_file_by_key,
            pick_folder,
            save_images_to_existing_folder_by_keys,
            set_title,
            set_app_theme,
            show_app_window,
            minimize_window,
            toggle_maximize_window,
            request_window_close,
            exit_app,
            cancel_pending_termination,
            acknowledge_close_request,
            copy_text_to_clipboard,
            clipboard_sequence,
            register_image_source,
            register_transformed_image_source,
            remove_cached_image_sources,
            copy_image_data_url_to_clipboard_transformed,
            read_image_from_clipboard_cached,
            read_text_from_clipboard,
            clear_decoded_image_source_cache,
            clear_image_source_cache
        ])
        .on_window_event(handle_window_event)
        .setup(app_lifecycle::setup_app)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}
