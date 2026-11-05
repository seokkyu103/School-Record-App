use crate::commands::goyang25::{remove_unused_club_area_impl, CLUB_AREA_NAME};
use super::{insert_activity, insert_area, insert_record, insert_student, setup_test_db};

fn link(conn: &rusqlite::Connection, area_id: i64, activity_id: i64) {
    conn.execute(
        "INSERT INTO AreaActivity (area_id, activity_id) VALUES (?1, ?2)",
        rusqlite::params![area_id, activity_id],
    )
    .unwrap();
}

fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

/// 배포한 반 파일과 같은 모양: 동아리활동 영역 + 동아리 기록 활동, 학생마다 빈 칸.
fn club_file() -> (rusqlite::Connection, i64, i64) {
    let conn = setup_test_db();
    let s = insert_student(&conn, 1, 1, 1, "가나다");
    let area = insert_area(&conn, CLUB_AREA_NAME, 1500);
    let act = insert_activity(&conn, "동아리 기록");
    link(&conn, area, act);
    insert_record(&conn, act, s, "");
    let other = insert_area(&conn, "진로활동", 1500);
    let other_act = insert_activity(&conn, "주제탐구활동");
    link(&conn, other, other_act);
    insert_record(&conn, other_act, s, "진로 기록");
    (conn, act, s)
}

#[test]
fn test_empty_club_area_is_removed_with_its_activity() {
    let (conn, _, _) = club_file();
    assert!(remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Area WHERE name = '동아리활동'"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Activity WHERE name = '동아리 기록'"), 0);
    // 다른 영역은 그대로
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM ActivityRecord WHERE content = '진로 기록'"), 1);
}

#[test]
fn test_club_area_with_writing_is_kept() {
    let (conn, act, s) = club_file();
    conn.execute(
        "UPDATE ActivityRecord SET content = '동아리 글' WHERE activity_id = ?1 AND student_id = ?2",
        rusqlite::params![act, s],
    )
    .unwrap();
    assert!(!remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Area WHERE name = '동아리활동'"), 1);
}

#[test]
fn test_club_area_with_history_is_kept() {
    let (conn, act, _) = club_file();
    conn.execute(
        "INSERT INTO ActivityRecordHistory (activity_record_id, content)
         SELECT id, '예전 글' FROM ActivityRecord WHERE activity_id = ?1",
        [act],
    )
    .unwrap();
    assert!(!remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Area WHERE name = '동아리활동'"), 1);
}

#[test]
fn test_shared_activity_is_kept() {
    let (conn, act, _) = club_file();
    let other = count(&conn, "SELECT id FROM Area WHERE name = '진로활동'");
    link(&conn, other, act);
    assert!(remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Activity WHERE name = '동아리 기록'"), 1);
}

#[test]
fn test_runs_only_once_per_file() {
    let (conn, _, _) = club_file();
    assert!(remove_unused_club_area_impl(&conn).unwrap());
    // 담임이 나중에 같은 이름의 영역을 직접 만들면 지우지 않는다.
    insert_area(&conn, CLUB_AREA_NAME, 1500);
    assert!(!remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Area WHERE name = '동아리활동'"), 1);
}

#[test]
fn test_file_without_club_area() {
    let conn = setup_test_db();
    insert_area(&conn, "진로활동", 1500);
    assert!(!remove_unused_club_area_impl(&conn).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM Area"), 1);
}

// ── 기본 목록의 바뀐 부분 넣기 ─────────────────────────────────

use crate::commands::goyang25::{apply_edition_defaults_impl, EditionDefaults};
use crate::types::SeedGroupInput;

fn defaults() -> EditionDefaults {
    EditionDefaults {
        version: "1".into(),
        retired_group: "유의어_기본".into(),
        retired_words: vec!["외국".into(), "메타".into()],
        added_groups: vec![SeedGroupInput { name: "학교공통 형식-05 가운뎃점".into(), words: vec!["·".into(), "ㆍ".into()] }],
        added_rules: vec![serde_json::json!({"oldText": r"\s*[·ㆍ]\s*", "newText": ", ", "priority": 53, "isRegex": true})],
        synonym_version: "2".into(),
        replace_rules_version: "2".into(),
    }
}

fn group_with(conn: &rusqlite::Connection, name: &str, words: &[&str]) -> i64 {
    conn.execute("INSERT INTO SynonymGroup (name) VALUES (?1)", [name]).unwrap();
    let gid = conn.last_insert_rowid();
    for w in words {
        conn.execute("INSERT INTO SynonymItem (group_id, word) VALUES (?1, ?2)", rusqlite::params![gid, w]).unwrap();
    }
    gid
}

fn config(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT config_value FROM APP_CONFIGS WHERE config_key = ?1", [key], |r| r.get(0))
        .optional()
        .unwrap()
}

#[test]
fn test_edition_defaults_remove_add_and_mark() {
    let conn = setup_test_db();
    group_with(&conn, "유의어_기본", &["외국", "외국 여행", "메타", "토익"]);
    // 담임이 만든 그룹의 같은 말은 남는다
    group_with(&conn, "우리 반", &["외국"]);
    conn.execute("INSERT INTO APP_CONFIGS (config_key, config_value) VALUES ('synonym_version', '1')", []).unwrap();

    assert!(apply_edition_defaults_impl(&conn, &defaults()).unwrap());

    assert_eq!(count(&conn, "SELECT COUNT(*) FROM SynonymItem si JOIN SynonymGroup g ON g.id = si.group_id
                             WHERE g.name = '유의어_기본'"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM SynonymItem si JOIN SynonymGroup g ON g.id = si.group_id
                             WHERE g.name = '우리 반' AND si.word = '외국'"), 1);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM SynonymItem si JOIN SynonymGroup g ON g.id = si.group_id
                             WHERE g.name = '학교공통 형식-05 가운뎃점'"), 2);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM ReplaceRule WHERE new_text = ', ' AND is_regex = 1"), 1);
    assert_eq!(config(&conn, "synonym_version").as_deref(), Some("2"));
    assert_eq!(config(&conn, "replace_rules_version").as_deref(), Some("2"));
}

#[test]
fn test_edition_defaults_run_once_per_version() {
    let conn = setup_test_db();
    assert!(apply_edition_defaults_impl(&conn, &defaults()).unwrap());
    // 담임이 그 뒤 '메타'를 다시 넣으면 같은 판에서는 다시 지우지 않는다
    let gid = group_with(&conn, "유의어_기본", &[]);
    conn.execute("INSERT INTO SynonymItem (group_id, word) VALUES (?1, '메타')", [gid]).unwrap();
    assert!(!apply_edition_defaults_impl(&conn, &defaults()).unwrap());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM SynonymItem WHERE word = '메타'"), 1);
}

#[test]
fn test_edition_defaults_rejects_bad_regex_without_changes() {
    let conn = setup_test_db();
    group_with(&conn, "유의어_기본", &["외국"]);
    let mut d = defaults();
    d.added_rules = vec![serde_json::json!({"oldText": "(", "newText": "", "priority": 60, "isRegex": true})];
    assert!(apply_edition_defaults_impl(&conn, &d).is_err());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM SynonymItem WHERE word = '외국'"), 1);
    assert_eq!(config(&conn, "g25_defaults_version"), None);
}
