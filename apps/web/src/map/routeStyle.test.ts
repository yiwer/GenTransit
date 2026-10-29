import { describe, expect, it } from 'vitest'
import { isReturnKind, legendKinds, lineColor, lineHue } from './routeStyle'

const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)

describe('线路颜色', () => {
  it('同一个 id 总是同一个颜色', () => {
    expect(lineColor(ids[7])).toBe(lineColor(ids[7]))
    expect(lineColor(ids[7])).toMatch(/^oklch\(calc\(var\(--route-l\) [+-] 5%\) var\(--route-c\) \d+\)$/)
  })
  it('不落在珊瑚色一带（10°～70°），色相分散', () => {
    const hues = ids.map((id) => lineHue(id).hue)
    expect(hues.every((h) => h >= 0 && h < 360 && (h < 10 || h >= 70))).toBe(true)
    // 400 个 id 至少覆盖 12 个 30° 扇区中的 10 个（去掉珊瑚色一带后最多 11 个有值）
    expect(new Set(hues.map((h) => Math.floor(h / 30))).size).toBeGreaterThanOrEqual(10)
    const shades = new Set(ids.map((id) => lineHue(id).shade))
    expect(shades).toEqual(new Set([-1, 1]))
  })
})

describe('上下行线型', () => {
  it('下行、外环是空心线', () => {
    expect(isReturnKind('down')).toBe(true)
    expect(isReturnKind('outer')).toBe(true)
    expect(isReturnKind('up')).toBe(false)
    expect(isReturnKind('loop')).toBe(false)
  })
  it('图例只列出实际有的种类', () => {
    expect(legendKinds(['down', 'up', 'up'])).toEqual({ solid: ['上行'], hollow: ['下行'] })
    expect(legendKinds(['inner', 'outer'])).toEqual({ solid: ['内环'], hollow: ['外环'] })
    expect(legendKinds(['loop'])).toEqual({ solid: ['环线'], hollow: [] })
  })
})
