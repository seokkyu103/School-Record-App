import {onBeforeUnmount, onMounted, reactive, ref} from 'vue'
import {getCurrentWindow} from '@tauri-apps/api/window'
import {useRecordStore} from '../stores/record'
import {cellKey} from '../services/studentView'

/**
 * 기록 칸 자동 저장(학생별 보기용, 고양외고 25기 1학년부 판).
 *
 * 기록 화면(RecordSection)의 저장 규칙을 그대로 옮겼다 — 손을 멈추고 1초 뒤 저장,
 * 화면을 떠날 때 남은 저장을 마저 하고, 창을 닫을 때 먼저 저장하고, 실패하면 알린다.
 * 기록 화면은 건드리지 않았다(이미 배포된 판의 동작을 바꾸지 않기 위해). 규칙을 고칠 때는
 * 두 곳을 함께 본다.
 *
 * 더한 것: snapshotNote를 주면 **이 화면에서 칸을 처음 고치기 전에** 그 칸의 지금 내용을
 * 버전 기록에 남긴다. 셀 편집은 버전 기록을 만들지 않는 설계(CLAUDE.md)라, 상담 중에
 * 잘라내기·붙여넣기로 영역 사이를 옮기다 실수하면 되돌릴 길이 없기 때문이다.
 */
export function useCellAutosave({snapshotNote = null} = {}) {
    const recordStore = useRecordStore()

    const cellContent = reactive(new Map())
    const savingState = ref(new Map())
    const saveError = ref('')
    // 버전 기록을 못 남긴 경우의 안내. 저장 성공이 지우지 않도록 saveError와 따로 둔다.
    const snapshotError = ref('')

    const debounceTimers = new Map()
    // 저장에 실패한 칸과 그때 저장하려던 내용(재시도용)
    const failedSaves = new Map()
    // 진행 중인 저장
    const inFlightSaves = new Map()
    // 칸마다 "고치기 전" 기록 한 번. 값은 그 작업의 Promise(저장이 이것을 기다린다).
    const snapshots = new Map()

    let unlistenClose = null
    let unmounted = false
    let closeWarned = false

    function setState(key, value) {
        const next = new Map(savingState.value)
        if (value === null) next.delete(key)
        else next.set(key, value)
        savingState.value = next
    }

    function clearCloseWarning() {
        closeWarned = false
        if (failedSaves.size === 0) saveError.value = ''
    }

    /** 불러온 기록으로 칸 내용을 채운다. */
    function load(records) {
        cellContent.clear()
        for (const r of records) cellContent.set(cellKey(r.activity_id, r.student_id), r.content)
    }

    function contentOf(activityId, studentId) {
        return cellContent.get(cellKey(activityId, studentId)) ?? ''
    }

    function stateOf(activityId, studentId) {
        return savingState.value.get(cellKey(activityId, studentId))
    }

    // 처음 고치기 **전에** 남겨야 한다. 그래서 첫 입력 때 바로 시작하고, 저장은 이것을 기다린다.
    function ensureSnapshot(activityId, studentId) {
        if (!snapshotNote) return Promise.resolve()
        const key = cellKey(activityId, studentId)
        if (!snapshots.has(key)) {
            snapshots.set(key, recordStore.saveHistorySnapshot({activityId, studentId, note: snapshotNote})
                .catch(e => {
                    // 버전 기록을 못 남겨도 저장은 한다 — 쓴 글을 잃는 것이 더 나쁘다. 대신 알린다.
                    snapshotError.value = `고치기 전 내용을 버전 기록에 남기지 못했습니다(저장은 계속합니다): ${String(e)}`
                }))
        }
        return snapshots.get(key)
    }

    function onInput(activityId, studentId, content) {
        const key = cellKey(activityId, studentId)
        cellContent.set(key, content)
        // 새로 친 내용은 아직 저장을 시도하지 않았다. 예전 실패 때의 경고를 남겨 두면
        // 다음 닫기가 저장 시도 없이 이 내용을 버리고 종료한다.
        closeWarned = false
        ensureSnapshot(activityId, studentId)
        if (savingState.value.get(key) === 'error') setState(key, null)
        if (debounceTimers.has(key)) clearTimeout(debounceTimers.get(key))
        debounceTimers.set(key, setTimeout(() => saveCell(activityId, studentId, content), 1000))
    }

    async function saveCell(activityId, studentId, content) {
        const key = cellKey(activityId, studentId)
        debounceTimers.delete(key)
        setState(key, 'saving')
        const pending = ensureSnapshot(activityId, studentId)
            .then(() => recordStore.upsertRecord(activityId, studentId, content))
        inFlightSaves.set(key, pending)
        try {
            await pending
            setState(key, 'saved')
            failedSaves.delete(key)
            clearCloseWarning()
            setTimeout(() => {
                if (savingState.value.get(key) === 'saved') setState(key, null)
            }, 500)
        } catch (e) {
            setState(key, 'error')
            failedSaves.set(key, content)
            saveError.value = `저장하지 못했습니다: ${String(e)}`
        } finally {
            if (inFlightSaves.get(key) === pending) inFlightSaves.delete(key)
        }
    }

    /** 기다리는 저장과 실패한 저장을 지금 모두 저장한다. 실패하면 던진다. */
    async function flush() {
        // 타이머를 먼저 끈다(키는 남겨 아래 대상에 넣는다).
        for (const timerId of debounceTimers.values()) clearTimeout(timerId)
        // 진행 중인 저장이 하나도 없을 때까지 기다린다.
        while (inFlightSaves.size > 0) {
            await Promise.allSettled([...inFlightSaves.values()])
        }
        // 실패분을 먼저 넣고 대기분으로 덮어 더 나중에 친 내용이 이기게 한다.
        const targets = new Map(failedSaves)
        for (const key of debounceTimers.keys()) {
            if (cellContent.has(key)) targets.set(key, cellContent.get(key))
        }
        if (targets.size === 0) {
            debounceTimers.clear()
            clearCloseWarning()
            return
        }
        const saves = []
        for (const [key, content] of targets) {
            const [actId, stuId] = key.split('-').map(Number)
            saves.push(ensureSnapshot(actId, stuId).then(() => recordStore.upsertRecord(actId, stuId, content)))
        }
        await Promise.all(saves)
        for (const key of targets.keys()) {
            if (savingState.value.get(key) === 'error') setState(key, null)
        }
        debounceTimers.clear()
        failedSaves.clear()
        clearCloseWarning()
    }

    onMounted(async () => {
        // 창을 닫는 경로에는 언마운트가 걸리지 않는다. 닫기를 가로채 먼저 저장한다.
        const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
            if (debounceTimers.size === 0 && failedSaves.size === 0 && inFlightSaves.size === 0) return
            // 한 번 막고 알린 뒤에도 다시 닫으면 그대로 닫는다(갇히지 않게).
            if (closeWarned) return
            event.preventDefault()
            try {
                await flush()
            } catch (e) {
                closeWarned = true
                saveError.value =
                    `미저장 내용을 저장하지 못했습니다: ${String(e)}\n` +
                    '내용을 다른 곳에 복사해 두세요. 다시 닫기를 누르면 저장하지 않고 종료합니다.'
                return
            }
            try {
                await getCurrentWindow().destroy()
            } catch (e) {
                saveError.value = `작업은 저장했지만 창을 닫지 못했습니다: ${String(e)}`
            }
        })
        // 등록 중에 언마운트됐으면 리스너만 남지 않게 바로 푼다.
        if (unmounted) {
            unlisten()
            return
        }
        unlistenClose = unlisten
    })

    onBeforeUnmount(() => {
        unmounted = true
        if (unlistenClose) unlistenClose()
        // 언마운트는 기다릴 수 없다. 저장은 발행되면 끝까지 간다. 실패는 컴포넌트보다
        // 오래 사는 store에 담아 작업 화면이 보여 준다(조용히 사라지면 안 된다).
        flush().catch(e => {
            recordStore.pendingSaveError = `화면을 옮기기 전 저장하지 못한 내용이 있습니다: ${String(e)}`
        })
    })

    return {cellContent, savingState, saveError, snapshotError, load, contentOf, stateOf, onInput, flush}
}
