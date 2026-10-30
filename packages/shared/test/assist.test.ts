import { describe, expect, it } from 'vitest'
import {
  DraftError,
  addBoard,
  addShelf,
  addSlot,
  copySignSet,
  distanceM,
  emptyDraft,
  fmtDistance,
  gapWarnings,
  hide,
  onBoard,
  oppositeDirOf,
  placeAll,
  placeOnBoard,
  poolOf,
  stopBatchInput,
  stopBatchPatch,
  stopListQuery,
  suggestInsert,
  updateBoard,
  wrongSide,
  type Passage,
  type RouteInfo,
  type SignSetDraft,
} from '../src'

/** 以 (120, 30) 为原点，按米偏移出一个点（x 向东、y 向北） */
const at = (x: number, y: number) => ({
  lng: 120 + x / (Math.cos((30 * Math.PI) / 180) * 111320),
  lat: 30 + y / 110540,
})

describe('距离', () => {
  it('haversine 与局部近似一致', () => {
    expect(distanceM(at(0, 0), at(300, 400))).toBeCloseTo(500, -1)
    expect(distanceM(at(0, 0), at(0, 0))).toBe(0)
    expect(fmtDistance(420.4)).toBe('420 m')
    expect(fmtDistance(4230)).toBe('4.2 km')
  })
})

describe('对向站点（BR-19）', () => {
  it('方位模式取相对方位，其余情况为同名任意站', () => {
    expect(oppositeDirOf('东', 'orientation')).toBe('西')
    expect(oppositeDirOf('北', 'orientation')).toBe('南')
    expect(oppositeDirOf('场站', 'orientation')).toBeNull()
    expect(oppositeDirOf('A1', 'code')).toBeNull()
  })
})

describe('方位疑似反了（BR-20）', () => {
  // 向北行驶：右侧是东（x > 0）
  const prev = at(0, -200)
  const next = at(0, 200)
  it('站在右侧、对向站在左侧：正常', () => {
    expect(wrongSide(prev, at(12, 0), next, at(-12, 0))).toBe(false)
  })
  it('站在左侧、对向站在右侧：反了', () => {
    expect(wrongSide(prev, at(-12, 0), next, at(12, 0))).toBe(true)
  })
  it('首站与末站只用一侧的相邻站', () => {
    expect(wrongSide(null, at(-12, 0), next, at(12, 0))).toBe(true)
    expect(wrongSide(prev, at(-12, 0), null, at(12, 0))).toBe(true)
    expect(wrongSide(null, at(12, 0), next, at(-12, 0))).toBe(false)
  })
  it('容差内、没有相邻站或相邻站太近时不判断', () => {
    expect(wrongSide(prev, at(-2, 0), next, at(2, 0))).toBe(false)
    expect(wrongSide(null, at(-12, 0), null, at(12, 0))).toBe(false)
    expect(wrongSide(at(0, -3), at(-12, 0), at(0, 3), at(12, 0))).toBe(false)
  })
})

describe('插入位置建议', () => {
  const line = [at(0, 0), at(1000, 0), at(2000, 0), at(3000, 0)]
  it('插在绕行最短的相邻两站之间', () => {
    expect(suggestInsert(line, at(1500, 30))).toEqual({ at: 2, reason: 'between' })
    expect(suggestInsert(line, at(400, -20))).toEqual({ at: 1, reason: 'between' })
  })
  it('首站之前、末站之后', () => {
    expect(suggestInsert(line, at(-600, 0))).toEqual({ at: 0, reason: 'head' })
    expect(suggestInsert(line, at(3700, 0))).toEqual({ at: 4, reason: 'tail' })
    expect(suggestInsert([], at(0, 0))).toEqual({ at: 0, reason: 'tail' })
  })
})

describe('相邻站距离提醒', () => {
  it('超过 3 公里的行', () => {
    expect(gapWarnings([at(0, 0), at(500, 0), at(4000, 0), at(4100, 0)])).toEqual([2])
    expect(gapWarnings([at(0, 0)])).toEqual([])
  })
})

describe('列表参数与批量修改', () => {
  it('near 解析为经纬度，check 只认检查项', () => {
    const q = stopListQuery.parse({ near: '120.1,30.2', check: 'noPhoto' })
    expect(q.near).toEqual([120.1, 30.2])
    expect(stopListQuery.safeParse({ near: 'abc' }).success).toBe(false)
    expect(stopListQuery.safeParse({ check: 'nope' }).success).toBe(false)
  })
  it('补丁至少改一项；null 表示清空；scope 二选一', () => {
    expect(stopBatchPatch.safeParse({}).success).toBe(false)
    expect(stopBatchPatch.safeParse({ facilities: {} }).success).toBe(false)
    const p = stopBatchPatch.parse({ maintainerId: null })
    expect('maintainerId' in p && p.maintainerId === null).toBe(true)
    expect(stopBatchPatch.parse({ facilities: { seats: 2 } }).facilities).toEqual({ seats: 2 })
    expect(stopBatchInput.safeParse({ scope: { ids: [] }, patch: { roadId: null } }).success, '空的勾选').toBe(false)
    const f = stopBatchInput.parse({ scope: { filter: { q: '人民', lineIds: '' } }, patch: { roadId: null } })
    expect('filter' in f.scope && f.scope.filter.q).toBe('人民')
  })
})

/* ---------------- 站牌集：全部放到、复制 ---------------- */

const TYPE = { id: '0190f0a0-0000-7000-8000-000000000001', name: '双立柱站架' }
const ROUTES: RouteInfo[] = [
  { id: 'r-k1-up', lineId: 'l-k1', lineName: 'K1路', kind: 'up', suspended: false, terminal: '火车站' },
  { id: 'r-k1-down', lineId: 'l-k1', lineName: 'K1路', kind: 'down', suspended: false, terminal: '北门' },
  { id: 'r-2-up', lineId: 'l-2', lineName: '2路', kind: 'up', suspended: false, terminal: '东站' },
  { id: 'r-10-up', lineId: 'l-10', lineName: '10路', kind: 'up', suspended: false, terminal: '西站' },
  { id: 'r-10-down', lineId: 'l-10', lineName: '10路', kind: 'down', suspended: false, terminal: '东站' },
  { id: 'r-loop', lineId: 'l-loop', lineName: '环1路', kind: 'loop', suspended: false, terminal: '人民广场' },
]

/** 一个站架、一块整版站牌 + 一块分片站牌（两个线路插片） */
function board2(): { d: SignSetDraft; whole: string; sliced: string; slots: string[] } {
  let d = addShelf(emptyDraft(), { type: TYPE }).draft
  const shelfId = d.shelves[0].id
  const a = addBoard(d, shelfId)
  d = a.draft
  const b = addBoard(d, shelfId)
  d = updateBoard(b.draft, b.boardId, { kind: 'sliced' }).draft
  d = addSlot(d, b.boardId).draft
  return { d, whole: a.boardId, sliced: b.boardId, slots: findSlots(d, b.boardId) }
}
const findSlots = (d: SignSetDraft, boardId: string) =>
  d.shelves
    .flatMap((s) => s.boards)
    .find((b) => b.id === boardId)!
    .slots.map((s) => s.id)

describe('全部放到（A7）', () => {
  const passages: Passage[] = [
    { routeId: 'r-10-up', pass: 1, count: 1 },
    { routeId: 'r-k1-up', pass: 1, count: 1 },
    { routeId: 'r-2-up', pass: 1, count: 1 },
  ]
  it('整版站牌：全部放上并自动排序', () => {
    const { d, whole } = board2()
    const r = placeAll(d, poolOf(d, passages, ROUTES), whole)
    expect(r).toMatchObject({ placed: 3, left: 0 })
    expect(onBoard(r.draft, whole).map((s) => s.routeId)).toEqual(['r-2-up', 'r-10-up', 'r-k1-up'])
  })
  it('分片站牌：放满空插片，剩下的留在待编排', () => {
    const { d, sliced, slots } = board2()
    expect(slots).toHaveLength(2)
    const r = placeAll(d, poolOf(d, passages, ROUTES), sliced)
    expect(r).toMatchObject({ placed: 2, left: 1 })
    expect(poolOf(r.draft, passages, ROUTES).filter((p) => p.status === 'waiting')).toHaveLength(1)
  })
  it('已编排、隐藏的不动', () => {
    const { d: d0, whole } = board2()
    const d = hide(d0, { routeId: 'r-2-up', pass: 1 })
    const r = placeAll(d, poolOf(d, passages, ROUTES), whole)
    expect(r.placed).toBe(2)
    expect(poolOf(r.draft, passages, ROUTES).find((p) => p.routeId === 'r-2-up')!.status).toBe('hidden')
  })
})

describe('从其他站点复制（C4，BR-21）', () => {
  /** 对向站：K1 上行、10 路上行放在整版站牌，2 路在插片，环 1 路两次途经 */
  function source() {
    const { d: d0, whole, sliced, slots } = board2()
    let d = placeOnBoard(d0, { routeId: 'r-10-up', pass: 1 }, whole)
    d = placeOnBoard(d, { routeId: 'r-k1-up', pass: 1 }, whole)
    d = {
      ...d,
      schedules: [
        ...d.schedules,
        { id: 'x1', routeId: 'r-2-up', pass: 1, placement: 'slot', boardId: sliced, slotId: slots[0], order: null },
      ],
    }
    d = placeOnBoard(d, { routeId: 'r-loop', pass: 1 }, whole)
    d = placeOnBoard(d, { routeId: 'r-loop', pass: 2 }, whole)
    return d
  }
  // 本站：K1 下行、10 路下行、2 路上行（已隐藏）、环 1 路两次
  const passages: Passage[] = [
    { routeId: 'r-k1-down', pass: 1, count: 1 },
    { routeId: 'r-10-down', pass: 1, count: 1 },
    { routeId: 'r-2-up', pass: 1, count: 1 },
    { routeId: 'r-loop', pass: 1, count: 2 },
    { routeId: 'r-loop', pass: 2, count: 2 },
  ]

  it('结构追加、编号顺延；唯一途经映射到对应站牌，保持顺序；多次途经与已有编排留下', () => {
    const src = source()
    let target = addShelf(emptyDraft(), { type: TYPE }).draft
    target = hide(target, { routeId: 'r-2-up', pass: 1 })
    const r = copySignSet(target, src, { sourceRoutes: ROUTES, targetPool: poolOf(target, passages, ROUTES) })
    expect(r).toMatchObject({ shelves: 1, boards: 2, mapped: 2, skipped: 3 })
    expect(r.draft.shelves.map((s) => s.no)).toEqual([1, 2])
    const newWhole = r.draft.shelves[1].boards[0]
    expect(newWhole.no).toBe(1)
    expect(onBoard(r.draft, newWhole.id).map((s) => s.routeId)).toEqual(['r-10-down', 'r-k1-down'])
    const pool = poolOf(r.draft, passages, ROUTES)
    expect(pool.filter((p) => p.routeId === 'r-loop').every((p) => p.status === 'waiting')).toBe(true)
    expect(pool.find((p) => p.routeId === 'r-2-up')!.status).toBe('hidden')
    // ID 全部新生成
    const ids = new Set(
      src.shelves.flatMap((s) => [s.id, ...s.boards.flatMap((b) => [b.id, ...b.slots.map((x) => x.id)])]),
    )
    expect(r.draft.shelves[1].boards.every((b) => !ids.has(b.id) && b.slots.every((x) => !ids.has(x.id)))).toBe(true)
  })

  it('插片与隐藏一并映射', () => {
    const { d: d0, sliced, slots } = board2()
    let src: SignSetDraft = {
      ...d0,
      schedules: [
        { id: 'y', routeId: 'r-2-up', pass: 1, placement: 'slot', boardId: sliced, slotId: slots[1], order: null },
      ],
    }
    src = hide(src, { routeId: 'r-10-up', pass: 1 })
    const target = emptyDraft()
    const r = copySignSet(target, src, { sourceRoutes: ROUTES, targetPool: poolOf(target, passages, ROUTES) })
    expect(r.mapped).toBe(2)
    const pool = poolOf(r.draft, passages, ROUTES)
    expect(pool.find((p) => p.routeId === 'r-10-down')!.status).toBe('hidden')
    const s2 = pool.find((p) => p.routeId === 'r-2-up')!.schedules[0]
    expect(s2.placement).toBe('slot')
    expect(r.draft.shelves[0].boards[1].slots[1].id).toBe(s2.slotId)
  })

  it('编号不够时报错', () => {
    let target = emptyDraft()
    for (let i = 0; i < 15; i++) target = addShelf(target, { type: TYPE }).draft
    expect(() => copySignSet(target, source(), { sourceRoutes: ROUTES, targetPool: [] })).toThrow(DraftError)
  })
})
