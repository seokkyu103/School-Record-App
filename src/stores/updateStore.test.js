import {describe, it, expect} from 'vitest'
import {compareVersions} from './updateStore'

describe('compareVersions', () => {
  it('공개된 판이 지금 판보다 옛 판이면 새 버전이 아니다', () => {
    expect(compareVersions('0.3.1-g25.3', '0.3.1-g25.4')).toBeLessThan(0)
  })
  it('공개된 판이 더 새 판이면 새 버전이다', () => {
    expect(compareVersions('0.3.1-g25.5', '0.3.1-g25.4')).toBeGreaterThan(0)
    expect(compareVersions('0.3.1-g25.10', '0.3.1-g25.9')).toBeGreaterThan(0)
  })
  it('앞의 v는 상관없다', () => {
    expect(compareVersions('v0.3.1-g25.4', '0.3.1-g25.4')).toBe(0)
  })
})
