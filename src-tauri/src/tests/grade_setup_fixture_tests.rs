//! 학년 일괄 세팅 도구(tools/grade-setup)가 만든 파일을 앱의 실제 열기 경로로 연다.
//!
//! 도구는 앱 밖(Node)에서 SQLite 파일을 직접 만든다. 그 파일을 앱이 받아들이는지는
//! 이 시험만 확인한다 — 열기·마이그레이션·영역 화면·기록 쓰기까지.
//!
//! 고정 파일은 가짜 자료(1학년 3반 25명)로 만든 것이다. 도구나 schema.sql이 바뀌면
//! `node tools/test/make-rust-fixture.mjs`로 다시 만든다.

use crate::commands::area::get_areas_impl;
use crate::commands::crypto::is_encryption_enabled;
use crate::commands::project::{migrate_schema_impl, open_project_impl};
use crate::commands::record::{get_area_grid_impl, upsert_record_impl};
use crate::commands::student::get_students_impl;
use crate::commands::synonym::get_synonym_groups_impl;
use crate::state::{
    CryptoState, CryptoStateHandle, DbPathState, DbState, ReplaceCache, ReplaceCacheState,
};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const FIXTURE: &[u8] = include_bytes!("fixtures/grade-setup-1-3.sqlite");

#[test]
fn grade_setup_file_opens_and_every_area_is_writable() {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "grade_setup_fixture_{}_{}",
        std::process::id(),
        nanos
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("2026_1-3.db");
    std::fs::write(&path, FIXTURE).unwrap();

    let db = DbState(Mutex::new(None));
    let db_path = DbPathState(Mutex::new(None));
    let crypto: CryptoStateHandle = Mutex::new(CryptoState { key: None });
    let cache: ReplaceCacheState = Mutex::new(ReplaceCache {
        ruleset_version: 0,
        entries: HashMap::new(),
    });

    open_project_impl(path.to_str().unwrap(), &db, &db_path, &crypto, &cache)
        .expect("도구가 만든 파일을 앱이 열어야 한다");
    {
        let mut guard = db.0.lock().unwrap();
        let conn = guard.as_mut().unwrap();
        migrate_schema_impl(conn, &crypto).expect("이미 현재 스키마여야 한다");

        // 암호 없이 나간다 — 각 담임이 처음 열 때 설정한다.
        assert!(!is_encryption_enabled(conn).unwrap());

        let students = get_students_impl(conn, None).unwrap();
        assert_eq!(students.len(), 25);
        assert!(students.iter().all(|s| s.grade == 1 && s.class_num == 3));

        let areas = get_areas_impl(conn).unwrap();
        assert_eq!(areas.len(), 4);
        for area in &areas {
            // 활동이 없는 영역은 기록 화면에서 아무것도 쓸 수 없다(행발이 그랬다).
            assert!(!area.activities.is_empty(), "영역 {}에 활동이 없다", area.name);
            let grid = get_area_grid_impl(conn, area.id, None).unwrap();
            assert_eq!(grid.students.len(), 25, "영역 {}에 반 전원이 배정되어야 한다", area.name);
            assert!(grid.records.is_empty());
            upsert_record_impl(conn, grid.activities[0].id, grid.students[0].id, "가짜 문장", None)
                .unwrap();
            let after = get_area_grid_impl(conn, area.id, None).unwrap();
            assert_eq!(after.records.len(), 1);
        }

        let groups = get_synonym_groups_impl(conn).unwrap();
        assert!(groups.iter().any(|g| g.name == "유의어_기본"));
        assert!(groups.iter().any(|g| g.name.starts_with("학교공통") && !g.items.is_empty()));
    }
    drop(db);
    let _ = std::fs::remove_dir_all(&dir);
}
