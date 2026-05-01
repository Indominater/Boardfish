use std::ffi::c_void;

use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
};

const CANVAS_BG: u32 = colorref(0xe0, 0xe0, 0xe3);
const TITLE_TEXT: u32 = colorref(0x11, 0x14, 0x18);

const fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}

unsafe fn set_dwm_color(hwnd: *mut c_void, attribute: i32, color: u32) {
    let _ = DwmSetWindowAttribute(
        hwnd,
        attribute as u32,
        &color as *const u32 as *const c_void,
        std::mem::size_of::<u32>() as u32,
    );
}

unsafe fn configure_hwnd(hwnd: *mut c_void) {
    set_dwm_color(hwnd, DWMWA_CAPTION_COLOR, CANVAS_BG);
    set_dwm_color(hwnd, DWMWA_BORDER_COLOR, CANVAS_BG);
    set_dwm_color(hwnd, DWMWA_TEXT_COLOR, TITLE_TEXT);
}

pub(crate) unsafe fn configure_window_title_bar(window: &tauri::Window) {
    if let Ok(hwnd) = window.hwnd() {
        configure_hwnd(hwnd.0 as *mut c_void);
    }
}

pub(crate) unsafe fn configure_webview_title_bar(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        configure_hwnd(hwnd.0 as *mut c_void);
    }
}
