/**
 * 학생별 보기(고양외고 25기 1학년부 판) — 한 학생의 모든 영역을 한 화면에 보이기 위한 계산.
 *
 * 화면(StudentViewSection)은 영역마다 get_area_grid 결과를 받는다. 여기서는 그 결과에서
 * 한 학생 몫만 골라 영역 순서대로 늘어놓고, 바이트 합과 보일 칸을 정한다.
 * 저장은 하지 않는다 — 저장은 기록 화면과 같은 upsert_record를 쓴다.
 */

import {byteLength} from './recordText'

export interface AreaLike {
  id: number
  name: string
  byte_limit: number
}

export interface ActivityLike {
  id: number
  name: string
}

export interface StudentLike {
  id: number
  grade: number
  class_num: number
  number: number
  name: string
}

export interface AreaGrid {
  area: AreaLike
  activities: ActivityLike[]
  students: StudentLike[]
}

/** 기록 칸 하나의 키. 기록은 (활동, 학생)으로 식별되므로 영역이 달라도 같은 칸이면 같은 키다. */
export function cellKey(activityId: number, studentId: number): string {
  return `${activityId}-${studentId}`
}

/**
 * 영역 격자들에 나오는 학생을 한 번씩, 학년·반·번호 순으로 모은다.
 * 영역마다 배정이 다를 수 있어(행발만 배정 등) 합집합을 쓴다.
 */
export function collectStudents(grids: AreaGrid[]): StudentLike[] {
  const byId = new Map<number, StudentLike>()
  for (const g of grids) for (const s of g.students) if (!byId.has(s.id)) byId.set(s.id, s)
  return [...byId.values()].sort((a, b) =>
      a.grade - b.grade || a.class_num - b.class_num || a.number - b.number)
}

/** 학생이 배정된 영역만 고른다. 배정되지 않은 영역은 기록 화면에도 그 학생 줄이 없다. */
export function areasOfStudent(grids: AreaGrid[], studentId: number): AreaGrid[] {
  return grids.filter(g => g.students.some(s => s.id === studentId))
}

/** 한 영역에서 그 학생 칸의 바이트 합. 기록 화면의 학생별 합계와 같은 셈(칸마다 byteLength를 더함)이다. */
export function areaBytes(activities: ActivityLike[], contentOf: (activityId: number) => string): number {
  return activities.reduce((sum, a) => sum + byteLength(contentOf(a.id)), 0)
}

/** 합친 글 미리보기. 내보내기·기록 화면 미리보기처럼 빈 칸을 빼고 줄바꿈을 띄어쓰기로 바꿔 잇는다. */
export function joinedPreview(
    activities: ActivityLike[],
    contentOf: (activityId: number) => string,
    separator: string,
): string {
  return activities
      .map(a => contentOf(a.id).replace(/[\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim())
      .filter(c => c !== '')
      .join(separator)
}

/**
 * 영역의 활동을 "보일 칸"과 "접어 둔 빈 칸"으로 나눈다.
 *
 * 상담 화면을 깔끔하게 하려고 기본으로는 글이 있는 칸만 보인다. 빈 칸은 이름만 모아 두고,
 * 누르면 펼친다(revealed). showAll이면 모두 보인다. 한 번 펼친 칸은 글을 지워도 계속 보인다
 * — 쓰던 칸이 지우는 순간 사라지면 붙여넣을 곳을 잃는다.
 */
export function splitVisible(
    activities: ActivityLike[],
    contentOf: (activityId: number) => string,
    revealed: Set<number>,
    showAll: boolean,
): {visible: ActivityLike[], hidden: ActivityLike[]} {
  const visible: ActivityLike[] = []
  const hidden: ActivityLike[] = []
  for (const a of activities) {
    if (showAll || revealed.has(a.id) || contentOf(a.id).trim() !== '') visible.push(a)
    else hidden.push(a)
  }
  return {visible, hidden}
}
