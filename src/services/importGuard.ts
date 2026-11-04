/**
 * 가져오기 보호 규칙.
 *
 * 수합파일 수정본을 다시 가져올 때 담임이 손으로 고친 칸을 기본으로 덮어쓰지 않기 위한
 * 판정이다. 스키마를 바꾸지 않고, 가져오기가 이미 남기는 버전 기록(메모 "import")을
 * "직전에 가져온 내용"으로 쓴다.
 */

/** 가져오기가 버전 기록에 붙이는 메모. commands/record.rs의 bulk_import_records_impl과 같아야 한다. */
export const IMPORT_HISTORY_NOTE = 'import'

export interface HistoryLike {
  content: string
  note: string | null
}

/**
 * 버전 기록(최신이 앞)에서 가장 최근에 가져온 내용을 찾는다. 없으면 null.
 *
 * 메모는 다른 작업 이름으로 덮일 수 있다(같은 내용이면 최신 행의 메모만 바꾸는 설계).
 * 그때는 null이 되고, 아래 판정은 "담임이 고침" 쪽으로 기운다 — 덮어쓰지 않는 쪽이 안전하다.
 */
export function findLastImported(history: HistoryLike[]): string | null {
  const hit = history.find(h => h.note === IMPORT_HISTORY_NOTE)
  return hit ? hit.content : null
}

export type ChangeKind = 'source-updated' | 'teacher-edited'

/**
 * 기존 내용이 바뀌는 칸을 둘로 나눈다.
 * - source-updated: 지금 내용이 직전에 가져온 내용 그대로다. 수합본만 바뀌었으니 새 내용으로 바꿔도 잃는 것이 없다.
 * - teacher-edited: 직전 가져오기 뒤에 누군가 고쳤거나, 가져온 기록이 없다. 기본으로 덮어쓰지 않는다.
 */
export function classifyChange(existing: string, lastImported: string | null): ChangeKind {
  return lastImported !== null && existing === lastImported ? 'source-updated' : 'teacher-edited'
}

export interface IdentityRow {
  grade: number
  class_num: number
  number: number
  name: string | null
}

export interface StudentRow {
  grade: number
  class_num: number
  number: number
  name: string
}

export interface NameMismatch {
  grade: number
  class_num: number
  number: number
  fileName: string
  savedName: string
}

/** 이름 비교용. 공백만 다른 것은 같은 이름으로 본다. */
export function normalizeName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s+/g, '')
}

/**
 * 파일의 이름과 프로젝트에 저장된 이름이 다른 학생을 학생당 한 번씩 돌려준다.
 *
 * 가져오기는 학년·반·번호로만 짝짓고 이름이 달라도 그대로 붙인다. 번호가 밀린 수합파일이면
 * 다른 학생의 문장이 조용히 들어가므로 미리보기에서 알린다. 파일에 이름이 없거나
 * 프로젝트에 없는 학생은 비교할 것이 없어 뺀다.
 */
export function findNameMismatches(rows: IdentityRow[], students: StudentRow[]): NameMismatch[] {
  const saved = new Map<string, string>()
  for (const s of students) saved.set(`${s.grade}-${s.class_num}-${s.number}`, s.name)

  const seen = new Set<string>()
  const result: NameMismatch[] = []
  for (const r of rows) {
    const key = `${r.grade}-${r.class_num}-${r.number}`
    if (seen.has(key) || !normalizeName(r.name)) continue
    const savedName = saved.get(key)
    if (savedName === undefined) continue
    seen.add(key)
    if (normalizeName(savedName) !== normalizeName(r.name)) {
      result.push({grade: r.grade, class_num: r.class_num, number: r.number, fileName: String(r.name), savedName})
    }
  }
  return result
}

/**
 * 프로젝트 명단에 있는 학생의 행과 없는 학생의 행을 나눈다.
 *
 * 반별 파일에는 반 전원이 미리 들어 있다. 담당 교사가 보낸 행사 기록 엑셀에는 여러 반 학생이
 * 섞여 있어, 그대로 가져오면 다른 반 학생이 이 파일에 새로 만들어진다. 명단에 없는 행을
 * 건너뛸 수 있게 미리 나눈다(건너뛸지는 화면에서 고른다). 학년·반·번호로만 맞춘다 — 이름이
 * 다른 경우는 findNameMismatches가 따로 알린다.
 */
export function splitByKnownStudents<T extends Omit<IdentityRow, 'name'>>(
  rows: T[],
  students: Omit<StudentRow, 'name'>[],
): {known: T[], unknown: T[]} {
  const ids = new Set(students.map(s => `${s.grade}-${s.class_num}-${s.number}`))
  const known: T[] = []
  const unknown: T[] = []
  for (const r of rows) (ids.has(`${r.grade}-${r.class_num}-${r.number}`) ? known : unknown).push(r)
  return {known, unknown}
}
