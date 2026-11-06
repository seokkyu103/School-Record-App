/**
 * 화면의 글자를 칠한다(CSS Custom Highlight API, 고양외고 25기 1학년부 판).
 *
 * DOM을 바꾸지 않고 범위(Range)만 칠하므로, 고치는 중인 글(contenteditable)에 써도 커서가 튀지 않는다.
 * 같은 이름의 칠하기를 여러 곳(영역마다 통합본)이 나눠 쓰므로 주인별로 범위를 모아 한 번에 등록한다.
 * 지원하지 않는 환경이면 아무것도 하지 않는다.
 */

const owners = new Map<string, Map<object, Range[]>>()

function supported(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
}

/** owner가 칠할 범위를 바꾼다. 빈 배열이면 owner의 칠하기를 지운다. */
export function setHighlight(name: string, owner: object, ranges: Range[]): void {
  if (!supported()) return
  if (!owners.has(name)) owners.set(name, new Map())
  const mine = owners.get(name)!
  if (ranges.length) mine.set(owner, ranges)
  else mine.delete(owner)
  const all = [...mine.values()].flat()
  if (all.length) CSS.highlights.set(name, new Highlight(...all))
  else CSS.highlights.delete(name)
}

/** root 아래 글자에서 needles가 나오는 곳마다 범위를 만든다. 글자 노드가 나뉘어 있어도 이어서 찾는다. */
export function rangesOf(root: Node, needles: string[]): Range[] {
  if (!needles.length) return []
  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  if (!nodes.length) return []

  const starts: number[] = []
  let text = ''
  for (const n of nodes) {
    starts.push(text.length)
    text += n.data
  }
  const at = (offset: number, end: boolean): [Text, number] => {
    // end면 노드 경계에서 앞 노드의 끝을 고른다.
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (end ? starts[i] < offset : starts[i] <= offset) return [nodes[i], offset - starts[i]]
    }
    return [nodes[0], 0]
  }

  const out: Range[] = []
  for (const needle of needles) {
    if (!needle) continue
    let from = 0
    for (let i = text.indexOf(needle, from); i >= 0; i = text.indexOf(needle, from)) {
      const r = document.createRange()
      r.setStart(...at(i, false))
      r.setEnd(...at(i + needle.length, true))
      out.push(r)
      from = i + needle.length
    }
  }
  return out
}
