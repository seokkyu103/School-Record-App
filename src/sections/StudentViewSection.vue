<script setup>
import {computed, onMounted, ref, watch} from 'vue'
import {AlertTriangle, Check, ChevronLeft, ChevronRight, Copy, Eye, EyeOff, History, PanelLeftClose, PanelLeftOpen, Plus} from '@lucide/vue'
import {useAreaStore} from '../stores/area'
import {useConfigStore} from '../stores/configStore'
import {useStudentViewStore} from '../stores/studentView'
import {useCellAutosave} from '../composables/useCellAutosave'
import {areaBytes, areasOfStudent, collectStudents, joinedPreview, splitVisible} from '../services/studentView'
import CellHistoryModal from '../components/CellHistoryModal.vue'

// 학생별 보기(고양외고 25기 1학년부 판). 한 학생의 자율·동아리·진로·행발을 한 화면에서 보고 고친다.
// 상담 중에 다른 학생을 가리고(목록 접기) 영역 사이로 글을 잘라 붙이는 작업을 위한 화면이다.
// 저장 규칙은 기록 화면과 같다(composables/useCellAutosave.js).

const areaStore = useAreaStore()
const configStore = useConfigStore()
const viewStore = useStudentViewStore()
const saver = useCellAutosave({snapshotNote: '학생별 보기에서 고치기 전'})

const loading = ref(true)
const loadError = ref('')
const copyError = ref('')
const selectedId = ref(null)
const showList = ref(true)
const showAllCells = ref(false)
// 이 학생에서 펼친 빈 칸(활동 id). 학생을 바꾸면 비운다.
const revealed = ref(new Set())
const copiedAreaId = ref(null)
const historyModal = ref(null)

onMounted(async () => {
  try {
    await areaStore.fetchAreas()
    const grids = await viewStore.fetchAll(areaStore.areas)
    if (!grids) return
    saver.load(grids.flatMap(g => g.records))
    const first = collectStudents(grids)[0]
    selectedId.value = first ? first.id : null
  } catch (e) {
    loadError.value = `기록을 불러오지 못했습니다: ${String(e)}`
  } finally {
    loading.value = false
  }
})

const students = computed(() => collectStudents(viewStore.grids))
const selectedIndex = computed(() => students.value.findIndex(s => s.id === selectedId.value))
const selected = computed(() => students.value[selectedIndex.value] ?? null)
const areas = computed(() => selected.value ? areasOfStudent(viewStore.grids, selected.value.id) : [])

watch(selectedId, () => {
  revealed.value = new Set()
  copyError.value = ''
})

function move(delta) {
  const next = students.value[selectedIndex.value + delta]
  if (next) selectedId.value = next.id
}

function contentOf(activityId) {
  return saver.contentOf(activityId, selected.value.id)
}

function cellsOf(grid) {
  return splitVisible(grid.activities, contentOf, revealed.value, showAllCells.value)
}

function bytesOf(grid) {
  return areaBytes(grid.activities, contentOf)
}

function reveal(activityId) {
  revealed.value = new Set([...revealed.value, activityId])
}

function cellClass(activityId) {
  const state = saver.stateOf(activityId, selected.value.id)
  if (state === 'saving') return 'border-blue/60 bg-blue/[0.06]'
  if (state === 'saved') return 'border-green/60 bg-green/[0.06]'
  if (state === 'error') return 'border-red bg-red/[0.08]'
  return 'border-line'
}

async function copyArea(grid) {
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(joinedPreview(grid.activities, contentOf, configStore.exportCSeparator ?? ' '))
    copiedAreaId.value = grid.area.id
    setTimeout(() => {
      if (copiedAreaId.value === grid.area.id) copiedAreaId.value = null
    }, 1000)
  } catch (e) {
    // 조용히 넘기면 복사된 줄 알고 빈 내용을 붙여 넣는다.
    copyError.value = `클립보드 복사에 실패했습니다: ${e}`
  }
}

// 버전 기록 창은 DB 값을 읽는다. 먼저 저장해 화면과 맞추고, 실패하면 열지 않는다.
async function openHistory(act) {
  try {
    await saver.flush()
  } catch (e) {
    saver.saveError.value = `저장하지 못한 내용이 있어 버전 기록을 열 수 없습니다: ${String(e)}`
    return
  }
  historyModal.value = {
    activityId: act.id,
    studentId: selected.value.id,
    activityName: act.name,
    studentName: selected.value.name,
    currentContent: contentOf(act.id),
  }
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <!-- 학생 목록 (상담 때는 접어서 다른 학생 이름을 가린다) -->
    <aside v-if="showList" class="w-52 shrink-0 border-r border-line-2 overflow-y-auto bg-base">
      <div class="px-4 py-3 text-base font-semibold text-ink-3 border-b border-line">학생</div>
      <button
          v-for="s in students" :key="s.id"
          class="block w-full text-left px-4 py-2 text-base border-none cursor-pointer transition-colors"
          :class="s.id === selectedId ? 'bg-blue/[0.12] text-blue-2 font-semibold' : 'bg-transparent text-ink-2 hover:bg-line/30'"
          @click="selectedId = s.id"
      >{{ s.number }} {{ s.name }}</button>
    </aside>

    <div class="flex-1 min-w-0 flex flex-col">
      <!-- 툴바 -->
      <div class="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-line-2 bg-base min-h-15">
        <button class="flex items-center gap-1.5 py-1.5 px-3 text-base rounded-lg border border-line bg-surface text-ink-2 cursor-pointer hover:border-blue/40"
                @click="showList = !showList">
          <component :is="showList ? PanelLeftClose : PanelLeftOpen" :size="16"/>
          {{ showList ? '목록 숨기기(상담용)' : '목록 보기' }}
        </button>
        <button class="flex items-center py-1.5 px-2 rounded-lg border border-line bg-surface text-ink-2 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                :disabled="selectedIndex <= 0" title="이전 학생" @click="move(-1)">
          <ChevronLeft :size="18"/>
        </button>
        <span v-if="selected" class="text-lg font-bold text-ink px-1">
          {{ selected.grade }}학년 {{ selected.class_num }}반 {{ selected.number }}번 {{ selected.name }}
        </span>
        <button class="flex items-center py-1.5 px-2 rounded-lg border border-line bg-surface text-ink-2 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                :disabled="selectedIndex < 0 || selectedIndex >= students.length - 1" title="다음 학생" @click="move(1)">
          <ChevronRight :size="18"/>
        </button>
        <div class="flex-1"></div>
        <button class="flex items-center gap-1.5 py-1.5 px-3 text-base rounded-lg border cursor-pointer"
                :class="showAllCells ? 'border-blue/50 bg-blue/[0.10] text-blue-2' : 'border-line bg-surface text-ink-2'"
                @click="showAllCells = !showAllCells">
          <component :is="showAllCells ? EyeOff : Eye" :size="16"/>
          {{ showAllCells ? '빈 칸 접기' : '빈 칸도 보기' }}
        </button>
      </div>

      <!-- 안내·오류 -->
      <div v-if="saver.saveError.value || saver.snapshotError.value || copyError"
           class="px-6 pt-3 flex flex-col gap-2">
        <p v-if="saver.saveError.value" class="flex items-start gap-2 text-base text-red m-0 whitespace-pre-line">
          <AlertTriangle :size="16" class="shrink-0 mt-1"/>{{ saver.saveError.value }}
        </p>
        <p v-if="saver.snapshotError.value" class="flex items-start gap-2 text-base text-amber m-0">
          <AlertTriangle :size="16" class="shrink-0 mt-1"/>{{ saver.snapshotError.value }}
        </p>
        <p v-if="copyError" class="flex items-start gap-2 text-base text-red m-0">
          <AlertTriangle :size="16" class="shrink-0 mt-1"/>{{ copyError }}
        </p>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-4">
        <p v-if="loading" class="text-base text-ink-5">불러오는 중...</p>
        <p v-else-if="loadError" class="text-base text-red">{{ loadError }}</p>
        <p v-else-if="!selected" class="text-base text-ink-5">학생이 없습니다. 학생(Students)에서 먼저 추가하세요.</p>

        <template v-else>
          <p class="text-base text-ink-5 m-0 mb-4">
            칸 사이로 글을 옮길 때는 잘라내기(Ctrl+X)와 붙여넣기(Ctrl+V)를 쓰세요. 손을 멈추면 1초 뒤 저장되고,
            칸을 처음 고칠 때 고치기 전 내용이 버전 기록(<History :size="14" class="inline align-[-2px]"/>)에 남습니다.
          </p>

          <section v-for="grid in areas" :key="grid.area.id" class="mb-6 border border-line rounded-[10px] bg-surface">
            <!-- 영역 머리 -->
            <div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line">
              <h3 class="text-lg font-bold text-ink m-0">{{ grid.area.name }}</h3>
              <span class="text-base" :class="bytesOf(grid) > grid.area.byte_limit ? 'text-red font-semibold' : 'text-ink-5'">
                {{ bytesOf(grid).toLocaleString() }} / {{ grid.area.byte_limit.toLocaleString() }} 바이트
              </span>
              <div class="flex-1"></div>
              <button class="flex items-center gap-1.5 py-1 px-2.5 text-base rounded-lg border border-line bg-base text-ink-2 cursor-pointer hover:border-blue/40"
                      title="이 영역의 합친 글을 복사" @click="copyArea(grid)">
                <component :is="copiedAreaId === grid.area.id ? Check : Copy" :size="15"/>
                {{ copiedAreaId === grid.area.id ? '복사됨' : '합친 글 복사' }}
              </button>
            </div>

            <!-- 합친 글 미리보기 -->
            <div class="px-4 py-3 border-b border-line bg-base">
              <p class="text-base text-ink-5 m-0 mb-1">합친 글 미리보기</p>
              <p class="text-base text-ink-2 m-0 leading-relaxed whitespace-pre-wrap break-all">
                {{ joinedPreview(grid.activities, contentOf, configStore.exportCSeparator ?? ' ') || '(아직 쓴 글이 없습니다)' }}
              </p>
            </div>

            <!-- 활동 칸 -->
            <div class="px-4 py-3 flex flex-col gap-3">
              <div v-for="act in cellsOf(grid).visible" :key="act.id">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-base font-semibold text-ink-3">{{ act.name }}</span>
                  <button class="flex items-center p-1 rounded border-none bg-transparent text-ink-5 cursor-pointer hover:text-blue-2"
                          title="버전 기록" @click="openHistory(act)">
                    <History :size="15"/>
                  </button>
                </div>
                <textarea
                    class="sv-cell w-full box-border py-2 px-3 rounded-lg border text-base text-ink bg-surface leading-relaxed outline-none focus:border-blue/60 resize-y"
                    :class="cellClass(act.id)"
                    :value="contentOf(act.id)"
                    @input="saver.onInput(act.id, selected.id, $event.target.value)"
                ></textarea>
              </div>

              <div v-if="cellsOf(grid).hidden.length > 0" class="flex flex-wrap items-center gap-1.5">
                <span class="text-base text-ink-5 mr-1">빈 칸:</span>
                <button v-for="act in cellsOf(grid).hidden" :key="act.id"
                        class="flex items-center gap-1 py-1 px-2 text-base rounded-lg border border-dashed border-line bg-transparent text-ink-4 cursor-pointer hover:border-blue/50 hover:text-blue-2"
                        title="이 칸을 펼쳐 쓰거나 붙여 넣기" @click="reveal(act.id)">
                  <Plus :size="14"/>{{ act.name }}
                </button>
              </div>
            </div>
          </section>
        </template>
      </div>
    </div>

    <CellHistoryModal
        v-if="historyModal"
        :activity-id="historyModal.activityId"
        :student-id="historyModal.studentId"
        :activity-name="historyModal.activityName"
        :student-name="historyModal.studentName"
        :current-content="historyModal.currentContent"
        @close="historyModal = null"
    />
  </div>
</template>

<style scoped>
/* 글 길이에 맞춰 높이가 늘어난다(WebView2·Chromium). 너무 낮거나 높지 않게 범위를 둔다. */
.sv-cell {
  field-sizing: content;
  min-height: 3.2em;
  max-height: 60vh;
}
</style>
