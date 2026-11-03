import {describe, expect, it} from 'vitest'
import {classifyChange, findLastImported, findNameMismatches, IMPORT_HISTORY_NOTE} from './importGuard'

describe('findLastImported', () => {
  it('최신부터 보아 처음 만난 import 메모의 내용', () => {
    const history = [
      {content: '담임이 고친 문장', note: '가져오기 전'},
      {content: '두 번째 수합본', note: IMPORT_HISTORY_NOTE},
      {content: '첫 수합본', note: IMPORT_HISTORY_NOTE},
    ]
    expect(findLastImported(history)).toBe('두 번째 수합본')
  })

  it('import 메모가 없으면 null', () => {
    expect(findLastImported([{content: 'a', note: '치환 적용 전'}, {content: 'b', note: null}])).toBeNull()
    expect(findLastImported([])).toBeNull()
  })
})

describe('classifyChange', () => {
  it('지금 내용이 직전 가져오기와 같으면 수합본만 바뀐 것', () => {
    expect(classifyChange('수합본', '수합본')).toBe('source-updated')
  })

  it('직전 가져오기 뒤에 고쳤으면 담임 수정', () => {
    expect(classifyChange('담임이 줄인 문장', '수합본')).toBe('teacher-edited')
  })

  it('가져온 기록이 없으면 담임 수정으로 본다(덮어쓰지 않는 쪽)', () => {
    expect(classifyChange('직접 쓴 문장', null)).toBe('teacher-edited')
  })
})

describe('findNameMismatches', () => {
  const students = [
    {grade: 1, class_num: 3, number: 1, name: '가나다'},
    {grade: 1, class_num: 3, number: 2, name: '라마바'},
  ]

  it('이름이 다른 학생만, 학생당 한 번', () => {
    const rows = [
      {grade: 1, class_num: 3, number: 1, name: '가나다'},
      {grade: 1, class_num: 3, number: 2, name: '사아자'},
      {grade: 1, class_num: 3, number: 2, name: '사아자'},
    ]
    expect(findNameMismatches(rows, students)).toEqual([
      {grade: 1, class_num: 3, number: 2, fileName: '사아자', savedName: '라마바'},
    ])
  })

  it('공백만 다르면 같은 이름', () => {
    expect(findNameMismatches([{grade: 1, class_num: 3, number: 1, name: '가 나다 '}], students)).toEqual([])
  })

  it('파일에 이름이 없거나 프로젝트에 없는 학생은 비교하지 않는다', () => {
    const rows = [
      {grade: 1, class_num: 3, number: 1, name: null},
      {grade: 1, class_num: 3, number: 9, name: '차카타'},
    ]
    expect(findNameMismatches(rows, students)).toEqual([])
  })
})
