// 학년부 도구(grade-setup, collect-split)가 함께 쓰는 것.
//
// 원칙
//   - 학생 이름·문장은 화면(표준 출력)에 내지 않는다. 개수와 학년·반만 낸다.
//   - 실제 명렬표로 만든 결과물은 저장소 밖에 둔다. 저장소 안에 쓰려면 --test를 줘야 한다.
//   - 이미 있는 파일은 덮어쓰지 않는다.
//   - 학번 해석은 앱과 같은 규칙(src/services/studentId.ts)을 그대로 쓴다.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import XLSX from 'xlsx'
import {isValidIdentityPart, parseStudentId} from '../../src/services/studentId.ts'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export class ToolError extends Error {}

// ---------- 인자 ----------

/** `--key value`와 `--flag`를 읽는다. 같은 키가 두 번 나오면 뒤의 것. */
export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new ToolError(`알 수 없는 인자: ${a}`)
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

export function requireArg(args, key, hint) {
  const v = args[key]
  if (typeof v !== 'string' || !v) throw new ToolError(`--${key}가 필요합니다. ${hint ?? ''}`.trim())
  return v
}

// ---------- 출력 위치 ----------

function isInside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 결과 폴더를 정한다. 실제 학생 이름이 든 파일이 저장소(공개 GitHub)에 들어가지 않게
 * 저장소 안은 --test일 때만 허락한다.
 */
export function resolveOutDir(outArg, {test = false} = {}) {
  const dir = path.resolve(outArg)
  if (isInside(dir, REPO_ROOT) && !test) {
    throw new ToolError(`결과 폴더가 저장소 안입니다: ${dir}\n학생 이름이 든 파일은 저장소 밖에 만드세요(예: 바탕화면의 배포 폴더).`)
  }
  fs.mkdirSync(dir, {recursive: true})
  return dir
}

/** 이미 있으면 멈춘다. 담임에게 나간 파일을 실수로 새 빈 파일로 바꾸지 않기 위해서다. */
export function assertNotExists(file) {
  if (fs.existsSync(file)) throw new ToolError(`이미 파일이 있습니다(덮어쓰지 않음): ${file}`)
}

// ---------- 표 읽기 ----------

/** 첫 시트를 문자열 2차원 배열로 읽는다(xlsx·xls·csv). 수식은 저장된 계산 결과를 쓴다. */
export function readSheetRows(file) {
  if (!fs.existsSync(file)) throw new ToolError(`파일이 없습니다: ${file}`)
  const wb = XLSX.read(fs.readFileSync(file), {type: 'buffer', cellDates: false})
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, {header: 1, defval: '', raw: true, blankrows: false})
  return raw.map(row => row.map(v => (v === null || v === undefined) ? '' : String(v).trim()))
}

const normHeader = (h) => String(h ?? '').toLowerCase().replace(/\s/g, '')

/**
 * 머리글 행을 찾아 열 위치를 돌려준다. 위쪽 제목 줄이 있는 학교 양식이 많아 처음 10행에서 찾는다.
 * aliases: { field: ['학년', ...] }. required의 열이 모두 있는 첫 행을 머리글로 본다.
 */
export function findHeader(rows, aliases, requiredSets) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cols = {}
    rows[r].forEach((h, i) => {
      const n = normHeader(h)
      for (const [field, names] of Object.entries(aliases)) {
        if (cols[field] === undefined && names.some(a => normHeader(a) === n)) cols[field] = i
      }
    })
    if (requiredSets.some(set => set.every(f => cols[f] !== undefined))) return {headerRow: r, cols}
  }
  throw new ToolError(`머리글 행을 찾지 못했습니다. 필요한 열: ${requiredSets.map(s => s.join('·')).join(' 또는 ')}`)
}

export const STUDENT_ALIASES = {
  grade: ['학년'],
  classNum: ['반', '학급'],
  number: ['번호', '번', '출석번호'],
  studentId: ['학번'],
  name: ['이름', '성명', '학생명', '학생이름'],
}

/**
 * 한 행에서 학년·반·번호를 읽는다. 학번 열이 있으면 학번을 먼저 본다(앱과 같은 자릿수 규칙).
 * 읽을 수 없으면 null.
 */
export function identityOf(row, cols) {
  let id = null
  if (cols.studentId !== undefined && row[cols.studentId]) {
    const p = parseStudentId(row[cols.studentId])
    if (p) id = {grade: p.grade, class_num: p.classNum, number: p.number}
  }
  if (!id && cols.grade !== undefined && cols.classNum !== undefined && cols.number !== undefined) {
    id = {grade: Number(row[cols.grade]), class_num: Number(row[cols.classNum]), number: Number(row[cols.number])}
  }
  if (!id) return null
  return [id.grade, id.class_num, id.number].every(isValidIdentityPart) ? id : null
}

export const keyOf = (s) => `${s.grade}-${s.class_num}-${s.number}`
export const normName = (n) => String(n ?? '').replace(/\s+/g, '')

/**
 * 명렬표를 읽는다. 문제(읽을 수 없는 행, 이름 없음, 같은 번호 두 번)가 하나라도 있으면
 * 어느 행인지 모아 멈춘다 — 반 파일은 한 번 나가면 고치기 어렵다.
 */
export function readRoster(file) {
  const rows = readSheetRows(file)
  const {headerRow, cols} = findHeader(rows, STUDENT_ALIASES, [
    ['grade', 'classNum', 'number', 'name'],
    ['studentId', 'name'],
  ])
  const students = []
  const problems = []
  const seen = new Map()
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.every(c => c === '')) continue
    const id = identityOf(row, cols)
    const name = String(row[cols.name] ?? '').trim()
    const line = r + 1
    if (!id) { problems.push(`${line}행: 학년·반·번호(학번)를 읽을 수 없음`); continue }
    if (!name) { problems.push(`${line}행: 이름 없음`); continue }
    const k = keyOf(id)
    if (seen.has(k)) { problems.push(`${line}행: ${id.grade}학년 ${id.class_num}반 ${id.number}번이 ${seen.get(k)}행과 겹침`); continue }
    seen.set(k, line)
    students.push({...id, name})
  }
  if (problems.length > 0) {
    throw new ToolError(`명렬표에 확인할 행이 ${problems.length}개 있습니다(파일은 만들지 않았습니다).\n` + problems.join('\n'))
  }
  if (students.length === 0) throw new ToolError('명렬표에 학생이 없습니다.')
  return students
}

/** 학년·반별로 묶는다. 키는 "1-3" 꼴, 반 번호 순. */
export function groupByClass(students) {
  const map = new Map()
  for (const s of [...students].sort((a, b) => a.grade - b.grade || a.class_num - b.class_num || a.number - b.number)) {
    const k = `${s.grade}-${s.class_num}`
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(s)
  }
  return map
}

/** "--classes 1,3" 같은 반 거르기. 비어 있으면 전부. */
export function parseClassFilter(v) {
  if (typeof v !== 'string' || !v.trim()) return null
  const nums = v.split(',').map(s => Number(s.trim()))
  if (!nums.every(isValidIdentityPart)) throw new ToolError(`--classes는 "1,3"처럼 반 번호를 쉼표로: ${v}`)
  return new Set(nums)
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    throw new ToolError(`JSON을 읽지 못했습니다(${file}): ${e.message}`)
  }
}

/** 실행 입구. ToolError는 메시지만, 그 밖의 오류는 그대로 낸다. */
export async function runMain(main) {
  try {
    await main(process.argv.slice(2))
  } catch (e) {
    if (e instanceof ToolError) {
      console.error('중단: ' + e.message)
      process.exitCode = 1
    } else {
      throw e
    }
  }
}
