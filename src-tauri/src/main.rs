#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};

mod app_lifecycle;
mod app_theme;
mod board_commands;
mod board_io;
mod board_types;
mod clipboard;
mod dialogs;
mod image_data_url;
mod image_source_files;
mod image_sources;
mod image_transform;
#[cfg(target_os = "macos")]
mod platform_macos;
#[cfg(target_os = "windows")]
mod platform_windows;

use app_lifecycle::{
    acknowledge_close_request, cancel_pending_termination, exit_app, get_startup_file,
    handle_run_event, handle_window_event, set_title, show_app_window, startup_file_state,
};
use app_theme::set_app_theme;
use board_commands::{read_board, save_board, write_text_file};
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
    clear_image_source_cache, get_cached_image_data_url, materialize_cached_image_sources,
    register_image_file_source, register_image_source, register_transformed_image_source,
    remove_cached_image_sources, save_images_to_existing_folder_by_keys, write_image_file_by_key,
    ImageSourceCache,
};

static SAVE_DEBUG: AtomicBool = AtomicBool::new(false);
static OPEN_DEBUG: AtomicBool = AtomicBool::new(false);

pub(crate) fn elapsed_ms(start: std::time::Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0
}

pub(crate) fn rgba_mb(width: u32, height: u32) -> f64 {
    let bytes = width as f64 * height as f64 * 4.0;
    (bytes / 1024.0 / 1024.0 * 100.0).round() / 100.0
}

pub(crate) fn save_debug(label: &str, start: std::time::Instant) {
    if SAVE_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish save] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

pub(crate) fn open_debug(label: &str, start: std::time::Instant) {
    if OPEN_DEBUG.load(Ordering::Relaxed) {
        eprintln!(
            "[boardfish open] {} {:.2}ms",
            label,
            start.elapsed().as_secs_f64() * 1000.0
        );
    }
}

fn main() {
    let startup_file: Option<String> = std::env::args().nth(1);
    cleanup_stale_image_source_cache();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(startup_file_state(startup_file))
        .manage(ImageSourceCache::default())
        .invoke_handler(tauri::generate_handler![
            get_startup_file,
            save_board,
            save_text_file_dialog,
            write_text_file,
            read_board,
            register_image_file_source,
            get_cached_image_data_url,
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
            clear_image_source_cache
        ])
        .on_window_event(handle_window_event)
        .setup(app_lifecycle::setup_app)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(handle_run_event);
}
