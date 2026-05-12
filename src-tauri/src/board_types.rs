use std::sync::LazyLock;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardContract {
    format: String,
    versions: BoardContractVersions,
}

#[derive(serde::Deserialize)]
struct BoardContractVersions {
    legacy: u64,
    container: u64,
}

static BOARD_CONTRACT: LazyLock<BoardContract> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/shared/board_contract.json"))
        .expect("shared board contract must be valid JSON")
});

pub(crate) fn validate_board_value(value: &serde_json::Value) -> Result<(), String> {
    let document = value
        .as_object()
        .ok_or_else(|| "board data must be an object".to_string())?;
    if let Some(version_value) = document.get("version") {
        let version = version_value
            .as_u64()
            .ok_or_else(|| "board version must be an unsigned integer".to_string())?;
        if version != BOARD_CONTRACT.versions.legacy && version != BOARD_CONTRACT.versions.container
        {
            return Err(format!("unsupported board version {version}"));
        }
    }
    if let Some(format_value) = document.get("format") {
        let format = format_value
            .as_str()
            .ok_or_else(|| "board format must be a string".to_string())?;
        if format != BOARD_CONTRACT.format.as_str() {
            return Err(format!("unsupported board format {format}"));
        }
    }

    if let Some(viewport) = document.get("viewport") {
        validate_viewport(viewport)?;
    }

    let image_store = document
        .get("imageStore")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "imageStore must be an object".to_string())?;
    let objects = document
        .get("objects")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "objects must be an array".to_string())?;
    for object in objects {
        validate_object(object, image_store)?;
    }
    Ok(())
}

fn validate_viewport(viewport: &serde_json::Value) -> Result<(), String> {
    let viewport = viewport
        .as_object()
        .ok_or_else(|| "viewport must be an object".to_string())?;
    let pan_x = required_f64(viewport, "panX", "viewport")?;
    let pan_y = required_f64(viewport, "panY", "viewport")?;
    let zoom = required_f64(viewport, "zoom", "viewport")?;
    if !pan_x.is_finite() || !pan_y.is_finite() || !zoom.is_finite() {
        return Err("viewport contains non-finite values".to_string());
    }
    Ok(())
}

fn validate_object(
    object: &serde_json::Value,
    image_store: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let object = object
        .as_object()
        .ok_or_else(|| "object is not an object".to_string())?;
    let object_type = required_str(object, "type", "object")?;
    let id = required_str(object, "id", "object")?;
    let x = required_f64(object, "x", id)?;
    let y = required_f64(object, "y", id)?;
    let w = required_f64(object, "w", id)?;
    let h = required_f64(object, "h", id)?;
    let z = required_f64(object, "z", id)?;
    validate_common(id, x, y, w, h, z)?;

    let data = object
        .get("data")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("object {id} is missing data"))?;

    match object_type {
        "text" => {
            let _ = required_str(data, "content", id)?;
        }
        "image" => {
            let img_key = required_str(data, "imgKey", id)?;
            if img_key.is_empty() {
                return Err(format!("image object {id} is missing imgKey"));
            }
            if !image_store.contains_key(img_key) {
                return Err(format!(
                    "image object {id} references missing image {img_key}",
                ));
            }
            optional_bool(data, "flipX", id)?;
            optional_bool(data, "flipY", id)?;
            if let Some(rotation) = optional_f64(data, "rotation", id)? {
                if !rotation.is_finite() {
                    return Err(format!("image object {id} has non-finite rotation"));
                }
            }
        }
        _ => return Err(format!("object {id} has unsupported type")),
    }
    Ok(())
}

fn required_str<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, String> {
    object
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("{label}.{key} must be a string"))
}

fn required_f64(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<f64, String> {
    object
        .get(key)
        .and_then(|v| v.as_f64())
        .ok_or_else(|| format!("{label}.{key} must be a number"))
}

fn optional_f64(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<Option<f64>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_f64()
                .ok_or_else(|| format!("{label}.{key} must be a number"))
        })
        .transpose()
}

fn optional_bool(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    label: &str,
) -> Result<Option<bool>, String> {
    object
        .get(key)
        .map(|value| {
            value
                .as_bool()
                .ok_or_else(|| format!("{label}.{key} must be a boolean"))
        })
        .transpose()
}

fn validate_common(id: &str, x: f64, y: f64, w: f64, h: f64, z: f64) -> Result<(), String> {
    if id.is_empty() {
        return Err("object is missing id".to_string());
    }
    if !x.is_finite() || !y.is_finite() || !w.is_finite() || !h.is_finite() || !z.is_finite() {
        return Err(format!("object {id} contains non-finite values"));
    }
    if w <= 0.0 || h <= 0.0 {
        return Err(format!("object {id} has invalid dimensions"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_board_value;

    fn shared_contract() -> serde_json::Value {
        serde_json::from_str(include_str!("../../src/shared/board_contract.json")).unwrap()
    }

    #[test]
    fn matches_shared_board_contract() {
        let contract = shared_contract();
        assert_eq!(contract["format"], "boardfish-container");
        assert_eq!(contract["versions"]["legacy"], 2);
        assert_eq!(contract["versions"]["container"], 3);
        assert_eq!(contract["objectTypes"][0], "image");
        assert_eq!(contract["objectTypes"][1], "text");
        assert_eq!(contract["viewport"]["minZoom"], 0.001);
        assert_eq!(contract["viewport"]["maxZoom"], 1000);
    }

    #[test]
    fn accepts_valid_board() {
        let value: serde_json::Value =
            serde_json::from_str(include_str!("../../test/fixtures/valid_v3_board.json")).unwrap();

        assert!(validate_board_value(&value).is_ok());
    }

    #[test]
    fn rejects_missing_image_source() {
        let value = serde_json::json!({
            "version": 3,
            "format": "boardfish-container",
            "imageStore": {},
            "objects": [
                { "id": "obj-1", "type": "image", "x": 0.0, "y": 0.0, "w": 100.0, "h": 80.0, "z": 1.0, "data": { "imgKey": "img-1" } }
            ]
        });

        assert!(validate_board_value(&value)
            .unwrap_err()
            .contains("references missing image"));
    }

    #[test]
    fn rejects_unsupported_version_and_format() {
        let version = serde_json::json!({
            "version": 99,
            "imageStore": {},
            "objects": []
        });
        assert!(validate_board_value(&version)
            .unwrap_err()
            .contains("unsupported board version"));

        let format = serde_json::json!({
            "version": 3,
            "format": "other",
            "imageStore": {},
            "objects": []
        });
        assert!(validate_board_value(&format)
            .unwrap_err()
            .contains("unsupported board format"));
    }

    #[test]
    fn rejects_invalid_object_dimensions() {
        let value = serde_json::json!({
            "version": 3,
            "format": "boardfish-container",
            "imageStore": {},
            "objects": [
                { "id": "obj-1", "type": "text", "x": 0.0, "y": 0.0, "w": 0.0, "h": 10.0, "z": 1.0, "data": { "content": "" } }
            ]
        });

        assert!(validate_board_value(&value)
            .unwrap_err()
            .contains("invalid dimensions"));
    }
}
