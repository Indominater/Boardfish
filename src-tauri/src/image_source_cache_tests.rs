use super::*;

fn decoded_entry(decoded_bytes: usize, decoded_last_used: u64) -> CachedImageSourceEntry {
    CachedImageSourceEntry {
        source: CachedImageSource {
            mime: "image/png".to_string(),
            ext: "png".to_string(),
            bytes: Arc::from([1u8]),
        },
        materialized_paths: Vec::new(),
        decoded: Some(DecodedImageSource {
            width: 1,
            height: 1,
            rgba: Arc::from([0u8, 0, 0, 0]),
        }),
        decoded_bytes,
        decoded_last_used,
        source_token: None,
    }
}

#[test]
fn prune_decoded_cache_keeps_protected_and_evicts_oldest_first() {
    let victim_bytes = DECODED_IMAGE_CACHE_MAX_BYTES / 2;
    let mut cache = ImageSourceCacheInner::default();
    cache
        .entries
        .insert("old".to_string(), decoded_entry(victim_bytes, 1));
    cache
        .entries
        .insert("new".to_string(), decoded_entry(victim_bytes, 2));
    cache
        .entries
        .insert("protected".to_string(), decoded_entry(1, 0));
    cache.decoded_bytes = victim_bytes.saturating_mul(2).saturating_add(1);

    prune_decoded_cache_locked(&mut cache, "protected");

    assert!(cache.entries["old"].decoded.is_none());
    assert!(cache.entries["new"].decoded.is_some());
    assert!(cache.entries["protected"].decoded.is_some());
    assert!(cache.decoded_bytes <= DECODED_IMAGE_CACHE_MAX_BYTES);
}
