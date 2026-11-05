/**
 * 고양외고 25기 1학년부 판 — 유의어 점검에 늘 붙어 있는 자동 점검 묶음.
 *
 * 파일(DB)에 넣는 유의어 그룹은 낱말을 그대로 찾는다. 여기 묶음은 정규식 꼴로 찾으므로
 * 파일에 넣지 않고 앱에 둔다. 판을 바꾸면 모든 반 파일에 바로 적용된다.
 * id는 DB 그룹과 겹치지 않게 음수로 둔다.
 */
export interface PatternGroup {
  id: number
  name: string
  description: string
  patterns: string[]
}

export const BUILTIN_INSPECT_GROUPS: PatternGroup[] = [
  {
    id: -1,
    name: '자동: 영어 낱말 모두',
    description: '글 속의 영어(알파벳) 낱말을 모두 찾습니다. 대소문자는 가리지 않습니다.',
    patterns: ["[A-Za-z]+(?:[-.'&+][A-Za-z0-9]+)*\\+*"],
  },
  {
    id: -2,
    name: '자동: 대학 이름 꼴 (학교공통 금지-12)',
    description: '"○○대학교", "○○대학", "○○대 진학·입학·합격" 꼴을 찾습니다.',
    // 출처: Sangibu-agent sangibu/references/금지어-스캔목록.json 금지-12 '패턴'
    patterns: [
      '[가-힣]+대학교',
      '[가-힣]{1,8}대학(?![교])',
      '[가-힣]{1,6}대\\s?(?:진학|입학|합격|지원|희망|교수|연구소|학과)',
    ],
  },
]
