//! 고양외고 25기 1학년부 판에서만 쓰는 정리 작업.
//!
//! 동아리활동은 동아리 담당 교사가 다른 파일로 쓰므로 담임 파일에는 필요 없다.
//! 0.3.1-g25.4까지 배포한 반 파일에는 "동아리활동" 영역과 "동아리 기록" 활동이 들어 있어,
//! 파일을 열 때 한 번 확인해 비어 있으면 지운다.

use crate::db::with_transaction;
use crate::state::DbState;
use rusqlite::{Connection, OptionalExtension};
use tauri::State;

pub const CLUB_AREA_NAME: &str = "동아리활동";
/// 이 키가 있으면 이미 확인한 파일이다. 담임이 나중에 같은 이름의 영역을 직접 만들어도 다시 지우지 않는다.
pub const CLUB_CHECKED_KEY: &str = "g25_club_area_checked";

/// 반환값: 지웠으면 true. 글이나 버전 기록이 하나라도 있으면 지우지 않고 false.
///
/// 활동은 이 영역에만 연결된 것만 지운다. 다른 영역에도 연결된 활동은 연결만 끊긴다(영역 삭제의 CASCADE).
pub fn remove_unused_club_area_impl(conn: &Connection) -> Result<bool, String> {
    let checked: Option<String> = conn
        .query_row(
            "SELECT config_value FROM APP_CONFIGS WHERE config_key = ?1",
            [CLUB_CHECKED_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if checked.is_some() {
        return Ok(false);
    }

    with_transaction(conn, || {
        let area_id: Option<i64> = conn
            .query_row("SELECT id FROM Area WHERE name = ?1", [CLUB_AREA_NAME], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;

        let mut removed = false;
        if let Some(area_id) = area_id {
            // 내용은 암호화돼 있을 수 있지만 빈 글은 암호화하지 않으므로(skip_empty) ''로 비교할 수 있다.
            // 공백만 있는 글도 '쓴 것'으로 보고 지우지 않는다.
            let written: i64 = conn
                .query_row(
                    "SELECT
                        (SELECT COUNT(*) FROM ActivityRecord ar
                           JOIN AreaActivity aa ON aa.activity_id = ar.activity_id
                          WHERE aa.area_id = ?1 AND ar.content != '')
                      + (SELECT COUNT(*) FROM ActivityRecordHistory h
                           JOIN ActivityRecord ar ON ar.id = h.activity_record_id
                           JOIN AreaActivity aa ON aa.activity_id = ar.activity_id
                          WHERE aa.area_id = ?1 AND h.content != '')",
                    [area_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;

            if written == 0 {
                conn.execute(
                    "DELETE FROM Activity WHERE id IN (
                        SELECT aa.activity_id FROM AreaActivity aa
                         WHERE aa.area_id = ?1
                           AND NOT EXISTS (SELECT 1 FROM AreaActivity o
                                            WHERE o.activity_id = aa.activity_id AND o.area_id != ?1))",
                    [area_id],
                )
                .map_err(|e| e.to_string())?;
                conn.execute("DELETE FROM Area WHERE id = ?1", [area_id])
                    .map_err(|e| e.to_string())?;
                removed = true;
            }
        }

        conn.execute(
            "INSERT INTO APP_CONFIGS (config_key, config_value) VALUES (?1, ?2)",
            rusqlite::params![CLUB_CHECKED_KEY, if removed { "removed" } else { "kept" }],
        )
        .map_err(|e| e.to_string())?;
        Ok(removed)
    })
}

#[tauri::command]
pub fn remove_unused_club_area(state: State<DbState>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| "DB가 열려있지 않습니다.".to_string())?;
    remove_unused_club_area_impl(conn)
}

// ── 기본 목록의 바뀐 부분 넣기 ─────────────────────────────────

pub const EDITION_DEFAULTS_KEY: &str = "g25_defaults_version";

/// 프론트엔드 data/editionDefaults.ts가 보낸다.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditionDefaults {
    pub version: String,
    pub retired_group: String,
    pub retired_words: Vec<String>,
    pub added_groups: Vec<crate::types::SeedGroupInput>,
    pub added_rules: Vec<serde_json::Value>,
    pub synonym_version: String,
    pub replace_rules_version: String,
}

fn upsert_config(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO APP_CONFIGS (config_key, config_value) VALUES (?1, ?2)
         ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 반환값: 이번에 넣었으면 true, 이미 넣은 파일이면 false.
///
/// 뺄 말은 지정한 그룹(기본 그룹)에서만 지운다. 더할 그룹·규칙은 이미 있으면 그대로 둔다
/// (INSERT OR IGNORE). 담임이 지운 다른 기본 단어는 되살리지 않는다.
pub fn apply_edition_defaults_impl(conn: &Connection, d: &EditionDefaults) -> Result<bool, String> {
    let done: Option<String> = conn
        .query_row(
            "SELECT config_value FROM APP_CONFIGS WHERE config_key = ?1",
            [EDITION_DEFAULTS_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if done.as_deref() == Some(d.version.as_str()) {
        return Ok(false);
    }

    // 넣기 전에 정규식을 확인한다. 틀린 정규식이 들어가면 치환이 조용히 건너뛴다.
    for rule in &d.added_rules {
        if rule["isRegex"].as_bool().unwrap_or(false) {
            let pattern = rule["oldText"].as_str().ok_or("oldText 누락")?;
            regex::Regex::new(pattern)
                .map_err(|e| format!("기본 규칙의 정규식이 올바르지 않습니다 (패턴 '{pattern}'): {e}"))?;
        }
    }

    with_transaction(conn, || {
        for word in &d.retired_words {
            conn.execute(
                "DELETE FROM SynonymItem
                  WHERE word = ?2
                    AND group_id IN (SELECT id FROM SynonymGroup WHERE name = ?1)",
                rusqlite::params![d.retired_group, word],
            )
            .map_err(|e| e.to_string())?;
        }

        for group in &d.added_groups {
            conn.execute("INSERT OR IGNORE INTO SynonymGroup (name) VALUES (?1)", [&group.name])
                .map_err(|e| e.to_string())?;
            let gid: i64 = conn
                .query_row("SELECT id FROM SynonymGroup WHERE name = ?1", [&group.name], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            for word in &group.words {
                conn.execute(
                    "INSERT OR IGNORE INTO SynonymItem (group_id, word) VALUES (?1, ?2)",
                    rusqlite::params![gid, word],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        for rule in &d.added_rules {
            let old_text = rule["oldText"].as_str().ok_or("oldText 누락")?;
            let new_text = rule["newText"].as_str().ok_or("newText 누락")?;
            let priority = rule["priority"].as_i64().ok_or("priority 누락")?;
            let is_regex: i64 = if rule["isRegex"].as_bool().unwrap_or(false) { 1 } else { 0 };
            conn.execute(
                "INSERT OR IGNORE INTO ReplaceRule (old_text, new_text, is_regex, priority) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![old_text, new_text, is_regex, priority],
            )
            .map_err(|e| e.to_string())?;
        }

        // 원본 앱의 갱신 버튼이 다시 떠서 기본 목록 전체를 다시 넣지 않게 판 번호를 맞춘다.
        upsert_config(conn, "synonym_version", &d.synonym_version)?;
        upsert_config(conn, "replace_rules_version", &d.replace_rules_version)?;
        upsert_config(conn, EDITION_DEFAULTS_KEY, &d.version)?;
        Ok(true)
    })
}

#[tauri::command]
pub fn apply_edition_defaults(
    defaults: EditionDefaults,
    state: State<DbState>,
    cache: State<crate::state::ReplaceCacheState>,
) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| "DB가 열려있지 않습니다.".to_string())?;
    let applied = apply_edition_defaults_impl(conn, &defaults)?;
    drop(guard);
    if applied {
        cache.lock().map_err(|e| e.to_string())?.invalidate();
    }
    Ok(applied)
}
