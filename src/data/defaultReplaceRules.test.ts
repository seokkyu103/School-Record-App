import {describe, it, expect} from 'vitest'
import {DEFAULT_REPLACE_RULES} from './defaultReplaceRules'

// 앱은 우선순위 순서대로 규칙을 적용한다(engine.rs). 같은 순서로 돌려 결과를 본다.
function applyAll(text: string): string {
  return [...DEFAULT_REPLACE_RULES]
      .sort((a, b) => a.priority - b.priority)
      .reduce((t, r) => r.isRegex ? t.replace(new RegExp(r.oldText, 'g'), r.newText) : t.replaceAll(r.oldText, r.newText), text)
}

describe('가운뎃점 → 쉼표+띄어쓰기', () => {
  it.each([
    ['독서·토론 활동', '독서, 토론 활동'],
    ['독서 · 토론', '독서, 토론'],
    ['1ㆍ2학년', '1, 2학년'],
    ['A･B∙C⋅D・E', 'A, B, C, D, E'],
    ['기획•발표', '기획, 발표'],
  ])('%s → %s', (input, expected) => {
    expect(applyAll(input)).toBe(expected)
  })
})
