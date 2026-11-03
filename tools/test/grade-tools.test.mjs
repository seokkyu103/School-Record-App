// 학년부 도구 시험. 가짜 자료만 쓰고 결과는 임시 폴더에 만든다.
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {afterAll, describe, expect, it} from 'vitest'
import {main as setupMain, normalizeConfig} from '../grade-setup/grade-setup.mjs'
import {splitCollect} from '../collect-split/collect-split.mjs'
import {readRoster, readSheetRows, resolveOutDir, REPO_ROOT, ToolError} from '../lib/common.mjs'
import {COMMON_INTRO, SETUP_CONFIG, collectRows, fakeStudents, studentId, tempDir, writeRoster, writeScanList, writeXlsx} from './fixtures.mjs'

const dirs = []
const mk = (label) => { const d = tempDir(label); dirs.push(d); return d }
afterAll(() => { for (const d of dirs) fs.rmSync(d, {recursive: true, force: true}) })

function prepare() {
  const dir = mk('setup')
  const students = fakeStudents(1, [1, 2, 3], 25)
  writeRoster(path.join(dir, 'roster.xlsx'), students)
  writeScanList(path.join(dir, 'scan.json'))
  fs.writeFileSync(path.join(dir, 'setup.json'), JSON.stringify(SETUP_CONFIG), 'utf8')
  return {dir, students}
}

const quiet = async (fn) => {
  const log = console.log
  console.log = () => {}
  try { return await fn() } finally { console.log = log }
}

describe('grade-setup', () => {
  it('반마다 파일 하나: 반 전원·영역 4개·영역마다 기본 활동·전원 배정·빈 기록·암호 없음', async () => {
    const {dir, students} = prepare()
    const out = path.join(dir, 'out')
    await quiet(() => setupMain(['--roster', path.join(dir, 'roster.xlsx'), '--config', path.join(dir, 'setup.json'), '--out', out]))

    expect(fs.readdirSync(out).sort()).toEqual(['2026_1-1_생기부.db', '2026_1-2_생기부.db', '2026_1-3_생기부.db'])
    const db = new DatabaseSync(path.join(out, '2026_1-3_생기부.db'), {readOnly: true})
    try {
      const names = db.prepare('SELECT grade, class_num, number, name FROM Student ORDER BY number').all()
      expect(names.map(r => r.name)).toEqual(students.filter(s => s.class_num === 3).map(s => s.name))
      expect(db.prepare('SELECT name, byte_limit FROM Area ORDER BY id').all().map(r => [r.name, r.byte_limit]))
          .toEqual([['자율·자치활동', 1500], ['동아리활동', 1500], ['진로활동', 1500], ['행동특성 및 종합의견', 900]])
      expect(db.prepare('SELECT COUNT(*) AS n FROM AreaStudent').get().n).toBe(25 * 4)
      expect(db.prepare('SELECT COUNT(*) AS n FROM ActivityRecord').get().n).toBe(0)
      // 행발 영역에 활동이 붙어 있어 바로 쓸 수 있다
      expect(db.prepare(`SELECT act.name FROM Activity act JOIN AreaActivity aa ON aa.activity_id = act.id
                         JOIN Area a ON a.id = aa.area_id WHERE a.name = '행동특성 및 종합의견'`).all().map(r => r.name))
          .toEqual(['행동특성 및 종합의견'])
      const conf = Object.fromEntries(db.prepare('SELECT config_key, config_value FROM APP_CONFIGS').all().map(r => [r.config_key, r.config_value]))
      expect(Object.keys(conf).some(k => k.startsWith('encryption'))).toBe(false)
      expect(conf.synonym_version).toBe('1')
      expect(conf.replace_rules_version).toBe('1')
      // 학교 공통 점검 묶음: 단어+변형은 들어가고 정규식 패턴은 빠진다
      const words = db.prepare(`SELECT si.word FROM SynonymItem si JOIN SynonymGroup sg ON sg.id = si.group_id
                                WHERE sg.name = '학교공통 금지-01 공인어학시험' ORDER BY si.word`).all().map(r => r.word)
      expect(words).toEqual(['TOEFL', 'TOEIC', '토익'])
      expect(db.prepare("SELECT COUNT(*) AS n FROM SynonymItem WHERE word = '[가-힣]+대학교'").get().n).toBe(0)
      // 앱이 새 파일에 넣는 기본 묶음도 있다
      expect(db.prepare("SELECT COUNT(*) AS n FROM SynonymGroup WHERE name = '유의어_기본'").get().n).toBe(1)
      expect(db.prepare('SELECT COUNT(*) AS n FROM ReplaceRule').get().n).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('--classes로 고른 반만 만들고, 이미 있는 파일은 덮어쓰지 않는다', async () => {
    const {dir} = prepare()
    const out = path.join(dir, 'out')
    const args = ['--roster', path.join(dir, 'roster.xlsx'), '--config', path.join(dir, 'setup.json'), '--out', out, '--classes', '2']
    await quiet(() => setupMain(args))
    expect(fs.readdirSync(out)).toEqual(['2026_1-2_생기부.db'])
    await expect(quiet(() => setupMain(args))).rejects.toThrow(/덮어쓰지 않음/)
  })

  it('저장소 안에는 --test 없이 만들지 않는다', () => {
    expect(() => resolveOutDir(path.join(REPO_ROOT, 'tools', 'test', 'should-not-exist'))).toThrow(ToolError)
  })

  it('활동 없는 영역, 겹치는 활동 이름은 설정 단계에서 막는다', () => {
    expect(() => normalizeConfig({areas: [{name: '행발', byteLimit: 900, activities: []}]})).toThrow(/활동이 하나도 없습니다/)
    expect(() => normalizeConfig({areas: [
      {name: 'A', byteLimit: 1500, activities: ['같은 이름']},
      {name: 'B', byteLimit: 1500, activities: ['같은 이름']},
    ]})).toThrow(/활동 이름이 겹칩니다/)
  })

  it('명렬표에 같은 번호가 두 번이면 파일을 만들지 않는다(이름은 오류에 내지 않는다)', () => {
    const dir = mk('dup')
    const s = fakeStudents(1, [1], 3)
    const file = writeXlsx(path.join(dir, 'roster.xlsx'), [['학번', '이름'], ...s.map(x => [studentId(x), x.name]), [studentId(s[0]), '다른이름']])
    let msg = ''
    try { readRoster(file) } catch (e) { msg = e.message }
    expect(msg).toMatch(/겹침/)
    expect(msg).not.toContain('다른이름')
  })
})

describe('collect-split', () => {
  const students = fakeStudents(1, [1, 2, 3], 25)

  it('반별로 나누고 명렬표 이름을 쓰며 앱 가져오기 양식(학년·반·번호·이름·활동명·활동내용)으로 만든다', () => {
    const {byClass, issues} = splitCollect(collectRows(students), students, {'학급자치회의': '03 학급자치회의'})
    expect(issues).toEqual([])
    expect([...byClass.keys()]).toEqual(['1-1', '1-2', '1-3'])
    const c3 = byClass.get('1-3')
    expect(c3).toHaveLength(25)
    expect(c3[0]).toMatchObject({grade: 1, class_num: 3, number: 1, name: students.find(s => s.class_num === 3).name, activity: '03 학급자치회의'})
    expect(c3[0].content.startsWith(COMMON_INTRO)).toBe(true)
  })

  it('이름 다름·명렬표에 없음·빈칸·내용이 다른 중복은 넣지 않고 확인목록에 올린다', () => {
    const rows = collectRows(students)
    rows[1][1] = '틀린이름'                          // 1-1-1 이름 다름
    rows.push(['10430', '없는학생', '학급자치회의', '가교사', '내용'])  // 4반: 명렬표에 없음
    rows.push([studentId(students[1]), students[1].name, '학급자치회의', '가교사', ''])  // 빈칸
    rows.push([studentId(students[2]), students[2].name, '학급자치회의', '가교사', '다른 내용'])  // 중복
    rows.push(['abc', '', '학급자치회의', '', '내용'])  // 학번 못 읽음
    const {byClass, issues} = splitCollect(rows, students)
    const kinds = issues.map(i => i.kind)
    expect(kinds).toContain('이름 다름(넣지 않음)')
    expect(kinds).toContain('명렬표에 없는 학번(넣지 않음)')
    expect(kinds).toContain('내용 빈칸(넣지 않음)')
    expect(kinds.filter(k => k.startsWith('같은 학생'))).toHaveLength(2)
    expect(kinds).toContain('학번을 읽을 수 없음')
    const c1 = byClass.get('1-1').map(c => c.number)
    expect(c1).not.toContain(1)   // 이름 다른 행
    expect(c1).not.toContain(3)   // 중복 행
    expect(c1).toContain(2)       // 빈칸 행은 빠지지만 원래 행은 그대로
  })

  it('결과 파일을 다시 읽으면 앱 가져오기 머리글 그대로다', async () => {
    const dir = mk('split')
    writeRoster(path.join(dir, 'roster.xlsx'), students)
    writeXlsx(path.join(dir, '수합.xlsx'), collectRows(students))
    const {main} = await import('../collect-split/collect-split.mjs')
    await quiet(() => main(['--input', path.join(dir, '수합.xlsx'), '--roster', path.join(dir, 'roster.xlsx'), '--out', path.join(dir, 'out')]))
    const rows = readSheetRows(path.join(dir, 'out', '수합_1-2.xlsx'))
    expect(rows[0]).toEqual(['학년', '반', '번호', '이름', '활동명', '활동내용'])
    expect(rows).toHaveLength(26)
    expect(readSheetRows(path.join(dir, 'out', '수합_확인목록.xlsx'))).toHaveLength(1)
  })
})
