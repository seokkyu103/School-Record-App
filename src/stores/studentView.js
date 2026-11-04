import {defineStore} from 'pinia'
import {ref} from 'vue'
import {invoke} from '@tauri-apps/api/core'

// 학생별 보기(고양외고 25기 1학년부 판). 영역마다 기록 화면과 같은 조회(get_area_grid)를
// 불러 한 학생의 모든 영역을 한 화면에 보인다. 저장은 record 스토어의 upsertRecord를 쓴다.
export const useStudentViewStore = defineStore('studentView', () => {
    // [{area, activities, students, records}] — 영역 순서는 넘겨받은 areas 순서
    const grids = ref([])

    // 화면을 빠르게 다시 열면 이전 요청이 나중에 도착할 수 있다. 세대 번호로 옛 응답을 버린다.
    let seq = 0

    async function fetchAll(areas) {
        const mySeq = ++seq
        const result = []
        for (const area of areas) {
            const data = await invoke('get_area_grid', {areaId: area.id})
            result.push({area, ...data})
        }
        if (mySeq !== seq) return null
        grids.value = result
        return result
    }

    return {grids, fetchAll}
})
