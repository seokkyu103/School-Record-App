/**
 * 학생 간 중복 확인.
 *
 * 같은 활동(또는 같은 영역)의 기록을 학생끼리 견주어, 완전히 같은 글·어미와 조사만 바꾼 글·
 * 그대로 옮긴 문장을 쌍으로 찾는다. 수합파일의 활동 소개처럼 여러 학생에게 같은 문장은
 * "공통 문구"로 따로 묶어 기본으로 경고에서 뺀다.
 *
 * 유사도는 공백·문장부호를 뺀 글자 두 개씩의 겹침(Dice 계수)이다. 어미·조사만 바꾸면 대부분의
 * 두 글자 묶음이 그대로 남아 높게 나오고, 같은 주제를 따로 쓴 글은 낮게 나온다.
 */

export interface SimilarityRecord {
  /** 비교 묶음 이름(활동명, 또는 영역 단위면 영역명) */
  group: string
  /** 학생을 가르는 값(학년-반-번호) */
  studentKey: string
  /** 화면에 보일 학생 표시 */
  studentLabel: string
  content: string
}

export interface SimilarityOptions {
  /** 이 비율(0~1) 이상이면 유사로 본다 */
  threshold: number
  /** 같은 문장이 이 학생 수 이상에게 있으면 공통 문구로 본다 */
  commonMinStudents: number
  /** 공통 문구도 경고에 넣는다(끄면 공통 문구를 빼고 견준다) */
  includeCommon: boolean
  /** 이보다 짧은 글·문장은 견주지 않는다(정규화한 글자 수) */
  minLength: number
}

export const DEFAULT_SIMILARITY_OPTIONS: SimilarityOptions = {
  threshold: 0.75,
  commonMinStudents: 5,
  includeCommon: false,
  minLength: 15,
}

export type PairKind = 'exact' | 'similar' | 'sentence'

export interface SentenceMatch {
  a: string
  b: string
  score: number
}

export interface SimilarPair {
  group: string
  a: {key: string; label: string; text: string}
  b: {key: string; label: string; text: string}
  kind: PairKind
  /** 글 전체의 유사도(공통 문구를 뺀 나머지 기준) */
  score: number
  /** 겹친 문장들(같거나 유사한 문장 쌍) */
  matches: SentenceMatch[]
}

export interface CommonPhrase {
  group: string
  sentence: string
  studentCount: number
}

export interface SimilarityResult {
  pairs: SimilarPair[]
  common: CommonPhrase[]
}

/** 비교용 정규화: 공백과 문장부호를 지운다. */
export function normalizeForCompare(s: string): string {
  return s.replace(/[\s.,·・‧'"‘’“”!?()\[\]…~\-:;]/g, '')
}

/** 문장으로 나눈다. 마침표·물음표·느낌표 뒤의 공백, 줄바꿈에서 자른다. */
export function splitSentences(text: string): string[] {
  return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.trim())
      .filter(Boolean)
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** 두 글(정규화된)의 Dice 계수. 0~1. */
export function dice(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0
  if (a.length < 2 || b.length < 2) return 0
  const A = bigrams(a)
  const B = bigrams(b)
  let inter = 0
  for (const [g, c] of A) {
    const d = B.get(g)
    if (d) inter += Math.min(c, d)
  }
  return (2 * inter) / (a.length - 1 + b.length - 1)
}

interface Prepared {
  key: string
  label: string
  sentences: {text: string; norm: string}[]
}

export function findSimilarities(records: SimilarityRecord[], options: Partial<SimilarityOptions> = {}): SimilarityResult {
  const opt = {...DEFAULT_SIMILARITY_OPTIONS, ...options}
  const groups = new Map<string, SimilarityRecord[]>()
  for (const r of records) {
    if (!r.content.trim()) continue
    if (!groups.has(r.group)) groups.set(r.group, [])
    groups.get(r.group)!.push(r)
  }

  const pairs: SimilarPair[] = []
  const common: CommonPhrase[] = []

  for (const [group, list] of groups) {
    // 한 학생의 글이 여러 행이면(영역 단위) 이어 붙인다.
    const byStudent = new Map<string, {label: string; texts: string[]}>()
    for (const r of list) {
      if (!byStudent.has(r.studentKey)) byStudent.set(r.studentKey, {label: r.studentLabel, texts: []})
      byStudent.get(r.studentKey)!.texts.push(r.content)
    }
    const students: Prepared[] = [...byStudent.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      sentences: splitSentences(v.texts.join('\n')).map(text => ({text, norm: normalizeForCompare(text)})),
    }))

    // 공통 문구: 같은 문장(정규화 기준)을 가진 학생 수
    const holders = new Map<string, {text: string; keys: Set<string>}>()
    for (const s of students) {
      for (const sen of s.sentences) {
        if (sen.norm.length < opt.minLength) continue
        if (!holders.has(sen.norm)) holders.set(sen.norm, {text: sen.text, keys: new Set()})
        holders.get(sen.norm)!.keys.add(s.key)
      }
    }
    const commonNorms = new Set<string>()
    for (const [norm, h] of holders) {
      if (h.keys.size >= opt.commonMinStudents) {
        commonNorms.add(norm)
        common.push({group, sentence: h.text, studentCount: h.keys.size})
      }
    }
    const excluded = opt.includeCommon ? new Set<string>() : commonNorms

    const rest = students.map(s => {
      const kept = s.sentences.filter(sen => !excluded.has(sen.norm))
      return {...s, kept, text: kept.map(k => k.text).join(' '), norm: kept.map(k => k.norm).join('')}
    })

    for (let i = 0; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const A = rest[i]
        const B = rest[j]
        if (A.norm.length < opt.minLength || B.norm.length < opt.minLength) continue

        const score = dice(A.norm, B.norm)
        const matches: SentenceMatch[] = []
        for (const sa of A.kept) {
          if (sa.norm.length < opt.minLength) continue
          let best: SentenceMatch | null = null
          for (const sb of B.kept) {
            if (sb.norm.length < opt.minLength) continue
            const s = dice(sa.norm, sb.norm)
            if (s >= opt.threshold && (!best || s > best.score)) best = {a: sa.text, b: sb.text, score: s}
          }
          if (best) matches.push(best)
        }

        let kind: PairKind | null = null
        if (A.norm === B.norm) kind = 'exact'
        else if (score >= opt.threshold) kind = 'similar'
        else if (matches.length > 0) kind = 'sentence'
        if (!kind) continue

        pairs.push({
          group,
          a: {key: A.key, label: A.label, text: A.text},
          b: {key: B.key, label: B.label, text: B.text},
          kind,
          score,
          matches,
        })
      }
    }
  }

  const order: Record<PairKind, number> = {exact: 0, similar: 1, sentence: 2}
  pairs.sort((x, y) => order[x.kind] - order[y.kind] || y.score - x.score)
  common.sort((x, y) => y.studentCount - x.studentCount)
  return {pairs, common}
}
