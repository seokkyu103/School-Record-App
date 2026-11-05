import {describe, it, expect} from 'vitest'
import {DEFAULT_SYNONYMS} from './defaultSynonyms'
import {ADDED_REPLACE_RULES, ADDED_SYNONYM_GROUPS, RETIRED_SYNONYMS} from './editionDefaults'

describe('이 판의 기본 목록 바뀐 부분', () => {
  it('뺀 말은 새 파일용 기본 목록에도 없다', () => {
    for (const w of RETIRED_SYNONYMS.words) expect(DEFAULT_SYNONYMS[RETIRED_SYNONYMS.group]).not.toContain(w)
  })
  it('더한 그룹은 새 파일용 기본 목록에서 가져온다', () => {
    expect(ADDED_SYNONYM_GROUPS).toEqual([{name: '학교공통 형식-05 가운뎃점', words: ['·', '・', '･', 'ㆍ', '∙', '⋅']}])
  })
  it('더한 치환 규칙은 가운뎃점 규칙 하나다', () => {
    expect(ADDED_REPLACE_RULES).toHaveLength(1)
    expect(ADDED_REPLACE_RULES[0].newText).toBe(', ')
  })
})
