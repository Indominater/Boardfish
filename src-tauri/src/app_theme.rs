use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::elapsed_ms;

use tauri::window::Color;
use tauri::Manager;
use tauri::Theme;

static DARK_THEME: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
pub(crate) struct ThemeApplyResponse {
    theme: &'static str,
    color: &'static str,
    ms: f64,
}

#[cfg(target_os = "windows")]
pub(crate) fn is_dark_theme() -> bool {
    DARK_THEME.load(Ordering::Relaxed)
}

pub(crate) fn app_theme_color(dark: bool) -> Color {
    if dark {
        Color(0x1c, 0x1b, 0x22, 0xff)
    } else {
        Color(0xea, 0xea, 0xed, 0xff)
    }
}

pub(crate) fn app_theme_name(dark: bool) -> &'static str {
    if dark {
        "dark"
    } else {
        "light"
    }
}

fn app_theme_hex(dark: bool) -> &'static str {
    if dark {
        "#1c1b22"
    } else {
        "#eaeaed"
    }
}

fn app_theme_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("theme.txt"))
        .map_err(|e| e.to_string())
}

pub(crate) fn read_stored_app_theme(app: &tauri::AppHandle) -> bool {
    let Ok(path) = app_theme_path(app) else {
        return false;
    };
    std::fs::read_to_string(path)
        .map(|value| value.trim().eq_ignore_ascii_case("dark"))
        .unwrap_or(false)
}

fn write_stored_app_theme(app: &tauri::AppHandle, dark: bool) -> Result<(), String> {
    let path = app_theme_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, app_theme_name(dark)).map_err(|e| e.to_string())
}

pub(crate) fn configure_startup_theme(window: &tauri::WebviewWindow, dark: bool) {
    DARK_THEME.store(dark, Ordering::Relaxed);
    let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    let _ = window.set_background_color(Some(app_theme_color(dark)));

    #[cfg(target_os = "windows")]
    unsafe {
        crate::platform_windows::configure_webview_title_bar(window, dark);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        crate::platform_macos::configure_webview_title_bar(window);
    }

    eprintln!(
        "[boardfish startup] configured native theme: {}",
        app_theme_name(dark)
    );
}

#[tauri::command]
pub(crate) fn set_app_theme(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    theme: String,
) -> Result<ThemeApplyResponse, String> {
    let start = std::time::Instant::now();
    let dark = theme.eq_ignore_ascii_case("dark");
    DARK_THEME.store(dark, Ordering::Relaxed);
    if let Err(error) = write_stored_app_theme(&app, dark) {
        eprintln!("[boardfish startup] store theme failed: {error}");
    }
    let native_theme = if dark { Theme::Dark } else { Theme::Light };
    let color = app_theme_color(dark);

    window
        .set_theme(Some(native_theme))
        .map_err(|e| e.to_string())?;
    window
        .set_background_color(Some(color))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    unsafe {
        crate::platform_windows::configure_webview_title_bar(&window, dark);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        crate::platform_macos::configure_webview_title_bar(&window);
    }

    Ok(ThemeApplyResponse {
        theme: app_theme_name(dark),
        color: app_theme_hex(dark),
        ms: elapsed_ms(start),
    })
}
