pub(crate) const BOARD_MAX_OBJECTS: usize = 100;
pub(crate) const BOARD_MAX_CONTENT_BYTES: usize = 500 * 1024 * 1024;
pub(crate) const IMAGE_SOURCE_MAX_BYTES: usize = BOARD_MAX_CONTENT_BYTES;
pub(crate) const DECODED_IMAGE_CACHE_MAX_BYTES: usize = BOARD_MAX_CONTENT_BYTES;

pub(crate) fn format_limit_bytes(bytes: usize) -> String {
    let mb = ((bytes as f64 / 1024.0 / 1024.0) * 10.0).round() / 10.0;
    if (mb.fract()).abs() < f64::EPSILON {
        format!("{} MB", mb as usize)
    } else {
        format!("{mb:.1} MB")
    }
}

pub(crate) fn usize_from_u64(value: u64, too_large_message: &str) -> Result<usize, String> {
    usize::try_from(value).map_err(|_| too_large_message.to_string())
}

pub(crate) fn validate_image_source_bytes(bytes: usize) -> Result<(), String> {
    if bytes > IMAGE_SOURCE_MAX_BYTES {
        return Err(format!(
            "This image is {}; Boardfish image sources are limited to {}.",
            format_limit_bytes(bytes),
            format_limit_bytes(IMAGE_SOURCE_MAX_BYTES)
        ));
    }
    Ok(())
}

pub(crate) fn decoded_image_byte_len(width: u32, height: u32) -> Result<usize, String> {
    let bytes = (width as u64)
        .checked_mul(height as u64)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Image dimensions are too large.".to_string())?;
    usize_from_u64(bytes, "Image dimensions are too large.")
}

pub(crate) fn validate_decoded_image_dimensions(width: u32, height: u32) -> Result<usize, String> {
    let bytes = decoded_image_byte_len(width, height)?;
    if bytes > DECODED_IMAGE_CACHE_MAX_BYTES {
        return Err(format!(
            "This image decodes to {}; Boardfish decoded images are limited to {}.",
            format_limit_bytes(bytes),
            format_limit_bytes(DECODED_IMAGE_CACHE_MAX_BYTES)
        ));
    }
    Ok(bytes)
}

pub(crate) fn estimate_base64_decoded_len(base64_data: &str) -> Result<usize, String> {
    let mut encoded_len: usize = 0;
    let mut trailing_padding: usize = 0;
    for byte in base64_data.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        encoded_len = encoded_len
            .checked_add(1)
            .ok_or_else(|| "Image data is too large.".to_string())?;
        if byte == b'=' {
            trailing_padding = trailing_padding.saturating_add(1);
        } else {
            trailing_padding = 0;
        }
    }
    let decoded = encoded_len
        .checked_mul(3)
        .ok_or_else(|| "Image data is too large.".to_string())?
        / 4;
    Ok(decoded.saturating_sub(trailing_padding.min(2)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_base64_decoded_lengths() {
        assert_eq!(estimate_base64_decoded_len("AQIDBA==").unwrap(), 4);
        assert_eq!(estimate_base64_decoded_len("AQID BA==").unwrap(), 4);
        assert_eq!(estimate_base64_decoded_len("").unwrap(), 0);
    }

    #[test]
    fn rejects_sources_over_board_content_limit() {
        assert!(validate_image_source_bytes(BOARD_MAX_CONTENT_BYTES).is_ok());
        assert!(validate_image_source_bytes(BOARD_MAX_CONTENT_BYTES + 1).is_err());
    }

    #[test]
    fn rejects_decoded_images_over_cache_limit() {
        assert!(validate_decoded_image_dimensions(1024, 1024).is_ok());
        let side = ((DECODED_IMAGE_CACHE_MAX_BYTES / 4) as f64).sqrt().ceil() as u32;
        assert!(validate_decoded_image_dimensions(side, side).is_err());
    }
}
