use std::{env, fs, path::Path};

const CAPABILITY_PATH: &str = "capabilities/default.json";
const GENERATED_CAPABILITY_PATH: &str = "target/generated-capabilities/default.json";
const GENERATED_CAPABILITY_GLOB: &str = "./target/generated-capabilities/**/*";

fn main() {
    println!("cargo:rerun-if-changed={CAPABILITY_PATH}");
    println!("cargo:rerun-if-env-changed=PROFILE");
    let debug_tools_enabled = debug_tools_enabled();
    println!("cargo:rustc-env=BOARDFISH_DEBUG_TOOLS_ENABLED={debug_tools_enabled}");
    sync_debug_tools_capability(debug_tools_enabled);
    tauri_build::try_build(
        tauri_build::Attributes::new().capabilities_path_pattern(GENERATED_CAPABILITY_GLOB),
    )
    .expect("failed to build Tauri context");
}

fn debug_tools_enabled() -> bool {
    env::var("PROFILE").is_ok_and(|profile| profile == "debug")
}

fn sync_debug_tools_capability(debug_tools_enabled: bool) {
    let devtools_permission = if debug_tools_enabled {
        "core:webview:allow-internal-toggle-devtools"
    } else {
        "core:webview:deny-internal-toggle-devtools"
    };
    let capability = format!(
        r#"{{
  "identifier": "default",
  "description": "Default capabilities",
  "windows": [
    "main"
  ],
  "permissions": [
    "core:app:allow-set-app-theme",
    "core:event:allow-listen",
    "{devtools_permission}",
    "core:window:allow-start-dragging",
    "dialog:default"
  ]
}}
"#
    );
    write_if_changed(Path::new(GENERATED_CAPABILITY_PATH), &capability);
}

fn write_if_changed(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .unwrap_or_else(|err| panic!("failed to create {}: {err}", parent.display()));
    }

    match fs::read_to_string(path) {
        Ok(existing) if existing == contents => return,
        Ok(_) | Err(_) => {}
    }

    fs::write(path, contents)
        .unwrap_or_else(|err| panic!("failed to write {}: {err}", path.display()));
}
