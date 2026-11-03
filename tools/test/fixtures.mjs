// 시험용 가짜 자료. 실제 학생과 무관하게 정해진 규칙으로 이름과 문장을 만든다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import XLSX from 'xlsx'

const SURNAMES = ['가', '나', '다', '라', '마', '바', '사', '아']
const GIVEN = ['하늘', '바다', '구름', '나무', '별빛', '노을', '이슬', '햇살', '시내', '들꽃']

/** 반마다 n명. 이름은 "가하늘" 꼴의 가짜 이름(겹치지 않게 반 번호를 섞는다). */
export function fakeStudents(grade, classNums, n) {
  const out = []
  for (const c of classNums) {
    for (let i = 1; i <= n; i++) {
      out.push({grade, class_num: c, number: i, name: SURNAMES[(c + i) % SURNAMES.length] + GIVEN[i % GIVEN.length] + (i > GIVEN.length ? String.fromCharCode(0xAC00 + c * 7 + i) : '')})
    }
  }
  return out
}

export const studentId = (s) => `${s.grade}${String(s.class_num).padStart(2, '0')}${String(s.number).padStart(2, '0')}`

export function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `grade-tools-${label}-`))
}

export function writeXlsx(file, aoa) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1')
  XLSX.writeFile(wb, file)
  return file
}

/** 학교 양식처럼 제목 줄이 한 줄 있고 학번·이름 열을 쓰는 명렬표 */
export function writeRoster(file, students) {
  return writeXlsx(file, [
    ['2026학년도 1학년 명렬표(가짜)'],
    ['학번', '이름'],
    ...students.map(s => [Number(studentId(s)), s.name]),
  ])
}

export const COMMON_INTRO = '학급 자치 회의에서 학급 규칙을 정하는 토의에 참여함.'

/**
 * 가짜 수합파일. 모든 학생에게 같은 소개 문장(COMMON_INTRO) + 학생별 문장.
 * revised면 소개 문장이 바뀐 수정본.
 */
export function collectRows(students, {revised = false} = {}) {
  const intro = revised ? '학급 자치 회의에서 학급 규칙을 정하고 실천 방안을 토의함.' : COMMON_INTRO
  return [
    ['학번', '이름', '행사명', '지도교사', '기재내용'],
    ...students.map(s => [studentId(s), s.name, '학급자치회의', '가교사', `${intro} 번호 ${s.number}의 의견을 정리해 발표함.`]),
  ]
}

/** 금지어 스캔 목록과 같은 구조의 작은 가짜 목록 */
export function writeScanList(file) {
  fs.writeFileSync(file, JSON.stringify({
    '항목': [
      {'규칙': '금지-01', '단어': ['TOEIC', 'TOEFL'], '변형': ['토익']},
      {'규칙': '금지-02', '단어': ['대회'], '변형': ['경시대회']},
      {'규칙': '금지-12', '단어': ['강사'], '변형': [], '패턴': ['[가-힣]+대학교']},
    ],
  }), 'utf8')
  return file
}

export const SETUP_CONFIG = {
  fileName: '2026_{grade}-{class}_생기부.db',
  areas: [
    {name: '자율·자치활동', byteLimit: 1500, activities: ['담임 기록(자율·자치)']},
    {name: '동아리활동', byteLimit: 1500, activities: ['동아리 기록']},
    {name: '진로활동', byteLimit: 1500, activities: ['담임 기록(진로)']},
    {name: '행동특성 및 종합의견', byteLimit: 900, activities: ['행동특성 및 종합의견']},
  ],
  scanList: {path: 'scan.json', rules: {'금지-01': '공인어학시험', '금지-02': '대회', '금지-12': '기관명'}},
}
