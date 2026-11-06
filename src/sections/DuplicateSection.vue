<script setup>
import {computed, onMounted, ref} from 'vue'
import {AlertTriangle, ChevronDown, ChevronRight, CopyCheck, Loader2} from '@lucide/vue'
import {useAreaStore} from '../stores/area'
import {useSynonymStore} from '../stores/synonymStore'
import {DEFAULT_SIMILARITY_OPTIONS, DEFAULT_WITHIN_THRESHOLD, findSimilarities, findWithinStudent} from '../services/similarity'
import DiffView from '../components/DiffView.vue'

// 중복 확인(고양외고 25기 1학년부 판). 판정은 services/similarity.ts.
// 한 학생 안: 한 학생의 활동 칸끼리(영역이 달라도) 견준다. 학생 간: 같은 활동에서 학생끼리 견준다.
// 기록은 유의어 점검과 같은 조회(get_all_records_for_inspect)로 읽는다 — 영역 배정까지 반영된 목록이다.

const areaStore = useAreaStore()
const synonymStore = useSynonymStore()

const THRESHOLD_MIN = 40
const mode = ref('within')     // 'within'(한 학생 안) | 'between'(학생 간)
const areaId = ref(0)          // 0 = 모든 영역
const unit = ref('activity')   // 'activity' | 'area' (학생 간에서만)
// 유사 기준은 비교 대상마다 따로 둔다(한 학생 안은 말만 바꾼 문장도 잡으려고 낮게).
const thresholds = ref({
  within: Math.round(DEFAULT_WITHIN_THRESHOLD * 100),
  between: Math.round(DEFAULT_SIMILARITY_OPTIONS.threshold * 100),
})
const commonMin = ref(DEFAULT_SIMILARITY_OPTIONS.commonMinStudents)
const includeCommon = ref(false)

const loading = ref(false)
const error = ref('')
const result = ref(null)
const showCommon = ref(false)
const openPairs = ref(new Set())

onMounted(async () => {
  try {
    await areaStore.fetchAreas()
  } catch (e) {
    error.value = '영역 목록을 읽지 못했습니다: ' + String(e)
  }
})

const KIND_LABEL = {exact: '완전 일치', similar: '유사', sentence: '같은 문장'}
const KIND_CLASS = {
  exact: 'text-red bg-red/[0.10] border-red/30',
  similar: 'text-amber bg-amber/[0.10] border-amber/30',
  sentence: 'text-blue-2 bg-blue/[0.10] border-blue/30',
}

const counts = computed(() => {
  const c = {exact: 0, similar: 0, sentence: 0}
  for (const p of result.value?.pairs ?? []) c[p.kind]++
  return c
})

const withinStudentCount = computed(() => new Set((result.value?.pairs ?? []).map(p => p.group)).size)

const validOptions = computed(() => {
  const t = thresholds.value[mode.value]
  if (!(Number.isFinite(t) && t >= THRESHOLD_MIN && t <= 100)) return false
  return mode.value === 'within' || (Number.isInteger(commonMin.value) && commonMin.value >= 2)
})

async function run() {
  if (!validOptions.value) return
  loading.value = true
  error.value = ''
  result.value = null
  openPairs.value = new Set()
  try {
    const ids = areaId.value ? [areaId.value] : areaStore.areas.map(a => a.id)
    await synonymStore.fetchRecords('areas', ids)
    const threshold = thresholds.value[mode.value] / 100
    if (mode.value === 'within') {
      const records = synonymStore.records.map(r => ({
        studentKey: `${r.grade}-${r.class_num}-${r.number}`,
        studentLabel: `${r.number}번 ${r.student_name}`,
        cellKey: `${r.area_name} · ${r.activity_name}`,
        cellLabel: cellName(r),
        content: r.content,
      }))
      result.value = {mode: 'within', pairs: findWithinStudent(records, {threshold}), common: []}
    } else {
      const records = synonymStore.records.map(r => ({
        group: unit.value === 'area' ? r.area_name : cellName(r),
        studentKey: `${r.grade}-${r.class_num}-${r.number}`,
        studentLabel: `${r.class_num}반 ${r.number}번 ${r.student_name}`,
        content: r.content,
      }))
      result.value = {
        mode: 'between',
        ...findSimilarities(records, {threshold, commonMinStudents: commonMin.value, includeCommon: includeCommon.value}),
      }
    }
  } catch (e) {
    error.value = '기록을 읽지 못했습니다: ' + String(e)
  } finally {
    loading.value = false
  }
}

// 칸 이름. 활동 이름이 영역 이름과 같으면(행발 따위) 한 번만 쓴다.
function cellName(r) {
  return r.activity_name === r.area_name ? r.area_name : `${r.area_name} · ${r.activity_name}`
}

function togglePair(i) {
  const s = new Set(openPairs.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  openPairs.value = s
}

/** 글에서 겹친 문장을 표시하기 위해 조각으로 나눈다. */
function segments(text, matched) {
  if (!matched.length) return [{text, hit: false}]
  const out = []
  let rest = text
  while (rest) {
    let best = null
    for (const m of matched) {
      const i = rest.indexOf(m)
      if (i >= 0 && (!best || i < best.i)) best = {i, m}
    }
    if (!best) { out.push({text: rest, hit: false}); break }
    if (best.i > 0) out.push({text: rest.slice(0, best.i), hit: false})
    out.push({text: best.m, hit: true})
    rest = rest.slice(best.i + best.m.length)
  }
  return out
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden box-border">
    <div class="flex items-center justify-between px-10 pt-9 pb-6 border-b border-line shrink-0">
      <div class="flex flex-col">
        <h2 class="text-[22px] font-bold text-ink m-0 mb-1.5">중복 확인(Duplicate)</h2>
        <p class="text-base text-ink-3 m-0">
          <b class="text-ink-2">한 학생 안</b>: 한 학생의 자율·자치, 진로, 행발 등 칸끼리 같은 글이나 말만 바꾼 문장을 찾습니다.<br>
          <b class="text-ink-2">학생 간</b>: 같은 활동에서 학생끼리 같거나 어미·조사만 바꾼 문장을 찾습니다.
        </p>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-10 py-8">
      <!-- 조건 -->
      <div class="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 items-center mb-6 text-base text-ink-2">
        <label class="text-ink-4">비교 대상</label>
        <div class="flex gap-4">
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" value="within" v-model="mode" class="accent-blue">한 학생 안(칸끼리)</label>
          <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" value="between" v-model="mode" class="accent-blue">학생 간</label>
        </div>

        <label class="text-ink-4">영역</label>
        <select v-model="areaId" class="py-[7px] px-2.5 bg-surface border border-line rounded-lg text-ink text-base outline-none w-fit">
          <option :value="0">모든 영역</option>
          <option v-for="a in areaStore.areas" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>

        <template v-if="mode === 'between'">
          <label class="text-ink-4">비교 단위</label>
          <div class="flex gap-4">
            <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" value="activity" v-model="unit" class="accent-blue">활동별</label>
            <label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" value="area" v-model="unit" class="accent-blue">영역별(활동 합쳐서)</label>
          </div>
        </template>

        <label class="text-ink-4">유사 기준</label>
        <div class="flex items-center gap-2">
          <input type="number" :min="THRESHOLD_MIN" max="100" v-model.number="thresholds[mode]" class="w-20 py-[5px] px-2 bg-surface border border-line rounded-lg text-ink text-base">
          <span class="text-ink-5">% 이상 (높일수록 거의 같은 것만{{ mode === 'within' ? ' — 말만 바꿔 다시 쓴 문장까지 잡으려고 낮게 둡니다' : '' }})</span>
        </div>

        <template v-if="mode === 'between'">
          <label class="text-ink-4">공통 문구</label>
          <div class="flex items-center gap-2 flex-wrap">
            <input type="number" min="2" v-model.number="commonMin" class="w-20 py-[5px] px-2 bg-surface border border-line rounded-lg text-ink text-base">
            <span class="text-ink-5">명 이상에게 같은 문장</span>
            <label class="flex items-center gap-1.5 cursor-pointer ml-3"><input type="checkbox" v-model="includeCommon" class="accent-blue">공통 문구도 경고에 넣기</label>
          </div>
        </template>
      </div>

      <button
          class="inline-flex items-center gap-2 py-2.5 px-6 bg-blue/[0.15] border border-blue/40 rounded-lg text-blue-2 text-base font-semibold cursor-pointer transition-colors enabled:hover:bg-blue/25 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="loading || !validOptions"
          @click="run"
      >
        <Loader2 v-if="loading" :size="15" class="animate-spin"/>
        <CopyCheck v-else :size="15"/>
        {{ loading ? '확인 중...' : '중복 확인' }}
      </button>
      <p v-if="!validOptions" class="text-base text-red mt-2">유사 기준은 {{ THRESHOLD_MIN }}~100{{ mode === 'between' ? ', 공통 문구는 2명 이상' : '' }}으로 정해 주세요.</p>
      <p v-if="error" class="text-base text-red mt-3">{{ error }}</p>

      <template v-if="result">
        <div class="flex gap-2.5 my-6 flex-wrap">
          <!-- badge: 결과 통계 -->
          <span class="text-sm font-semibold py-1 px-2.5 rounded-[6px] border" :class="KIND_CLASS.exact">완전 일치 {{ counts.exact }}쌍</span>
          <span class="text-sm font-semibold py-1 px-2.5 rounded-[6px] border" :class="KIND_CLASS.similar">유사 {{ counts.similar }}쌍</span>
          <span class="text-sm font-semibold py-1 px-2.5 rounded-[6px] border" :class="KIND_CLASS.sentence">같은 문장 {{ counts.sentence }}쌍</span>
          <span v-if="result.mode === 'between'" class="text-sm font-semibold py-1 px-2.5 rounded-[6px] border text-ink-5 bg-line/20 border-line">공통 문구 {{ result.common.length }}개</span>
          <span v-else class="text-sm font-semibold py-1 px-2.5 rounded-[6px] border text-ink-5 bg-line/20 border-line">학생 {{ withinStudentCount }}명</span>
        </div>

        <!-- 공통 문구 -->
        <div v-if="result.common.length" class="border border-line rounded-[10px] mb-6 overflow-hidden">
          <button class="w-full flex items-center gap-2 py-2.5 px-4 bg-surface border-none text-base text-ink-2 cursor-pointer text-left" @click="showCommon = !showCommon">
            <component :is="showCommon ? ChevronDown : ChevronRight" :size="16"/>
            공통 문구 {{ result.common.length }}개 — {{ includeCommon ? '경고에 넣었습니다' : '경고에서 뺐습니다' }}
          </button>
          <ul v-if="showCommon" class="m-0 py-3 pl-10 pr-4 flex flex-col gap-1.5 text-base text-ink-3">
            <li v-for="(c, i) in result.common" :key="i">
              <span class="text-ink-5">[{{ c.group }} · {{ c.studentCount }}명]</span> {{ c.sentence }}
            </li>
          </ul>
        </div>

        <div v-if="result.pairs.length === 0"
             class="flex flex-col items-center gap-2 py-14 text-center border border-dashed border-green/20 bg-green/[0.03] rounded-lg">
          <CopyCheck :size="40" class="text-green/40"/>
          <p class="text-lg font-semibold text-green m-0">{{ result.mode === 'within' ? '칸끼리 겹치는 글이 없습니다' : '겹치는 학생이 없습니다' }}</p>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div v-for="(p, i) in result.pairs" :key="i" class="border border-line rounded-[10px] overflow-hidden">
            <button class="w-full flex items-center gap-2.5 py-2.5 px-4 bg-surface border-none text-base text-ink-2 cursor-pointer text-left" @click="togglePair(i)">
              <component :is="openPairs.has(i) ? ChevronDown : ChevronRight" :size="16" class="shrink-0"/>
              <!-- badge: 쌍 종류 -->
              <span class="text-sm font-semibold py-0.5 px-2 rounded-[6px] border whitespace-nowrap" :class="KIND_CLASS[p.kind]">{{ KIND_LABEL[p.kind] }}</span>
              <template v-if="result.mode === 'within'">
                <span class="font-bold text-ink whitespace-nowrap">{{ p.group }}</span>
                <span class="font-semibold">{{ p.a.label }}</span><span class="text-ink-5">↔</span><span class="font-semibold">{{ p.b.label }}</span>
                <span class="text-ink-5 ml-auto whitespace-nowrap">{{ p.kind === 'sentence' ? `겹친 문장 ${p.matches.length}개` : `유사 ${Math.round(p.score * 100)}%` }}</span>
              </template>
              <template v-else>
                <span class="font-semibold">{{ p.a.label }}</span><span class="text-ink-5">↔</span><span class="font-semibold">{{ p.b.label }}</span>
                <span class="text-ink-5 ml-auto whitespace-nowrap">{{ p.group }} · 유사 {{ Math.round(p.score * 100) }}%</span>
              </template>
            </button>
            <div v-if="openPairs.has(i)" class="border-t border-line">
              <div class="grid grid-cols-2">
                <div class="py-3 px-4 text-base text-ink-2 leading-relaxed whitespace-pre-wrap break-all">
                  <template v-for="(s, k) in segments(p.a.text, p.matches.map(m => m.a))" :key="k">
                    <mark v-if="s.hit" class="bg-amber/25 text-ink rounded-sm">{{ s.text }}</mark><template v-else>{{ s.text }}</template>
                  </template>
                </div>
                <div class="py-3 px-4 border-l border-line text-base text-ink-2 leading-relaxed whitespace-pre-wrap break-all">
                  <template v-for="(s, k) in segments(p.b.text, p.matches.map(m => m.b))" :key="k">
                    <mark v-if="s.hit" class="bg-amber/25 text-ink rounded-sm">{{ s.text }}</mark><template v-else>{{ s.text }}</template>
                  </template>
                </div>
              </div>
              <!-- 겹친 문장마다 다른 부분만 표시(빨강: 왼쪽에만, 초록: 오른쪽에만) -->
              <div v-if="p.matches.some(m => m.a !== m.b)" class="border-t border-line py-3 px-4 flex flex-col gap-2 bg-surface/60">
                <p class="text-base text-ink-5 m-0">겹친 문장에서 다른 부분 (빨강: {{ p.a.label }}에만, 초록: {{ p.b.label }}에만)</p>
                <div v-for="(m, k) in p.matches.filter(m => m.a !== m.b)" :key="k" class="text-base">
                  <DiffView :before="m.a" :after="m.b"/>
                  <span class="text-ink-5 ml-2">({{ Math.round(m.score * 100) }}%)</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p class="flex items-start gap-2 text-base text-ink-5 mt-6">
          <AlertTriangle :size="16" class="shrink-0 mt-1"/>
          <template v-if="result.mode === 'within'">찾은 쌍은 확인할 후보입니다. 같은 일화를 영역마다 다른 관점으로 일부러 쓰는 경우도 있으니 직접 읽고 판단해 주세요. 고칠 글은 학생별 보기에서 고치시면 됩니다.</template>
          <template v-else>찾은 쌍은 확인할 후보입니다. 같은 행사에 함께 참여해 비슷하게 쓸 수밖에 없는 경우도 있으니 직접 읽고 판단해 주세요.</template>
        </p>
      </template>
    </div>
  </div>
</template>
