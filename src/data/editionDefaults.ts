/**
 * 고양외고 25기 1학년부 판 — 이미 배포한 반 파일에 기본 목록의 바뀐 부분을 넣는다.
 *
 * 원본 앱의 "기본 유의어 갱신"·"기본 규칙 갱신" 버튼은 기본 목록 전체를 다시 넣어서, 담임이 지운
 * 기본 단어가 되살아나고, 뺀 단어는 지우지 못한다. 그래서 이 판은 바뀐 부분만 적어 두고
 * 파일을 열 때 한 번 넣는다(commands/goyang25.rs). 이미 넣은 파일은 판 번호로 알아본다.
 *
 * 바꿀 때: 아래 목록을 고치고 EDITION_DEFAULTS_VERSION을 올린다. defaultSynonyms.ts·
 * defaultReplaceRules.ts(새 파일용)도 같은 내용으로 고친다.
 */
import {DEFAULT_SYNONYMS, DEFAULT_SYNONYMS_VERSION} from './defaultSynonyms'
import {DEFAULT_REPLACE_RULES, DEFAULT_REPLACE_RULES_VERSION} from './defaultReplaceRules'

export const EDITION_DEFAULTS_VERSION = 1

/** 잘못 걸리는 일이 많아 기본 유의어에서 뺀 말(2026-11-05). 담임이 따로 만든 그룹의 말은 건드리지 않는다. */
export const RETIRED_SYNONYMS = {
  group: '유의어_기본',
  words: ['외국', '메타', '블로', '애플', '이모', '알로', '봉사활동', '스마트폰', 'ATP'],
}

const ADDED_GROUP_NAMES = ['학교공통 형식-05 가운뎃점']

/** 새로 더한 유의어 그룹 */
export const ADDED_SYNONYM_GROUPS = ADDED_GROUP_NAMES.map(name => ({name, words: DEFAULT_SYNONYMS[name]}))

/** 새로 더한 치환 규칙(가운뎃점 → 쉼표+띄어쓰기) */
export const ADDED_REPLACE_RULES = DEFAULT_REPLACE_RULES.filter(r => r.priority === 53)

/** 넣은 뒤 원본 앱의 갱신 버튼이 다시 뜨지 않게 맞출 판 번호 */
export const UPSTREAM_VERSIONS = {
  synonym: String(DEFAULT_SYNONYMS_VERSION),
  replaceRules: String(DEFAULT_REPLACE_RULES_VERSION),
}
