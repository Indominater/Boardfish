use super::*;

fn unique_path(label: &str) -> PathBuf {
    image_source_cache_dir().join(format!(
        "test-{label}-{}-{}",
        std::process::id(),
        current_time_millis()
    ))
}

#[test]
fn cleanup_materialized_paths_removes_files_and_empty_parents_inside_cache_root() {
    let dir = unique_path("materialized").join("session").join("batch");
    let file = dir.join("img-1.png");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(&file, b"png").unwrap();

    cleanup_materialized_paths(vec![file.clone()]);

    assert!(!file.exists());
    assert!(!dir.exists());
    assert!(!dir.parent().unwrap().exists());
}

#[test]
fn cleanup_materialized_paths_ignores_paths_outside_cache_root() {
    let outside = std::env::temp_dir().join(format!(
        "boardfish-outside-cache-test-{}-{}",
        std::process::id(),
        current_time_millis()
    ));
    std::fs::write(&outside, b"keep").unwrap();

    cleanup_materialized_paths(vec![outside.clone()]);

    assert!(outside.exists());
    std::fs::remove_file(outside).unwrap();
}

#[test]
fn stale_cleanup_removes_dead_process_session_without_waiting_for_age_threshold() {
    let root = unique_path("stale-root");
    let current = root.join(format!("{}-current", std::process::id()));
    let dead = root.join("999999999-1");
    std::fs::create_dir_all(&current).unwrap();
    std::fs::create_dir_all(&dead).unwrap();

    let (removed, errors) = cleanup_stale_image_source_cache_inner(&root, &current).unwrap();

    assert_eq!(removed, 1);
    assert_eq!(errors, 0);
    assert!(current.exists());
    assert!(!dead.exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn cleanup_session_dir_removes_only_sessions_below_the_cache_root() {
    let root = unique_path("session-root");
    let session = root.join("session");
    let file = session.join("batch").join("img.png");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, b"png").unwrap();

    assert!(cleanup_image_source_session_dir(&root, &session).unwrap());
    assert!(!session.exists());

    let outside = std::env::temp_dir().join(format!(
        "boardfish-outside-session-test-{}-{}",
        std::process::id(),
        current_time_millis()
    ));
    std::fs::create_dir_all(&outside).unwrap();
    assert!(!cleanup_image_source_session_dir(&root, &outside).unwrap());
    assert!(outside.exists());
    std::fs::remove_dir_all(outside).unwrap();
    if root.exists() {
        std::fs::remove_dir_all(root).unwrap();
    }
}
