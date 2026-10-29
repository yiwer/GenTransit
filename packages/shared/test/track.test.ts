import { describe, expect, it } from 'vitest'
import { dedupeAdjacent, simplifyTrack, trackKeyOf, trackSegments, type LngLatPair } from '../src/track'

const line = (n: number): LngLatPair[] => Array.from({ length: n }, (_, i) => [120 + i * 0.001, 30] as LngLatPair)

describe('走向轨迹', () => {
  it('分段：每段最多 18 个点，相邻两段共用端点', () => {
    expect(trackSegments(line(2))).toHaveLength(1)
    expect(trackSegments(line(18))).toHaveLength(1)
    const s = trackSegments(line(20))
    expect(s.map((x) => x.length)).toEqual([18, 3])
    expect(s[1][0]).toEqual(s[0][17])
    const big = trackSegments(line(52))
    // 52 个点 = 3 段，每段 18 个点，共用 2 个接缝点
    expect(big.map((x) => x.length)).toEqual([18, 18, 18])
    expect(big.flat().length - (big.length - 1)).toBe(52)
  })

  it('去掉相邻的重复坐标', () => {
    const p: LngLatPair[] = [
      [120, 30],
      [120, 30],
      [120.1, 30],
      [120, 30],
    ]
    expect(dedupeAdjacent(p)).toEqual([
      [120, 30],
      [120.1, 30],
      [120, 30],
    ])
  })

  it('指纹：站序或坐标变了就不同，相同则一致', () => {
    const a = line(5)
    expect(trackKeyOf(a)).toBe(trackKeyOf(line(5)))
    expect(trackKeyOf([a[1], a[0], ...a.slice(2)])).not.toBe(trackKeyOf(a))
    expect(trackKeyOf([...a.slice(0, 4), [a[4][0] + 0.00001, a[4][1]]])).not.toBe(trackKeyOf(a))
    expect(trackKeyOf(a.slice(0, 4))).not.toBe(trackKeyOf(a))
  })

  it('抽稀：直线上的点去掉，拐点保留，首尾不变', () => {
    const straight = line(50)
    expect(simplifyTrack(straight)).toEqual([straight[0], straight[49]])
    const bent: LngLatPair[] = [...line(10), [120.009, 30.005], [120.009, 30.01]]
    const out = simplifyTrack(bent)
    expect(out[0]).toEqual(bent[0])
    expect(out.at(-1)).toEqual(bent.at(-1))
    expect(out).toContainEqual([120.009, 30])
    expect(out.length).toBeLessThan(bent.length)
  })
})
