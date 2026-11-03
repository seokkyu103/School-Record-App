#!/usr/bin/env node
// 수합파일 반별 분할 — 활동 담당 교사의 학년 전체 수합파일을 반별 가져오기 파일로 나눈다.
//
// 사용법:
//   node tools/collect-split/collect-split.mjs --input <수합파일.xlsx> --roster <학년 명렬표.xlsx> --out <결과 폴더>
//        [--map <활동명 대응.json>]  {"행사명": "앱 활동명"}. 없으면 행사명을 그대로 활동명으로 쓴다.
//                                     앱은 영역 안 활동을 이름 순으로 늘어놓으므로, 순서를 맞추려면
//                                     "03 학급자치회의"처럼 앞에 번호를 붙인 이름으로 대응시킨다.
//        [--prefix <이름>]           결과 파일 이름 앞부분. 없으면 수합파일 이름.
//        [--test]                    저장소 안에 결과를 만들어도 된다(가짜 자료 시험용).
//
// 수합파일 한 행 = 학번 | 이름 | 행사명 | 지도교사 | 기재내용 (열 순서는 상관없고 머리글로 찾는다).
// 결과(반마다): 학년 | 반 | 번호 | 이름 | 활동명 | 활동내용 — 앱의 "행 단위 활동 형식"(A타입) 그대로라
//   가져오기에서 열이 자동으로 맞춰진다. 이름은 명렬표의 이름을 쓴다.
// 확인목록: 학번을 읽을 수 없는 행, 명렬표에 없는 학번, 이름이 다른 행, 내용이 빈 행,
//   같은 학생·같은 활동이 두 번 나온 행. 이름이 다르거나 겹치는 행은 반 파일에 넣지 않는다
//   (번호가 밀린 수합파일이면 다른 학생의 문장이 들어가기 때문이다). 확인목록을 보고 고친 뒤 다시 돌린다.
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import XLSX from 'xlsx'
import {
  ToolError, assertNotExists, findHeader, identityOf, keyOf, normName, parseArgs, readJson,
  readRoster, readSheetRows, requireArg, resolveOutDir, runMain,
} from '../lib/common.mjs'

export const COLLECT_ALIASES = {
  studentId: ['학번'],
  grade: ['학년'],
  classNum: ['반', '학급'],
  number: ['번호', '번'],
  name: ['이름', '성명', '학생명'],
  event: ['행사명', '활동명', '행사', '활동'],
  teacher: ['지도교사', '담당교사', '교사'],
  content: ['기재내용', '기재 내용', '내용', '활동내용', '특기사항'],
}

/**
 * 수합파일 행을 반별로 나눈다. 파일을 쓰지 않는 순수 함수(시험용).
 * rows: 시트의 2차원 배열, roster: readRoster 결과(없으면 null), map: {행사명: 활동명}
 */
export function splitCollect(rows, roster, map = {}) {
  const {headerRow, cols} = findHeader(rows, COLLECT_ALIASES, [
    ['studentId', 'event', 'content'],
    ['grade', 'classNum', 'number', 'event', 'content'],
  ])
  const rosterByKey = roster ? new Map(roster.map(s => [keyOf(s), s])) : null
  const issues = []
  const candidates = []
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every(c => c === '')) continue
    const line = r + 1
    const fileName = cols.name !== undefined ? String(row[cols.name] ?? '').trim() : ''
    const event = String(row[cols.event] ?? '').trim()
    const content = String(row[cols.content] ?? '').trim()
    const base = {line, fileName, event}
    const id = identityOf(row, cols)
    if (!id) { issues.push({...base, kind: '학번을 읽을 수 없음'}); continue }
    if (!event) { issues.push({...base, ...id, kind: '행사명 없음'}); continue }
    if (!content) { issues.push({...base, ...id, kind: '내용 빈칸(넣지 않음)'}); continue }
    let name = fileName
    if (rosterByKey) {
      const s = rosterByKey.get(keyOf(id))
      if (!s) { issues.push({...base, ...id, kind: '명렬표에 없는 학번(넣지 않음)'}); continue }
      if (fileName && normName(fileName) !== normName(s.name)) {
        issues.push({...base, ...id, rosterName: s.name, kind: '이름 다름(넣지 않음)'})
        continue
      }
      name = s.name
    }
    const activity = String(map[event] ?? event).trim()
    candidates.push({...id, name, activity, content, line, event})
  }

  // 같은 학생·같은 활동이 두 번이면 어느 쪽이 맞는지 알 수 없다. 내용까지 같으면 하나만 남긴다.
  const byCell = new Map()
  for (const c of candidates) {
    const k = `${keyOf(c)}|${c.activity}`
    if (!byCell.has(k)) byCell.set(k, [])
    byCell.get(k).push(c)
  }
  const byClass = new Map()
  for (const list of byCell.values()) {
    const contents = new Set(list.map(c => c.content))
    if (contents.size > 1) {
      for (const c of list) issues.push({line: c.line, fileName: c.name, event: c.event, grade: c.grade, class_num: c.class_num, number: c.number, kind: '같은 학생·활동이 내용이 달라 두 번(넣지 않음)'})
      continue
    }
    const c = list[0]
    const ck = `${c.grade}-${c.class_num}`
    if (!byClass.has(ck)) byClass.set(ck, [])
    byClass.get(ck).push(c)
  }
  for (const list of byClass.values()) {
    list.sort((a, b) => a.number - b.number || a.activity.localeCompare(b.activity, 'ko'))
  }
  issues.sort((a, b) => a.line - b.line)
  return {byClass: new Map([...byClass.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, {numeric: true}))), issues, hasRoster: !!roster}
}

function writeSheet(file, header, rows) {
  assertNotExists(file)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Sheet1')
  XLSX.writeFile(wb, file)
}

export async function main(argv) {
  const args = parseArgs(argv)
  const input = requireArg(args, 'input', '학년 전체 수합파일')
  const outDir = resolveOutDir(requireArg(args, 'out', '결과 폴더(저장소 밖)'), {test: args.test === true})
  const roster = typeof args.roster === 'string' ? readRoster(args.roster) : null
  if (!roster) console.log('주의: --roster가 없어 이름 대조를 하지 않습니다.')
  const map = typeof args.map === 'string' ? readJson(args.map) : {}
  const prefix = typeof args.prefix === 'string' ? args.prefix : path.basename(input).replace(/\.[^.]+$/, '')

  const {byClass, issues} = splitCollect(readSheetRows(input), roster, map)
  const files = [...byClass.entries()].map(([ck]) => path.join(outDir, `${prefix}_${ck}.xlsx`))
  const issueFile = path.join(outDir, `${prefix}_확인목록.xlsx`)
  for (const f of [...files, issueFile]) assertNotExists(f)

  for (const [ck, list] of byClass) {
    writeSheet(path.join(outDir, `${prefix}_${ck}.xlsx`), ['학년', '반', '번호', '이름', '활동명', '활동내용'],
        list.map(c => [c.grade, c.class_num, c.number, c.name, c.activity, c.content]))
    console.log(`${ck}반: ${list.length}행, 활동 ${new Set(list.map(c => c.activity)).size}개`)
  }
  writeSheet(issueFile, ['수합파일 행', '구분', '학년', '반', '번호', '수합파일 이름', '명렬표 이름', '행사명'],
      issues.map(i => [i.line, i.kind, i.grade ?? '', i.class_num ?? '', i.number ?? '', i.fileName ?? '', i.rosterName ?? '', i.event ?? '']))
  const byKind = {}
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1
  console.log(`확인목록 ${issues.length}건` + (issues.length ? ': ' + Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ') : ''))
  console.log(`끝: ${byClass.size}개 반 → ${outDir}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMain(main)
}
