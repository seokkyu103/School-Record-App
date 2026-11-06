/**
 * 중복 확인 — 학생 간, 그리고 한 학생 안(칸끼리).
 *
 * 학생 간: 같은 활동(또는 같은 영역)의 기록을 학생끼리 견주어, 완전히 같은 글·어미와 조사만 바꾼 글·
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

interface Side {
  key: string
  label: string
  /** 견줄 문장(공통 문구를 뺀 나머지) */
  kept: {text: string; norm: string}[]
  text: string
  norm: string
}

function sentencesOf(text: string) {
  return splitSentences(text).map(t => ({text: t, norm: normalizeForCompare(t)}))
}

function sideOf(key: string, label: string, kept: {text: string; norm: string}[]): Side {
  return {key, label, kept, text: kept.map(k => k.text).join(' '), norm: kept.map(k => k.norm).join('')}
}

/** 두 글을 견주어 완전 일치·유사·같은 문장 가운데 하나면 쌍을 돌려준다. */
function comparePair(group: string, A: Side, B: Side, opt: SimilarityOptions): SimilarPair | null {
  if (A.norm.length < opt.minLength || B.norm.length < opt.minLength) return null

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
  if (!kind) return null

  return {
    group,
    a: {key: A.key, label: A.label, text: A.text},
    b: {key: B.key, label: B.label, text: B.text},
    kind,
    score,
    matches,
  }
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
      sentences: sentencesOf(v.texts.join('\n')),
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

    const rest = students.map(s => sideOf(s.key, s.label, s.sentences.filter(sen => !excluded.has(sen.norm))))

    for (let i = 0; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        const pair = comparePair(group, rest[i], rest[j], opt)
        if (pair) pairs.push(pair)
      }
    }
  }

  const order: Record<PairKind, number> = {exact: 0, similar: 1, sentence: 2}
  pairs.sort((x, y) => order[x.kind] - order[y.kind] || y.score - x.score)
  common.sort((x, y) => y.studentCount - x.studentCount)
  return {pairs, common}
}

// ── 한 학생 안 중복 확인 ──────────────────────────────────────────────
// 한 학생의 활동 칸끼리(영역이 달라도) 같은 글·같은 문장을 찾는다. 같은 일을 영역마다 말만 바꿔
// 쓴 문장은 학생 간 비교보다 덜 비슷하게 나오므로(가상 견본에서 0.53~0.71, 다른 일은 0.4 아래)
// 기본 기준을 낮게 둔다.

export const DEFAULT_WITHIN_THRESHOLD = 0.5

export interface CellRecord {
  /** 학생을 가르는 값(학년-반-번호) */
  studentKey: string
  studentLabel: string
  /** 칸을 가르는 값(활동 id 등) */
  cellKey: string
  /** 화면에 보일 칸 이름(영역 · 활동) */
  cellLabel: string
  content: string
}

/**
 * 학생마다 활동 칸끼리 견준다. 돌려주는 쌍의 group은 학생 표시, a·b는 두 칸이다.
 * 학생은 처음 나온 순서대로, 한 학생 안에서는 완전 일치 → 유사 → 같은 문장, 유사도 높은 순.
 */
export function findWithinStudent(records: CellRecord[], options: Partial<SimilarityOptions> = {}): SimilarPair[] {
  const opt = {...DEFAULT_SIMILARITY_OPTIONS, threshold: DEFAULT_WITHIN_THRESHOLD, ...options}
  const byStudent = new Map<string, {label: string; cells: Map<string, {label: string; texts: string[]}>}>()
  for (const r of records) {
    if (!r.content.trim()) continue
    if (!byStudent.has(r.studentKey)) byStudent.set(r.studentKey, {label: r.studentLabel, cells: new Map()})
    const cells = byStudent.get(r.studentKey)!.cells
    if (!cells.has(r.cellKey)) cells.set(r.cellKey, {label: r.cellLabel, texts: []})
    cells.get(r.cellKey)!.texts.push(r.content)
  }

  const order: Record<PairKind, number> = {exact: 0, similar: 1, sentence: 2}
  const out: SimilarPair[] = []
  for (const {label, cells} of byStudent.values()) {
    const sides = [...cells.entries()].map(([key, c]) => sideOf(key, c.label, sentencesOf(c.texts.join('\n'))))
    const mine: SimilarPair[] = []
    for (let i = 0; i < sides.length; i++) {
      for (let j = i + 1; j < sides.length; j++) {
        const pair = comparePair(label, sides[i], sides[j], opt)
        if (pair) mine.push(pair)
      }
    }
    mine.sort((x, y) => order[x.kind] - order[y.kind] || y.score - x.score)
    out.push(...mine)
  }
  return out
}

export interface CellOverlap {
  /** 이 칸에서 다른 칸과 겹치는 문장(원문 그대로, 글 안의 순서대로) */
  sentences: string[]
  /** 겹치는 상대 칸 */
  others: string[]
}

/**
 * 학생별 보기용: 한 학생의 칸들에서 다른 칸과 겹치는 문장을 칸마다 모은다.
 * 문장 하나가 다른 칸의 어느 문장과든 기준 이상이면 양쪽 모두 넣는다.
 */
export function overlapsByCell(
    cells: {key: string; content: string}[],
    threshold = DEFAULT_WITHIN_THRESHOLD,
    minLength = DEFAULT_SIMILARITY_OPTIONS.minLength,
): Map<string, CellOverlap> {
  const prepared = cells
      .filter(c => c.content.trim())
      .map(c => ({key: c.key, sentences: sentencesOf(c.content).filter(s => s.norm.length >= minLength)}))
  const hit = new Map<string, {sentences: Set<string>; others: Set<string>}>()
  const mark = (key: string, sentence: string, other: string) => {
    if (!hit.has(key)) hit.set(key, {sentences: new Set(), others: new Set()})
    hit.get(key)!.sentences.add(sentence)
    hit.get(key)!.others.add(other)
  }
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const A = prepared[i]
      const B = prepared[j]
      for (const sa of A.sentences) {
        for (const sb of B.sentences) {
          if (dice(sa.norm, sb.norm) >= threshold) {
            mark(A.key, sa.text, B.key)
            mark(B.key, sb.text, A.key)
          }
        }
      }
    }
  }
  const out = new Map<string, CellOverlap>()
  for (const p of prepared) {
    const h = hit.get(p.key)
    if (!h) continue
    out.set(p.key, {
      sentences: p.sentences.map(s => s.text).filter(t => h.sentences.has(t)),
      others: [...h.others],
    })
  }
  return out
}
