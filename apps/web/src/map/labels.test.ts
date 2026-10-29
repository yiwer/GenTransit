import { describe, expect, it } from 'vitest'
import { layoutLabels, type LabelInput } from './labels'

const P = (id: string, x: number, y: number, priority = 0, w = 80): LabelInput => ({
  id,
  x,
  y,
  r: 5,
  w,
  h: 18,
  priority,
})

const rectOf = (p: LabelInput, b: { left: number; top: number }) => ({
  l: b.left,
  t: b.top,
  r: b.left + p.w,
  b: b.top + p.h,
})
const overlap = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

describe('站名标注避让', () => {
  it('相距较远时都放在右上', () => {
    const pts = [P('a', 100, 100), P('b', 400, 100)]
    const out = layoutLabels(pts)
    expect(out.size).toBe(2)
    expect(out.get('a')!.left).toBeGreaterThan(100)
    expect(out.get('a')!.top).toBeLessThan(100)
  })

  it('密集时任意两个标注都不重叠，也不压住别的圆点', () => {
    const pts: LabelInput[] = []
    for (let i = 0; i < 40; i++) pts.push(P(`p${i}`, 100 + (i % 8) * 30, 100 + Math.floor(i / 8) * 22))
    const out = layoutLabels(pts)
    const boxes = pts.filter((p) => out.has(p.id)).map((p) => ({ p, r: rectOf(p, out.get(p.id)!) }))
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.length).toBeLessThan(pts.length)
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i].r, boxes[j].r)).toBe(false)
    for (const { p, r } of boxes)
      for (const d of pts)
        if (d.id !== p.id) expect(overlap(r, { l: d.x - d.r, t: d.y - d.r, r: d.x + d.r, b: d.y + d.r })).toBe(false)
  })

  it('右上被占时换到其他位置', () => {
    // b 在 a 的右上方，a 的右上位置会压住 b 的标注
    const pts = [P('b', 120, 85, 1), P('a', 100, 100)]
    const out = layoutLabels(pts)
    expect(out.has('a')).toBe(true)
    expect(overlap(rectOf(pts[0], out.get('b')!), rectOf(pts[1], out.get('a')!))).toBe(false)
  })

  it('选中的标注优先，挤不下时也一定显示', () => {
    const pts = [P('x', 100, 100), P('y', 104, 102), P('sel', 102, 101, 3)]
    const out = layoutLabels(pts)
    expect(out.has('sel')).toBe(true)
  })

  it('平移后布局不变', () => {
    const pts = [P('a', 100, 100), P('b', 130, 104), P('c', 160, 98)]
    const moved = pts.map((p) => ({ ...p, x: p.x + 237, y: p.y - 91 }))
    const a = layoutLabels(pts)
    const b = layoutLabels(moved)
    expect([...b.keys()]).toEqual([...a.keys()])
    for (const [id, box] of a) expect(b.get(id)).toEqual({ left: box.left + 237, top: box.top - 91 })
  })
})
