import type {PatternGroup} from '../data/builtinInspectGroups'

interface SynonymWordItem {
  id: number
  group_id: number
  word: string
}

interface SynonymGroupFull {
  id: number
  name: string
  created_at: string
  items: SynonymWordItem[]
}

interface InspectRecord {
  id: number
  activity_name: string
  student_name: string
  area_name: string
  grade: number
  class_num: number
  number: number
  content: string
}

export interface InspectResult {
  record: InspectRecord
  /** 글에 실제로 나온 모양 그대로(대소문자 포함), 한 번씩 */
  detectedWords: string[]
  /** 찾은 말을 뺀 글. 결과 화면이 이 글과 원문을 비교해 찾은 자리를 표시한다. */
  before: string
}

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const LATIN = /[A-Za-z]/

/**
 * 낱말 하나의 정규식. 영어로 시작하거나 끝나면 그쪽에 영어 글자가 붙어 있지 않을 때만 찾는다
 * — 대소문자를 가리지 않으면 'UN'이 'under' 안에서, 'Meta'가 'metaverse' 안에서 잡히기 때문이다.
 * 한글 쪽은 지금처럼 낱말 안에서도 찾는다('TOEIC을', '챗GPT로').
 */
function wordPattern(word: string): string {
  const head = LATIN.test(word[0]) ? '(?<![A-Za-z])' : ''
  const tail = LATIN.test(word[word.length - 1]) ? '(?![A-Za-z])' : ''
  return head + escapeRegex(word) + tail
}

/**
 * 선택한 그룹의 낱말(대소문자 구분 없음)과 자동 점검 묶음의 정규식으로 기록을 찾는다.
 * 긴 낱말을 먼저 둔다 — 'Google Classroom'이 'Google'보다 먼저 맞아야 통째로 잡힌다.
 */
export function performInspection(
  selectedGroupIds: number[],
  groups: SynonymGroupFull[],
  records: InspectRecord[],
  patternGroups: PatternGroup[] = [],
): InspectResult[] {
  const wordSet = new Set<string>()
  for (const group of groups) {
    if (selectedGroupIds.includes(group.id)) {
      for (const item of group.items) {
        const w = item.word.trim()
        if (w) wordSet.add(w)
      }
    }
  }
  const patterns = patternGroups
      .filter(g => selectedGroupIds.includes(g.id))
      .flatMap(g => g.patterns)

  if (wordSet.size === 0 && patterns.length === 0) return []

  const parts = [
    ...Array.from(wordSet).sort((a, b) => b.length - a.length).map(wordPattern),
    ...patterns.map(p => `(?:${p})`),
  ]
  const regex = new RegExp(parts.join('|'), 'gi')

  return records.flatMap((record) => {
    const matches = record.content.match(regex)
    if (!matches) return []
    return [{
      record,
      detectedWords: [...new Set(matches)],
      before: record.content.replace(regex, ''),
    }]
  })
}
