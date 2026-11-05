import {describe, expect, it} from 'vitest'
import {areaBytes, areasOfStudent, collectStudents, joinedPreview, splitVisible} from './studentView'

const s = (id: number, number: number, class_num = 6) => ({id, grade: 1, class_num, number, name: `학생${id}`})
const area = (id: number) => ({id, name: `영역${id}`, byte_limit: 1500})

describe('collectStudents', () => {
  it('여러 영역의 학생을 한 번씩, 학년·반·번호 순으로 모은다', () => {
    const grids = [
      {area: area(1), activities: [], students: [s(2, 2), s(1, 1)]},
      {area: area(2), activities: [], students: [s(1, 1), s(3, 3)]},
    ]
    expect(collectStudents(grids).map(x => x.id)).toEqual([1, 2, 3])
  })
})

describe('areasOfStudent', () => {
  it('학생이 배정된 영역만 고른다', () => {
    const grids = [
      {area: area(1), activities: [], students: [s(1, 1)]},
      {area: area(2), activities: [], students: [s(2, 2)]},
    ]
    expect(areasOfStudent(grids, 1).map(g => g.area.id)).toEqual([1])
  })
})

describe('areaBytes', () => {
  it('복사되는 합친 글을 센다 — 칸 사이 구분 글자 포함, 빈 칸은 뺌', () => {
    const contents: Record<number, string> = {1: '가나', 2: 'ab'}
    const acts = [{id: 1, name: 'a'}, {id: 2, name: 'b'}, {id: 3, name: 'c'}]
    // '가나' 6 + ' ' 1 + 'ab' 2 = 9
    expect(areaBytes(acts, id => contents[id] ?? '')).toBe(9)
    // 구분 글자가 한글이면 그만큼 더 센다: 6 + 3 + 2
    expect(areaBytes(acts, id => contents[id] ?? '', '및')).toBe(11)
  })

  it('복사처럼 칸 안 줄바꿈은 띄어쓰기 1바이트로 센다', () => {
    const contents: Record<number, string> = {1: 'a\nb'}
    expect(areaBytes([{id: 1, name: 'a'}], id => contents[id] ?? '')).toBe(3)
  })

  it('글이 없으면 0', () => {
    expect(areaBytes([{id: 1, name: 'a'}], () => '')).toBe(0)
  })
})

describe('joinedPreview', () => {
  it('빈 칸을 빼고 줄바꿈·겹친 공백을 정리해 잇는다', () => {
    const contents: Record<number, string> = {1: '첫 활동.\n둘째 줄.', 2: '', 3: '셋째  활동.'}
    const acts = [1, 2, 3].map(id => ({id, name: String(id)}))
    expect(joinedPreview(acts, id => contents[id] ?? '', ' ')).toBe('첫 활동. 둘째 줄. 셋째 활동.')
  })
})

describe('splitVisible', () => {
  const acts = [1, 2, 3].map(id => ({id, name: String(id)}))
  const contents: Record<number, string> = {1: '글', 2: '  ', 3: ''}
  const contentOf = (id: number) => contents[id] ?? ''

  it('기본은 글이 있는 칸만 보이고 빈 칸(공백뿐인 칸 포함)은 접는다', () => {
    const r = splitVisible(acts, contentOf, new Set(), false)
    expect(r.visible.map(a => a.id)).toEqual([1])
    expect(r.hidden.map(a => a.id)).toEqual([2, 3])
  })

  it('펼친 빈 칸은 보인다', () => {
    expect(splitVisible(acts, contentOf, new Set([3]), false).visible.map(a => a.id)).toEqual([1, 3])
  })

  it('모두 보기면 빈 칸도 보인다', () => {
    expect(splitVisible(acts, contentOf, new Set(), true).hidden).toEqual([])
  })
})
