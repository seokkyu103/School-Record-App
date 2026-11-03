#!/usr/bin/env node
// 학년 일괄 세팅 — 학년 명렬표 하나로 반별 프로젝트 파일(.db)을 만든다.
//
// 사용법:
//   node tools/grade-setup/grade-setup.mjs --roster <명렬표.xlsx> --config <설정.json> --out <결과 폴더>
//        [--grade 1]       만들 학년. 명렬표에 학년이 여럿이면(전교 명렬표) 꼭 정한다.
//        [--classes 1,3]   만들 반만 고른다(시범 반 등). 없으면 그 학년의 모든 반.
//        [--test]          저장소 안에 결과를 만들어도 된다(가짜 자료 시험용).
//
// 만드는 것(반마다 파일 하나):
//   - 그 반 학생 전원(학년·반·번호·이름), 암호 없음 — 각 담임이 처음 열 때 설정한다.
//   - 설정 파일의 영역과 활동, 영역마다 반 전원 배정. 활동이 하나도 없는 영역은 만들지 않는다
//     (앱은 활동 없는 영역에 아무것도 쓸 수 없다).
//   - 앱의 기본 유의어·치환 규칙(앱이 새 파일에 넣는 것과 같은 목록)과 학교 공통 점검 묶음.
//   - 기록은 모두 빈칸.
//
// 파일 구조는 앱의 schema.sql과 SCHEMA_VERSION을 그대로 읽어 만든다. 원본 앱과 서로 열린다.
// 다 만든 뒤 다시 열어 검사하고, 검사에 실패하면 그 파일을 지운다.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {DatabaseSync} from 'node:sqlite'
import {DEFAULT_SYNONYMS, DEFAULT_SYNONYMS_VERSION} from '../../src/data/defaultSynonyms.ts'
import {DEFAULT_REPLACE_RULES, DEFAULT_REPLACE_RULES_VERSION} from '../../src/data/defaultReplaceRules.ts'
import {
  REPO_ROOT, ToolError, assertNotExists, groupByClass, parseArgs, parseClassFilter, parseGradeFilter, readJson,
  readRoster, requireArg, resolveOutDir, runMain,
} from '../lib/common.mjs'

// ---------- 앱에서 읽는 값 ----------

export function loadAppSchema() {
  const schemaSql = fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'src', 'schema.sql'), 'utf8')
  const dbRs = fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'src', 'db.rs'), 'utf8')
  const m = dbRs.match(/pub const SCHEMA_VERSION: u32 = (\d+);/)
  if (!m) throw new ToolError('db.rs에서 SCHEMA_VERSION을 찾지 못했습니다. 앱 구조가 바뀌었는지 확인하세요.')
  const conf = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  return {schemaSql, schemaVersion: Number(m[1]), appVersion: String(conf.version)}
}

// 앱이 쓰는 설정 키. stores/synonymStore.js, stores/replaceRule.js와 같아야 한다.
// 이 값이 없으면 앱이 "기본 목록 갱신" 안내를 띄우거나 목록을 다시 채운다.
const SYNONYM_VERSION_KEY = 'synonym_version'
const RULES_VERSION_KEY = 'replace_rules_version'

// ---------- 설정 ----------

/**
 * 설정 JSON을 검사하고 정리한다.
 * {
 *   "fileName": "2026_{grade}-{class}_생기부.db",
 *   "areas": [{ "name": "행동특성 및 종합의견", "byteLimit": 900, "activities": ["행동특성 및 종합의견"] }],
 *   "checkGroups": [{ "name": "...", "words": ["..."] }],
 *   "scanList": { "path": "...json", "rules": { "금지-01": "공인어학시험" } }
 * }
 * scanList.path는 설정 파일 기준 상대 경로도 된다. 그 목록의 '단어'와 '변형'을 넣고, '패턴'(정규식)은
 * 앱 점검이 글자 그대로만 찾기 때문에 넣지 않는다(빠진 수를 알린다).
 */
export function normalizeConfig(config, configDir = process.cwd()) {
  const problems = []
  const fileName = config.fileName ?? '{grade}-{class}_생기부.db'
  if (!fileName.includes('{class}') || !fileName.endsWith('.db')) problems.push('fileName에는 {class}가 있어야 하고 .db로 끝나야 합니다.')

  const areas = Array.isArray(config.areas) ? config.areas : []
  if (areas.length === 0) problems.push('areas가 비어 있습니다.')
  const areaNames = new Set()
  const activityNames = new Set()
  const cleanAreas = []
  for (const a of areas) {
    const name = String(a?.name ?? '').trim()
    const byteLimit = Number(a?.byteLimit)
    const acts = (Array.isArray(a?.activities) ? a.activities : []).map(s => String(s).trim()).filter(Boolean)
    if (!name) { problems.push('이름 없는 영역이 있습니다.'); continue }
    if (areaNames.has(name)) problems.push(`영역 이름이 겹칩니다: ${name}`)
    areaNames.add(name)
    if (!Number.isInteger(byteLimit) || byteLimit < 1) problems.push(`영역 ${name}: byteLimit은 1 이상의 정수여야 합니다.`)
    if (acts.length === 0) problems.push(`영역 ${name}: 활동이 하나도 없습니다. 활동 없는 영역에는 쓸 수 없으니 기본 활동을 하나 넣으세요.`)
    for (const act of acts) {
      // 앱의 활동 이름은 파일 전체에서 하나뿐이다(Activity.name UNIQUE).
      if (activityNames.has(act)) problems.push(`활동 이름이 겹칩니다: ${act}`)
      activityNames.add(act)
    }
    cleanAreas.push({name, byteLimit, activities: acts})
  }

  const groups = []
  for (const g of (Array.isArray(config.checkGroups) ? config.checkGroups : [])) {
    groups.push({name: String(g?.name ?? '').trim(), words: g?.words ?? []})
  }
  let skippedPatterns = 0
  if (config.scanList) {
    const p = path.resolve(configDir, String(config.scanList.path ?? ''))
    const list = readJson(p)
    const rules = config.scanList.rules ?? {}
    for (const [ruleId, title] of Object.entries(rules)) {
      const item = (list['항목'] ?? []).find(it => it['규칙'] === ruleId)
      if (!item) { problems.push(`점검 목록에 규칙이 없습니다: ${ruleId}`); continue }
      skippedPatterns += (item['패턴'] ?? []).length
      groups.push({name: `학교공통 ${ruleId} ${title}`.trim(), words: [...(item['단어'] ?? []), ...(item['변형'] ?? [])]})
    }
  }
  const groupNames = new Set(Object.keys(DEFAULT_SYNONYMS))
  const cleanGroups = []
  for (const g of groups) {
    if (!g.name) { problems.push('이름 없는 점검 묶음이 있습니다.'); continue }
    if (groupNames.has(g.name)) problems.push(`점검 묶음 이름이 앱 기본 묶음이나 다른 묶음과 겹칩니다: ${g.name}`)
    groupNames.add(g.name)
    const words = [...new Set(g.words.map(w => String(w).trim()).filter(Boolean))]
    if (words.length === 0) problems.push(`점검 묶음 ${g.name}에 단어가 없습니다.`)
    cleanGroups.push({name: g.name, words})
  }

  if (problems.length > 0) throw new ToolError('설정 파일을 확인하세요.\n' + problems.join('\n'))
  return {fileName, areas: cleanAreas, checkGroups: cleanGroups, skippedPatterns}
}

export function fileNameFor(pattern, grade, classNum) {
  return pattern.replaceAll('{grade}', String(grade)).replaceAll('{class}', String(classNum))
}

// ---------- 파일 만들기 ----------

/** 반 파일 하나를 만든다. 실패하면 만들다 만 파일을 지운다. */
export function buildClassFile(file, {students, config, app}) {
  assertNotExists(file)
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec('BEGIN')
    try {
      db.exec(app.schemaSql)

      const insStudent = db.prepare('INSERT INTO Student (grade, class_num, number, name) VALUES (?, ?, ?, ?)')
      const studentIds = students.map(s => Number(insStudent.run(s.grade, s.class_num, s.number, s.name).lastInsertRowid))

      const insArea = db.prepare('INSERT INTO Area (name, byte_limit) VALUES (?, ?)')
      const insAct = db.prepare('INSERT INTO Activity (name) VALUES (?)')
      const insAreaAct = db.prepare('INSERT INTO AreaActivity (area_id, activity_id) VALUES (?, ?)')
      const insAreaStu = db.prepare('INSERT INTO AreaStudent (area_id, student_id) VALUES (?, ?)')
      for (const area of config.areas) {
        const areaId = Number(insArea.run(area.name, area.byteLimit).lastInsertRowid)
        for (const act of area.activities) {
          insAreaAct.run(areaId, Number(insAct.run(act).lastInsertRowid))
        }
        for (const sid of studentIds) insAreaStu.run(areaId, sid)
      }

      // 앱이 새 파일에 넣는 기본 목록을 먼저, 학교 공통 묶음을 뒤에(앱 화면은 묶음을 id 순으로 보여 준다).
      const insGroup = db.prepare('INSERT INTO SynonymGroup (name) VALUES (?)')
      const insWord = db.prepare('INSERT OR IGNORE INTO SynonymItem (group_id, word) VALUES (?, ?)')
      const allGroups = [
        ...Object.entries(DEFAULT_SYNONYMS).map(([name, words]) => ({name, words})),
        ...config.checkGroups,
      ]
      for (const g of allGroups) {
        const gid = Number(insGroup.run(g.name).lastInsertRowid)
        for (const w of g.words) {
          const word = String(w).trim()
          if (word) insWord.run(gid, word)
        }
      }

      const insRule = db.prepare('INSERT OR IGNORE INTO ReplaceRule (old_text, new_text, is_regex, priority) VALUES (?, ?, ?, ?)')
      for (const r of DEFAULT_REPLACE_RULES) insRule.run(r.oldText, r.newText, r.isRegex ? 1 : 0, r.priority)

      const insConf = db.prepare('INSERT INTO APP_CONFIGS (config_key, config_value) VALUES (?, ?)')
      insConf.run('app_version', app.appVersion)
      insConf.run(SYNONYM_VERSION_KEY, String(DEFAULT_SYNONYMS_VERSION))
      insConf.run(RULES_VERSION_KEY, String(DEFAULT_REPLACE_RULES_VERSION))

      db.exec(`PRAGMA user_version = ${Number(app.schemaVersion)}`)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  } catch (e) {
    db.close()
    fs.rmSync(file, {force: true})
    throw e
  }
  db.close()

  try {
    return verifyClassFile(file, {students, config, app})
  } catch (e) {
    fs.rmSync(file, {force: true})
    throw e
  }
}

// 앱이 파일을 열 때 확인하는 핵심 테이블(db.rs의 CORE_TABLES)
const CORE_TABLES = ['Student', 'Area', 'Activity', 'AreaActivity', 'AreaStudent', 'ActivityRecord', 'ActivityRecordHistory', 'Snapshot']

/** 만든 파일을 다시 열어 앱이 기대하는 모양인지 확인한다. 개수만 돌려준다. */
export function verifyClassFile(file, {students, config, app}) {
  const db = new DatabaseSync(file, {readOnly: true})
  try {
    const one = (sql) => Object.values(db.prepare(sql).get())[0]
    const problems = []
    for (const t of CORE_TABLES) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) problems.push(`테이블 없음: ${t}`)
    }
    if (one('PRAGMA user_version') !== app.schemaVersion) problems.push('스키마 버전이 앱과 다름')
    if (one('PRAGMA integrity_check') !== 'ok') problems.push('integrity_check 실패')
    if (db.prepare('PRAGMA foreign_key_check').all().length > 0) problems.push('외래키 위반')
    const counts = {
      students: one('SELECT COUNT(*) FROM Student'),
      areas: one('SELECT COUNT(*) FROM Area'),
      activities: one('SELECT COUNT(*) FROM Activity'),
      assignments: one('SELECT COUNT(*) FROM AreaStudent'),
      records: one('SELECT COUNT(*) FROM ActivityRecord'),
      checkWords: one('SELECT COUNT(*) FROM SynonymItem'),
      replaceRules: one('SELECT COUNT(*) FROM ReplaceRule'),
    }
    if (counts.students !== students.length) problems.push('학생 수가 명렬표와 다름')
    if (counts.areas !== config.areas.length) problems.push('영역 수가 설정과 다름')
    if (counts.assignments !== students.length * config.areas.length) problems.push('반 전원이 모든 영역에 배정되지 않음')
    if (counts.records !== 0) problems.push('기록이 비어 있지 않음')
    if (one('SELECT COUNT(*) FROM Area a WHERE NOT EXISTS (SELECT 1 FROM AreaActivity aa WHERE aa.area_id = a.id)') !== 0) {
      problems.push('활동 없는 영역이 있음')
    }
    if (one("SELECT COUNT(*) FROM APP_CONFIGS WHERE config_key LIKE 'encryption%'") !== 0) problems.push('암호화 설정이 들어 있음')
    if (problems.length > 0) throw new ToolError(`${path.basename(file)} 검사 실패(파일을 지웠습니다): ${problems.join(', ')}`)
    return counts
  } finally {
    db.close()
  }
}

// ---------- 실행 ----------

export async function main(argv) {
  const args = parseArgs(argv)
  const rosterPath = requireArg(args, 'roster', '학년 명렬표(xlsx·xls·csv)')
  const configPath = requireArg(args, 'config', '설정 JSON(예: tools/grade-setup/setup.example.json)')
  const outDir = resolveOutDir(requireArg(args, 'out', '결과 폴더(저장소 밖)'), {test: args.test === true})
  const onlyClasses = parseClassFilter(args.classes)
  const onlyGrade = parseGradeFilter(args.grade)

  const app = loadAppSchema()
  const config = normalizeConfig(readJson(configPath), path.dirname(path.resolve(configPath)))
  const classes = groupByClass(readRoster(rosterPath))

  // 전교 명렬표를 넣고 학년을 고르지 않으면, 같은 반 번호의 다른 학년 파일까지 만들어진다.
  const grades = [...new Set([...classes.values()].map(list => list[0].grade))].sort((a, b) => a - b)
  if (onlyGrade === null && grades.length > 1) {
    throw new ToolError(`명렬표에 학년이 여럿입니다(${grades.join('·')}학년). --grade로 만들 학년을 정하세요.`)
  }
  const targets = [...classes.entries()].filter(([, list]) =>
      (onlyGrade === null || list[0].grade === onlyGrade) && (!onlyClasses || onlyClasses.has(list[0].class_num)))
  if (targets.length === 0) throw new ToolError('만들 반이 없습니다. --grade·--classes와 명렬표의 학년·반 번호를 확인하세요.')
  // 하나라도 이미 있으면 아무것도 만들지 않는다(일부 반만 새 파일이 되는 일을 막는다).
  for (const [k, list] of targets) {
    assertNotExists(path.join(outDir, fileNameFor(config.fileName, list[0].grade, list[0].class_num)))
  }

  console.log(`스키마 v${app.schemaVersion}, 앱 ${app.appVersion} 기준. 영역 ${config.areas.length}개, 학교 공통 점검 묶음 ${config.checkGroups.length}개` +
      (config.skippedPatterns ? ` (정규식 패턴 ${config.skippedPatterns}개는 앱 점검이 지원하지 않아 뺌)` : ''))
  for (const [k, list] of targets) {
    const file = path.join(outDir, fileNameFor(config.fileName, list[0].grade, list[0].class_num))
    const c = buildClassFile(file, {students: list, config, app})
    console.log(`${k}반: 학생 ${c.students}명, 영역 ${c.areas}, 활동 ${c.activities}, 배정 ${c.assignments}, 점검 단어 ${c.checkWords}, 치환 규칙 ${c.replaceRules} → ${path.basename(file)}`)
  }
  console.log(`끝: ${targets.length}개 반 → ${outDir}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMain(main)
}
