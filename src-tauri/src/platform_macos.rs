use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use crate::emit_close_request;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};

const CLOSE_WINDOW_MENU_ID: &str = "boardfish-close-window";
const WINDOW_CLOSE_MENU_ID: &str = "boardfish-window-close";

static PENDING_TERMINATION: AtomicBool = AtomicBool::new(false);
static APP_HANDLE_FOR_TERMINATE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub(crate) fn setup_menu(app: &mut tauri::App) -> tauri::Result<()> {
    let app_handle = app.handle().clone();
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let close_window = MenuItem::with_id(
        &app_handle,
        CLOSE_WINDOW_MENU_ID,
        "Close Window",
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let window_close = MenuItem::with_id(
        &app_handle,
        WINDOW_CLOSE_MENU_ID,
        "Close Window",
        true,
        None::<&str>,
    )?;
    let window_menu = Submenu::with_id_and_items(
        &app_handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(&app_handle, None)?,
            &PredefinedMenuItem::maximize(&app_handle, None)?,
            &PredefinedMenuItem::separator(&app_handle)?,
            &window_close,
        ],
    )?;
    let menu = Menu::with_items(
        &app_handle,
        &[
            &Submenu::with_items(
                &app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(&app_handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(&app_handle)?,
                    &PredefinedMenuItem::services(&app_handle, None)?,
                    &PredefinedMenuItem::separator(&app_handle)?,
                    &PredefinedMenuItem::hide(&app_handle, None)?,
                    &PredefinedMenuItem::hide_others(&app_handle, None)?,
                    &PredefinedMenuItem::separator(&app_handle)?,
                    &PredefinedMenuItem::quit(&app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(&app_handle, "File", true, &[&close_window])?,
            &Submenu::with_items(
                &app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(&app_handle, None)?,
                    &PredefinedMenuItem::redo(&app_handle, None)?,
                    &PredefinedMenuItem::separator(&app_handle)?,
                    &PredefinedMenuItem::cut(&app_handle, None)?,
                    &PredefinedMenuItem::copy(&app_handle, None)?,
                    &PredefinedMenuItem::paste(&app_handle, None)?,
                    &PredefinedMenuItem::select_all(&app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                &app_handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(&app_handle, None)?],
            )?,
            &window_menu,
        ],
    )?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if id == CLOSE_WINDOW_MENU_ID || id == WINDOW_CLOSE_MENU_ID {
            emit_close_request(app);
        }
    });

    Ok(())
}

pub(crate) fn cancel_termination() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    if PENDING_TERMINATION.swap(false, Ordering::SeqCst) {
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let app = NSApplication::sharedApplication(mtm);
            app.replyToApplicationShouldTerminate(false);
        }
    }
}

pub(crate) unsafe fn setup_termination_intercept(app_handle: tauri::AppHandle) {
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use std::ffi::c_void;
    use std::os::raw::c_char;

    APP_HANDLE_FOR_TERMINATE.set(app_handle).ok();

    extern "C" {
        fn class_getInstanceMethod(cls: *const c_void, sel: Sel) -> *mut c_void;
        fn class_addMethod(
            cls: *const c_void,
            sel: Sel,
            imp: *const c_void,
            types: *const c_char,
        ) -> bool;
        fn method_setImplementation(m: *mut c_void, imp: *const c_void) -> *const c_void;
    }

    unsafe extern "C" fn our_should_terminate(
        _this: *mut AnyObject,
        _sel: Sel,
        _sender: *mut AnyObject,
    ) -> std::os::raw::c_ulong {
        PENDING_TERMINATION.store(true, Ordering::SeqCst);
        if let Some(app) = APP_HANDLE_FOR_TERMINATE.get() {
            emit_close_request(app);
        }
        2 // NSTerminateLater
    }

    let mtm = MainThreadMarker::new_unchecked();
    let ns_app = NSApplication::sharedApplication(mtm);

    let delegate: *mut AnyObject = msg_send![&*ns_app, delegate];
    if delegate.is_null() {
        return;
    }

    let cls = (*delegate).class() as *const _ as *const c_void;
    let sel = sel!(applicationShouldTerminate:);
    let method = class_getInstanceMethod(cls, sel);

    if !method.is_null() {
        method_setImplementation(method, our_should_terminate as *const c_void);
    } else {
        // Tauri's delegate doesn't implement this optional method. Add it with
        // Q=NSUInteger(return), @=id(self), :=SEL(_cmd), @=id(sender).
        let types = b"Q@:@\0";
        class_addMethod(
            cls,
            sel,
            our_should_terminate as *const c_void,
            types.as_ptr() as *const c_char,
        );
    }
}

unsafe fn configure_ns_title_bar(ns_window_ptr: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    if ns_window_ptr.is_null() {
        return;
    }

    let ns_window = &*(ns_window_ptr as *mut AnyObject);
    let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];
    let _: () = msg_send![ns_window, setTitleVisibility: 1isize];
}

pub(crate) unsafe fn configure_window_title_bar(window: &tauri::Window) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        configure_ns_title_bar(ns_window_ptr);
    }
}

pub(crate) unsafe fn configure_webview_title_bar(window: &tauri::WebviewWindow) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        configure_ns_title_bar(ns_window_ptr);
    }
}
