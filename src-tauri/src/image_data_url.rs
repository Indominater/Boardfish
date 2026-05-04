use std::sync::Arc;

use crate::image_sources::CachedImageSource;

fn ext_from_data_url_header(header: &str) -> &'static str {
    if header.starts_with("data:image/jpeg") {
        "jpg"
    } else {
        "png"
    }
}

fn mime_from_data_url_header(header: &str) -> &'static str {
    if header.starts_with("data:image/jpeg") {
        "image/jpeg"
    } else {
        "image/png"
    }
}

pub(crate) fn cached_source_from_data_url(data_url: &str) -> Result<CachedImageSource, String> {
    use base64::{engine::general_purpose, Engine as _};
    let (header, base64_data) = data_url.split_once(',').ok_or("invalid data URL")?;
    Ok(CachedImageSource {
        mime: mime_from_data_url_header(header).to_string(),
        ext: ext_from_data_url_header(header).to_string(),
        bytes: Arc::from(
            general_purpose::STANDARD
                .decode(base64_data)
                .map_err(|e| e.to_string())?,
        ),
    })
}
