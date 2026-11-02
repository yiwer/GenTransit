import { SHELF_FORMS, SHELF_PARAM_DEFAULTS, SHELF_PRESETS, shelfSpec, type ShelfSpec } from '@gentransit/shared'
import { describe, expect, it } from 'vitest'
import { BOARD_GAP_MM, buildShelfModel, type FaceModel, type Mount, type ShelfModelFace } from '.'

const spec = (form: string, params: object = {}) => shelfSpec.parse({ form, params }) as ShelfSpec
const b = (id: string, width = 1200, height = 1800) => ({ id, width, height })
const parts = (f: FaceModel) => new Set(f.view.flatMap((p) => (p.kind === 'rect' ? [p.part] : [])))
const rects = (f: FaceModel, part: string) => f.view.filter((p) => p.kind === 'rect' && p.part === part)
const overlap = (a: Mount, c: Mount) => a.x < c.x + c.w && c.x < a.x + a.w

describe('buildShelfModel', () => {
  it('每种形式的面与面名', () => {
    const faces = (s: ShelfSpec) => buildShelfModel(s, []).faces.map((f) => `${f.face}:${f.label}`)
    expect(faces(spec('singlePost', { sides: 1 }))).toEqual(['front:正面'])
    expect(faces(spec('doublePost'))).toEqual(['front:正面', 'back:背面'])
    expect(faces(spec('shelter', { sides: 2 }))).toEqual(['front:亭内', 'back:亭外'])
    expect(faces(spec('totem', { faces: 4 }))).toEqual(['A:A面', 'B:B面', 'C:C面', 'D:D面'])
    expect(faces(spec('attached', { host: 'wall' }))).toEqual(['front:正面'])
    expect(faces(spec('ePost'))).toEqual(['front:正面', 'back:背面'])
  })

  it('每种形式画出对应的部件', () => {
    const of = (s: ShelfSpec) => parts(buildShelfModel(s, [{ face: 'front', boards: [b('a')] }]).faces[0])
    expect(of(spec('singlePost'))).toEqual(new Set(['post']))
    expect(of(spec('singlePost', { mount: 'flag' }))).toEqual(new Set(['post', 'arm']))
    expect(of(spec('doublePost'))).toEqual(new Set(['post']))
    expect(of(spec('shelter', { mountBottom: 400 }))).toEqual(new Set(['canopy', 'backPanel', 'post']))
    expect(parts(buildShelfModel(spec('totem'), [{ face: 'A', boards: [b('a')] }]).faces[0])).toEqual(
      new Set(['base', 'column', 'cap']),
    )
    expect(of(spec('attached'))).toEqual(new Set(['wall']))
    expect(of(spec('attached', { host: 'pole' }))).toEqual(new Set(['pole']))
    expect(of(spec('ePost'))).toEqual(new Set(['base', 'box', 'screen']))
    // 双立柱两根柱
    expect(rects(buildShelfModel(spec('doublePost'), []).faces[0], 'post')).toHaveLength(2)
  })

  it('挂牌位置不重叠，下沿等于 mountBottom；间距固定', () => {
    for (const form of SHELF_FORMS) {
      const s = spec(form, { mountBottom: 900 })
      const face = form === 'totem' ? 'A' : 'front'
      const m = buildShelfModel(s, [{ face, boards: [b('a', 800, 1200), b('b', 600, 1500), b('c', 1000, 1000)] }])
      const ms = m.faces[0].mounts
      expect(ms.map((x) => x.boardId)).toEqual(['a', 'b', 'c'])
      for (const x of ms) expect([form, x.y]).toEqual([form, 900])
      for (let i = 1; i < ms.length; i++) {
        expect(overlap(ms[i - 1], ms[i])).toBe(false)
        expect(ms[i].x - (ms[i - 1].x + ms[i - 1].w)).toBe(BOARD_GAP_MM)
      }
    }
  })

  it('双立柱的柱位随牌组宽度变化；postInset 为负时柱在牌外侧', () => {
    const posts = (boards: ReturnType<typeof b>[], params: object = {}) => {
      const f = buildShelfModel(spec('doublePost', params), [{ face: 'front', boards }]).faces[0]
      const [l, r] = rects(f, 'post') as Extract<FaceModel['view'][number], { kind: 'rect' }>[]
      return { l, r, m: f.mounts }
    }
    const one = posts([b('a', 1200)])
    const two = posts([b('a', 1200), b('b', 1200)])
    const dist = (x: typeof one) => x.r.x - x.l.x
    expect(dist(two) - dist(one)).toBe(1200 + BOARD_GAP_MM)
    // 默认柱中心在牌组边缘以内 100
    expect(one.l.x + one.l.w / 2).toBeCloseTo(one.m[0].x + 100)
    const out = posts([b('a', 1200)], { postInset: -80 })
    expect(out.l.x + out.l.w / 2).toBeCloseTo(out.m[0].x - 80)
  })

  it('候车亭放不下牌组时自动加长到牌组宽 + 600，并给出提示', () => {
    const boards = [b('a', 2000), b('b', 2000), b('c', 2000)]
    const m = buildShelfModel(spec('shelter', { length: 3000, mountBottom: 400 }), [{ face: 'front', boards }])
    const W = 6000 + 2 * BOARD_GAP_MM
    expect(m.warnings).toContain(`牌组宽 ${W} mm，超出候车亭长度 3000 mm，按 ${W + 600} mm 画`)
    const canopy = rects(m.faces[0], 'canopy')[0] as { w: number }
    expect(canopy.w).toBe(W + 600 + 200)
    const ok = buildShelfModel(spec('shelter'), [{ face: 'front', boards: [b('a')] }])
    expect(ok.warnings).toEqual([])
    expect(
      buildShelfModel(spec('shelter', { mountBottom: 800 }), [{ face: 'front', boards: [b('a', 1200, 2000)] }])
        .warnings[0],
    ).toContain('高于顶棚下沿')
  })

  it('多面柱：面数与面宽取各面牌组宽 + 2 × margin 的最大值', () => {
    const faces: ShelfModelFace[] = [
      { face: 'A', boards: [b('a', 600)] },
      { face: 'B', boards: [b('b', 600), b('c', 400)] },
    ]
    const m = buildShelfModel(spec('totem', { faces: 3, margin: 60 }), faces)
    expect(m.faces.map((f) => f.face)).toEqual(['A', 'B', 'C'])
    const side = 600 + BOARD_GAP_MM + 400 + 120
    for (const f of m.faces) expect((rects(f, 'column')[0] as { w: number }).w).toBeCloseTo(side, 0)
    expect(m.parts.find((p) => p.part === 'column')).toMatchObject({ shape: 'prism', sides: 3 })
  })

  it('站牌所在的面不属于这个类型时归入"其他面"，不画结构并提示', () => {
    const m = buildShelfModel(spec('totem'), [
      { face: 'A', boards: [b('a')] },
      { face: 'front', boards: [b('x'), b('y')] },
    ])
    const other = m.faces.at(-1)!
    expect(other).toMatchObject({ face: 'other', label: '其他面' })
    expect(other.mounts.map((x) => x.boardId)).toEqual(['x', 'y'])
    expect(other.view.every((p) => p.kind === 'ground')).toBe(true)
    expect(m.warnings).toEqual(['2 块站牌在正面，不属于多面柱「A面、B面、C面」，归入其他面'])
  })

  it('牌面下方超过 1000 mm 时压缩并画折断号；fold=false 按实际尺寸', () => {
    const s = spec('attached', { host: 'pole', mountBottom: 2200 })
    const faces = [{ face: 'front' as const, boards: [b('a', 800, 1200)] }]
    const m = buildShelfModel(s, faces)
    expect(m.fold).toBe(1200)
    expect(m.faces[0].mounts[0].y).toBe(1000)
    expect(m.faces[0].view.some((p) => p.kind === 'break')).toBe(true)
    const real = buildShelfModel(s, faces, { fold: false })
    expect(real.fold).toBe(0)
    expect(real.faces[0].mounts[0].y).toBe(2200)
    // 杆高 6000 远高于牌组：截断画折断号
    expect(real.faces[0].view.filter((p) => p.kind === 'break')).toHaveLength(1)
    // 截断处不低于牌组顶边（按实际的牌面下沿算）
    const pole = rects(real.faces[0], 'pole')[0] as { y: number; h: number }
    expect(pole.y + pole.h).toBeGreaterThanOrEqual(2200 + 1200)
    expect(buildShelfModel(spec('doublePost'), faces).faces[0].view.some((p) => p.kind === 'break')).toBe(false)
  })

  it('背面看到的结构与正面左右相反（旗式单立柱的柱在背面右侧）', () => {
    const m = buildShelfModel(spec('singlePost', { mount: 'flag', sides: 2 }), [
      { face: 'front', boards: [b('a', 800)] },
      { face: 'back', boards: [b('b', 800)] },
    ])
    const [front, back] = m.faces
    const postX = (f: FaceModel) => (rects(f, 'post')[0] as { x: number }).x
    expect(postX(front)).toBeLessThan(front.mounts[0].x)
    expect(postX(back)).toBeGreaterThan(back.mounts[0].x)
  })

  it('toShelf：正面朝站台（+z），背面朝车行道；垂直路缘时正面朝来车方向（−x）', () => {
    const m = buildShelfModel(spec('doublePost'), [])
    const normal = (f: FaceModel) => [f.toShelf[8], f.toShelf[9], f.toShelf[10]]
    expect(normal(m.faces[0])).toEqual([0, 0, 1])
    expect(normal(m.faces[1]).map((x) => Math.round(x))).toEqual([0, 0, -1])
    const p = buildShelfModel(spec('doublePost', { orientation: 'perpendicular' }), [])
    expect(normal(p.faces[0]).map((x) => Math.round(x))).toEqual([-1, 0, 0])
    expect(p.footprint.width).toBeLessThan(m.footprint.width)
  })

  it('无实物站架照常算几何；同输入同输出', () => {
    const faces = [{ face: 'front' as const, boards: [b('a'), b('b')] }]
    for (const p of SHELF_PRESETS) {
      const a = buildShelfModel(p.spec, faces, { ghost: true })
      expect(a.ghost).toBe(true)
      expect(buildShelfModel(p.spec, faces, { ghost: true })).toEqual(a)
      expect(a.parts.length).toBeGreaterThan(0)
      for (const f of a.faces) {
        expect(f.width).toBeGreaterThan(0)
        expect(f.height).toBeGreaterThan(0)
      }
    }
    expect(buildShelfModel({ form: 'ePost', params: SHELF_PARAM_DEFAULTS.ePost }, faces).ghost).toBe(false)
  })
})
