<script setup>
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {rangesOf, setHighlight} from '../services/textHighlight'

// 학생별 보기의 통합본(고양외고 25기 1학년부 판).
// 한 영역의 칸들을 한 덩어리 글처럼 이어 보여 주되, 칸마다 따로 고칠 수 있는 조각으로 둔다.
// 조각 하나가 기록 칸 하나다 — 조각을 고치면 그 칸이 고쳐진다(저장은 부모가 한다).
// 조각마다 편집 영역이 따로라, 선택·잘라내기가 칸 경계를 넘지 못한다. 그래서 두 칸의 글이 섞이지 않는다.

const props = defineProps({
  // [{id, mark, name, content}] — 글이 있는 칸만, 영역 안 순서대로
  segments: {type: Array, required: true},
  separator: {type: String, default: ' '},
  // {칸 id: [다른 칸과 중복되는 문장]} — 노란 바탕과 밑줄로 표시한다(DOM은 바꾸지 않는다).
  highlights: {type: Object, default: () => ({})},
})
const emit = defineEmits(['input'])

// 고치는 중인 조각은 글을 다 지워도 사라지지 않게 둔다(부모가 이 id를 segments에 남긴다).
const focusedId = defineModel('focusedId', {default: null})

const els = new Map()

function setEl(id, el) {
  if (el) {
    els.set(id, el)
    // 처음 붙을 때만 글을 넣는다. 고치는 동안 Vue가 글을 다시 넣으면 커서가 맨 앞으로 튄다.
    if (el.dataset.ready !== '1') {
      el.textContent = contentOf(id)
      el.dataset.ready = '1'
    }
  } else {
    els.delete(id)
  }
}

function contentOf(id) {
  return props.segments.find(s => s.id === id)?.content ?? ''
}

// 아래 칸(textarea)에서 고친 내용은 여기에도 반영한다. 고치는 중인 조각은 건드리지 않는다.
watch(() => props.segments.map(s => [s.id, s.content]), async () => {
  await nextTick()
  for (const s of props.segments) {
    const el = els.get(s.id)
    if (el && s.id !== focusedId.value && el.textContent !== s.content) el.textContent = s.content
  }
  paintOverlaps()
}, {deep: true})

// 중복 문장 표시. 글을 다시 넣으면 글자 노드가 바뀌므로 그때마다 범위를 새로 만든다.
const owner = {}

function paintOverlaps() {
  const ranges = []
  for (const s of props.segments) {
    const el = els.get(s.id)
    const needles = props.highlights[s.id]
    if (el && needles?.length) ranges.push(...rangesOf(el, needles))
  }
  setHighlight('sv-dup', owner, ranges)
}

watch(() => props.highlights, async () => {
  await nextTick()
  paintOverlaps()
}, {deep: true})
onMounted(() => nextTick(paintOverlaps))
onBeforeUnmount(() => setHighlight('sv-dup', owner, []))

function onInput(id, e) {
  // plaintext-only라 붙여 넣은 서식은 들어오지 않는다. innerText는 줄바꿈을 \n으로 준다.
  emit('input', id, e.target.innerText.replace(/\n$/, ''))
}

function onBlur(id, e) {
  if (focusedId.value === id) focusedId.value = null
  // 브라우저가 남긴 <br> 따위를 걷어 내고 저장된 글과 같은 모양으로 맞춘다.
  const text = contentOf(id)
  if (e.target.textContent !== text) {
    e.target.textContent = text
    paintOverlaps()
  }
}

const hoverId = ref(null)
</script>

<template>
  <p class="merged m-0 text-base text-ink leading-relaxed whitespace-pre-wrap break-all">
    <template v-for="(seg, i) in segments" :key="seg.id">
      <span v-if="i > 0" class="select-none">{{ separator }}</span>
      <span class="mark select-none" :title="seg.name">{{ seg.mark }}</span><span
          :ref="el => setEl(seg.id, el)"
          class="seg"
          :class="[i % 2 === 0 ? 'seg-a' : 'seg-b', hoverId === seg.id && 'seg-hover']"
          contenteditable="plaintext-only"
          spellcheck="false"
          :title="seg.name"
          @focus="focusedId = seg.id"
          @blur="onBlur(seg.id, $event)"
          @input="onInput(seg.id, $event)"
          @mouseenter="hoverId = seg.id"
          @mouseleave="hoverId = null"
      ></span>
    </template>
  </p>
</template>

<style scoped>
/* --area: 영역 색(부모가 준다). 이웃한 칸은 진하기를 달리해 경계가 보이게 한다. */
.seg {
  border-radius: 4px;
  padding: 1px 2px;
  outline: none;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  border-bottom: 2px solid color-mix(in srgb, var(--area) 45%, transparent);
  transition: background-color 0.15s;
}
.seg-a { background: color-mix(in srgb, var(--area) 16%, transparent); }
.seg-b { background: color-mix(in srgb, var(--area) 6%, transparent); }
.seg-hover { background: color-mix(in srgb, var(--area) 24%, transparent); }
.seg:focus {
  background: color-mix(in srgb, var(--area) 26%, transparent);
  border-bottom-color: var(--area);
}
.mark {
  color: var(--area);
  font-weight: 700;
  margin-right: 2px;
}
</style>

<style>
/* 다른 칸과 중복되는 문장(학생별 보기). ::highlight는 범위 칠하기라 scoped로 둘 수 없다. */
::highlight(sv-dup) {
  background-color: color-mix(in srgb, var(--c-amber) 30%, transparent);
  text-decoration: underline solid var(--c-amber);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 3px;
}
</style>
