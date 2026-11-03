/**
 * 배포판 정보.
 *
 * 원본(itmir913/School-Record-App)과 이 판이 갈리는 값은 여기에만 둔다. 원본을 합칠 때
 * 충돌이 이 파일과 이 파일을 읽는 몇 줄에 모이도록 하기 위해서다.
 */
export const EDITION = {
  /** 앱 정보·시작 화면에 표시하는 판 이름 */
  name: '고양외고 25기 1학년부 판',
  /** 원본 저장소. 라이선스(PolyForm Noncommercial)의 고지 의무 때문에 표시한다. */
  upstreamRepository: 'https://github.com/itmir913/School-Record-App',
  /** 이 판의 저장소 */
  repository: 'https://github.com/seokkyu103/School-Record-App',
  /**
   * 업데이트 확인이 조회하는 주소. 원본을 보면 원본의 새 버전 알림을 따라 설치한 사람이
   * 이 판의 수정 사항을 잃는다.
   */
  releasesApi: 'https://api.github.com/repos/seokkyu103/School-Record-App/releases/latest',
} as const
