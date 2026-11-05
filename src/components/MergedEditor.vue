<script setup>
import {nextTick, ref, watch} from 'vue'

// 학생별 보기의 통합본(고양외고 25기 1학년부 판).
// 한 영역의 칸들을 한 덩어리 글처럼 이어 보여 주되, 칸마다 따로 고칠 수 있는 조각으로 둔다.
// 조각 하나가 기록 칸 하나다 — 조각을 고치면 그 칸이 고쳐진다(저장은 부모가 한다).
// 조각마다 편집 영역이 따로라, 선택·잘라내기가 칸 경계를 넘지 못한다. 그래서 두 칸의 글이 섞이지 않는다.

const props = defineProps({
  // [{id, mark, name, content}] — 글이 있는 칸만, 영역 안 순서대로
  segments: {type: Array, required: true},
  separator: {type: String, default: ' '},
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
}, {deep: true})

function onInput(id, e) {
  // plaintext-only라 붙여 넣은 서식은 들어오지 않는다. innerText는 줄바꿈을 \n으로 준다.
  emit('input', id, e.target.innerText.replace(/\n$/, ''))
}

function onBlur(id, e) {
  if (focusedId.value === id) focusedId.value = null
  // 브라우저가 남긴 <br> 따위를 걷어 내고 저장된 글과 같은 모양으로 맞춘다.
  const text = contentOf(id)
  if (e.target.textContent !== text) e.target.textContent = text
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
