import {describe, expect, it} from 'vitest'
import {dice, findSimilarities, normalizeForCompare, splitSentences} from './similarity'

const INTRO = '학급 자치 회의에서 학급 규칙을 정하는 토의에 참여함.'

function rec(n: number, content: string, group = '학급자치회의') {
  return {group, studentKey: `1-3-${n}`, studentLabel: `${n}번`, content}
}

describe('기본 함수', () => {
  it('정규화는 공백과 문장부호만 지운다', () => {
    expect(normalizeForCompare("'논증의 탄생'을 읽고, 발표함.")).toBe('논증의탄생을읽고발표함')
  })

  it('문장 나누기', () => {
    expect(splitSentences('첫 문장임. 둘째 문장임.\n셋째 문장임.')).toEqual(['첫 문장임.', '둘째 문장임.', '셋째 문장임.'])
  })

  it('어미·조사만 바꾼 문장은 높고, 다른 내용은 낮다', () => {
    const a = normalizeForCompare('환경 문제의 원인을 분석하고 해결 방안을 제시하는 발표를 함.')
    const b = normalizeForCompare('환경 문제의 원인을 분석하며 해결 방안을 제시하는 발표를 하였음.')
    const c = normalizeForCompare('친구들과 협력하여 학급 게시판을 꾸미고 역할을 나눔.')
    expect(dice(a, b)).toBeGreaterThan(0.75)
    expect(dice(a, c)).toBeLessThan(0.3)
  })
})

describe('findSimilarities', () => {
  it('완전히 같은 글은 exact 쌍', () => {
    const text = '모둠 토의에서 의견을 조율하며 결론을 정리해 발표함.'
    const {pairs} = findSimilarities([rec(1, text), rec(2, text), rec(3, '다른 학생은 전혀 다른 활동을 기록한 문장임.')])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({kind: 'exact', a: {key: '1-3-1'}, b: {key: '1-3-2'}})
  })

  it('어미·조사만 바꾼 글은 similar 쌍이고 겹친 문장을 돌려준다', () => {
    const {pairs} = findSimilarities([
      rec(1, '환경 문제의 원인을 분석하고 해결 방안을 제시하는 발표를 함.'),
      rec(2, '환경 문제의 원인을 분석하며 해결 방안을 제시하는 발표를 하였음.'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].kind).toBe('similar')
    expect(pairs[0].matches).toHaveLength(1)
  })

  it('여러 학생에게 같은 소개 문장은 공통 문구로 빼고, 나머지가 다르면 경고하지 않는다', () => {
    const own = [
      '회의 기록을 맡아 안건별 찬반 의견을 표로 정리함.',
      '청소 구역 배정 문제를 제기하고 순번제 도입을 제안함.',
      '소수 의견도 들어야 한다며 무기명 투표 방식을 설명함.',
      '규칙 위반 시 벌점 대신 봉사로 바꾸자는 대안을 냄.',
      '휴대전화 사용 시간에 대한 설문 결과를 그래프로 발표함.',
      '결정된 규칙을 게시판에 정리해 붙이고 실천을 독려함.',
    ]
    const records = own.map((text, i) => rec(i + 1, `${INTRO} ${text}`))
    const {pairs, common} = findSimilarities(records)
    expect(common).toEqual([{group: '학급자치회의', sentence: INTRO, studentCount: 6}])
    expect(pairs).toEqual([])
  })

  it('공통 문구를 포함하도록 켜면 소개 문장 때문에 쌍이 잡힌다', () => {
    const records = [1, 2, 3, 4, 5].map(n => rec(n, `${INTRO} 짧은 글 ${n}.`))
    const {pairs} = findSimilarities(records, {includeCommon: true})
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('글 전체는 달라도 한 문장을 그대로 옮겼으면 sentence 쌍', () => {
    const copied = '토론에서 반대 측 논거의 허점을 짚어 공동체 규칙의 의미를 다시 생각하게 함.'
    const {pairs} = findSimilarities([
      rec(1, `봉사 활동에 성실히 참여하여 지역 어르신들과 대화를 나눔. ${copied}`),
      rec(2, `학급 도서 정리를 맡아 분류 기준을 새로 만들고 친구들에게 안내함. ${copied}`),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].kind).toBe('sentence')
    expect(pairs[0].matches[0].a).toBe(copied)
  })

  it('다른 활동끼리는 견주지 않는다', () => {
    const text = '모둠 토의에서 의견을 조율하며 결론을 정리해 발표함.'
    expect(findSimilarities([rec(1, text, '활동A'), rec(2, text, '활동B')]).pairs).toEqual([])
  })

  it('같은 학생의 여러 행(영역 단위)은 이어 붙여 한 글로 본다', () => {
    const {pairs} = findSimilarities([
      rec(1, '첫째 활동에서 자료를 조사해 정리함.', '영역'),
      rec(1, '둘째 활동에서 결과를 발표하고 질문에 답함.', '영역'),
      rec(2, '첫째 활동에서 자료를 조사해 정리함. 둘째 활동에서 결과를 발표하고 질문에 답함.', '영역'),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].kind).toBe('exact')
  })
})
