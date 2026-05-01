use std::collections::HashMap;

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
        if version != 2 && version != 3 {
            return Err(format!("unsupported board version {version}"));
        }
    }
    if let Some(format) = &document.format {
        if format != "boardfish-container" {
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
}
