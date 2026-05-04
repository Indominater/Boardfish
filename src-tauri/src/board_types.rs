use std::collections::HashMap;
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardDocument {
    version: Option<u64>,
    format: Option<String>,
    viewport: Option<Viewport>,
    image_store: HashMap<String, serde_json::Value>,
    objects: Vec<BoardObject>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Viewport {
    pan_x: f64,
    pan_y: f64,
    zoom: f64,
}

#[derive(serde::Deserialize)]
#[serde(tag = "type")]
enum BoardObject {
    #[serde(rename = "text")]
    Text {
        id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        z: f64,
        data: TextData,
    },
    #[serde(rename = "image")]
    Image {
        id: String,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        z: f64,
        data: ImageData,
    },
}

#[derive(serde::Deserialize)]
struct TextData {
    content: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageData {
    img_key: String,
    flip_x: Option<bool>,
    flip_y: Option<bool>,
    rotation: Option<f64>,
}

pub(crate) fn validate_board_value(value: &serde_json::Value) -> Result<(), String> {
    let document: BoardDocument =
        serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    if let Some(version) = document.version {
        if version != BOARD_CONTRACT.versions.legacy && version != BOARD_CONTRACT.versions.container
        {
            return Err(format!("unsupported board version {version}"));
        }
    }
    if let Some(format) = &document.format {
        if format != &BOARD_CONTRACT.format {
            return Err(format!("unsupported board format {format}"));
        }
    }
    if let Some(viewport) = &document.viewport {
        if !viewport.pan_x.is_finite() || !viewport.pan_y.is_finite() || !viewport.zoom.is_finite()
        {
            return Err("viewport contains non-finite values".to_string());
        }
    }
    for object in &document.objects {
        validate_object(object, &document.image_store)?;
    }
    Ok(())
}

fn validate_object(
    object: &BoardObject,
    image_store: &HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    match object {
        BoardObject::Text {
            id,
            x,
            y,
            w,
            h,
            z,
            data,
        } => {
            validate_common(id, *x, *y, *w, *h, *z)?;
            let _ = &data.content;
        }
        BoardObject::Image {
            id,
            x,
            y,
            w,
            h,
            z,
            data,
        } => {
            validate_common(id, *x, *y, *w, *h, *z)?;
            if data.img_key.is_empty() {
                return Err(format!("image object {id} is missing imgKey"));
            }
            if !image_store.contains_key(&data.img_key) {
                return Err(format!(
                    "image object {id} references missing image {}",
                    data.img_key
                ));
            }
            if let Some(rotation) = data.rotation {
                if !rotation.is_finite() {
                    return Err(format!("image object {id} has non-finite rotation"));
                }
            }
            let _ = (data.flip_x, data.flip_y);
        }
    }
    Ok(())
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
        assert_eq!(contract["viewport"]["minZoom"], 0.1);
        assert_eq!(contract["viewport"]["maxZoom"], 10);
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
