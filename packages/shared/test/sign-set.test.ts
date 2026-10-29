import { describe, expect, it } from 'vitest'
import {
  SIGN_SET_DIFF_SPEC,
  SIGN_SET_NORMALIZE,
  addBoard,
  addShelf,
  addSlot,
  autoSort,
  clearInvalid,
  compareText,
  countsOf,
  deleteBoard,
  deleteShelf,
  deleteSlot,
  diffSnapshots,
  emptyDraft,
  findBoard,
  hide,
  keyOf,
  moveWithin,
  newId,
  onBoard,
  passageIssues,
  passageKey,
  placeOnBoard,
  placeOnSlot,
  poolOf,
  reapplyTemplate,
  removeSchedule,
  saveWarnings,
  signSetInput,
  signSetSnapshot,
  signSetSnapshotOf,
  structureIssues,
  unhide,
  updateBoard,
  updateSlot,
  DraftError,
  type Passage,
  type RouteInfo,
  type ShelfTemplateLike,
  type SignSetDraft,
} from '../src'

const SHELF_TYPE = { id: '0190f0a0-0000-7000-8000-000000000001', name: '双立柱站架' }
const ROUTES: RouteInfo[] = [
  { id: 'r-k1-up', lineId: 'l-k1', lineName: 'K1路', kind: 'up', suspended: false, terminal: '火车站' },
  { id: 'r-k1-down', lineId: 'l-k1', lineName: 'K1路', kind: 'down', suspended: false, terminal: '北门' },
  { id: 'r-2-up', lineId: 'l-2', lineName: '2路', kind: 'up', suspended: false, terminal: '东站' },
  { id: 'r-10-up', lineId: 'l-10', lineName: '10路', kind: 'up', suspended: false, terminal: '西站' },
  { id: 'r-loop', lineId: 'l-loop', lineName: '环1路', kind: 'loop', suspended: false, terminal: '人民广场' },
  { id: 'r-gone', lineId: 'l-9', lineName: '9路', kind: 'up', suspended: true, terminal: '南站' },
]
const PASSAGES: Passage[] = [
  { routeId: 'r-k1-up', pass: 1, count: 1 },
  { routeId: 'r-k1-down', pass: 1, count: 1 },
  { routeId: 'r-2-up', pass: 1, count: 1 },
  { routeId: 'r-10-up', pass: 1, count: 1 },
  { routeId: 'r-loop', pass: 1, count: 2 },
  { routeId: 'r-loop', pass: 2, count: 2 },
]
const TEMPLATE: ShelfTemplateLike = {
  type: { id: '0190f0a0-0000-7000-8000-000000000002', name: '候车亭灯箱' },
  desc: '标准候车亭侧灯箱',
  noPhysical: false,
  boards: [
    {
      face: 'front',
      kind: 'sliced',
      width: 1500,
      height: 2000,
      remark: '',
      slots: [
        { no: 1, kind: 'route', note: '', width: 700, height: 360 },
        { no: 2, kind: 'route', note: '', width: 700, height: 360 },
        { no: 3, kind: 'other', note: '公告栏', width: 700, height: 360 },
      ],
    },
  ],
}
const p = (routeId: string, pass = 1) => ({ routeId, pass })
const info = (id: string) => ROUTES.find((r) => r.id === id)

/** 一个站架两块整版站牌（一号、二号），再加一个模板站架（三号牌，分片） */
function setup() {
  let d: SignSetDraft = emptyDraft()
  const a = addShelf(d, { type: SHELF_TYPE })
  d = a.draft
  const b1 = addBoard(d, a.shelfId)
  d = b1.draft
  const b2 = addBoard(d, a.shelfId)
  d = b2.draft
  const t = addShelf(d, { type: SHELF_TYPE, template: TEMPLATE })
  d = t.draft
  const sliced = d.shelves[1].boards[0]
  return { d, shelfId: a.shelfId, b1: b1.boardId, b2: b2.boardId, tplShelf: t.shelfId, sliced }
}
const statusOf = (d: SignSetDraft, key: string) => poolOf(d, PASSAGES, ROUTES).find((x) => x.key === key)?.status

describe('草稿结构', () => {
  it('编号自动取下一个可用值；模板生成的站牌继续编号，插片沿用模板编号', () => {
    const { d, sliced } = setup()
    expect(d.shelves.map((s) => s.no)).toEqual([1, 2])
    expect(d.shelves[0].boards.map((b) => b.no)).toEqual([1, 2])
    expect(sliced.no).toBe(3)
    expect(sliced.slots.map((s) => [s.no, s.kind])).toEqual([
      [1, 'route'],
      [2, 'route'],
      [3, 'other'],
    ])
    expect(d.shelves[1]).toMatchObject({ typeId: TEMPLATE.type.id, typeName: '候车亭灯箱', desc: '标准候车亭侧灯箱' })
    expect(structureIssues(d)).toEqual([])
  })

  it('站架编号用尽时不能再加', () => {
    let d = emptyDraft()
    for (let i = 0; i < 15; i++) d = addShelf(d, { type: SHELF_TYPE }).draft
    expect(() => addShelf(d, { type: SHELF_TYPE })).toThrow(DraftError)
  })

  it('新 ID 是 UUID', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('编排操作保持 BR-06、BR-07', () => {
  it('放到整版站牌、插片、隐藏、取消隐藏、移除', () => {
    const { d: d0, b1, b2, sliced } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnBoard(d, p('r-2-up'), b1, { index: 0 })
    expect(onBoard(d, b1).map(keyOf)).toEqual(['r-2-up#1', 'r-k1-up#1'])
    // 复制：同一途经放到另一块站牌
    d = placeOnBoard(d, p('r-k1-up'), b2)
    expect(d.schedules.filter((s) => keyOf(s) === 'r-k1-up#1')).toHaveLength(2)
    // 再放一次到同一块牌：只调整位置，不重复
    d = placeOnBoard(d, p('r-k1-up'), b1, { index: 0 })
    expect(onBoard(d, b1).map(keyOf)).toEqual(['r-k1-up#1', 'r-2-up#1'])
    expect(statusOf(d, 'r-k1-up#1')).toBe('placed')

    const r = placeOnSlot(d, p('r-10-up'), sliced.slots[0].id)
    d = r.draft
    expect(r.replaced).toBeUndefined()
    // 插片已有线路时再放一条：原线路被替换
    const r2 = placeOnSlot(d, p('r-k1-down'), sliced.slots[0].id)
    expect(r2.replaced && keyOf(r2.replaced)).toBe('r-10-up#1')
    d = r2.draft
    expect(statusOf(d, 'r-10-up#1')).toBe('waiting')
    // 同一块分片站牌上换个插片：视为移动
    d = placeOnSlot(d, p('r-k1-down'), sliced.slots[1].id).draft
    expect(d.schedules.filter((s) => keyOf(s) === 'r-k1-down#1').map((s) => s.slotId)).toEqual([sliced.slots[1].id])
    // 非线路插片不能放
    expect(() => placeOnSlot(d, p('r-10-up'), sliced.slots[2].id)).toThrow('非线路插片不能放线路')

    // 隐藏：移除全部放置
    d = hide(d, p('r-k1-up'))
    expect(d.schedules.filter((s) => keyOf(s) === 'r-k1-up#1').map((s) => s.placement)).toEqual(['hidden'])
    expect(onBoard(d, b1).map((s) => [keyOf(s), s.order])).toEqual([['r-2-up#1', 1]])
    expect(statusOf(d, 'r-k1-up#1')).toBe('hidden')
    // 从隐藏直接放到站牌：取消隐藏
    d = placeOnBoard(d, p('r-k1-up'), b2)
    expect(statusOf(d, 'r-k1-up#1')).toBe('placed')
    d = hide(d, p('r-k1-up'))
    d = unhide(d, 'r-k1-up#1')
    expect(statusOf(d, 'r-k1-up#1')).toBe('waiting')

    const id = onBoard(d, b1)[0].id
    d = removeSchedule(d, id)
    expect(statusOf(d, 'r-2-up#1')).toBe('waiting')
    expect(structureIssues(d)).toEqual([])
  })

  it('从一块牌移动到另一块牌；Alt+↑/↓ 调整顺序', () => {
    const { d: d0, b1, b2 } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnBoard(d, p('r-2-up'), b1)
    d = placeOnBoard(d, p('r-10-up'), b1)
    const from = onBoard(d, b1)[0].id
    d = placeOnBoard(d, p('r-k1-up'), b2, { moveFrom: from })
    expect(onBoard(d, b1).map((s) => [keyOf(s), s.order])).toEqual([
      ['r-2-up#1', 1],
      ['r-10-up#1', 2],
    ])
    expect(onBoard(d, b2).map(keyOf)).toEqual(['r-k1-up#1'])
    d = moveWithin(d, onBoard(d, b1)[1].id, -1)
    expect(onBoard(d, b1).map(keyOf)).toEqual(['r-10-up#1', 'r-2-up#1'])
    expect(structureIssues(d)).toEqual([])
  })
})

describe('删除结构、切换类型、重新套用模板时编排的去留', () => {
  it('删除站牌：其上编排删除；该途经在别处还有放置就保持已编排', () => {
    const { d: d0, b1, b2 } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnBoard(d, p('r-k1-up'), b2)
    d = placeOnBoard(d, p('r-2-up'), b1)
    const r = deleteBoard(d, b1)
    expect(r.dropped).toBe(2)
    expect(statusOf(r.draft, 'r-k1-up#1')).toBe('placed')
    expect(statusOf(r.draft, 'r-2-up#1')).toBe('waiting')
  })

  it('删除站架、删除插片、线路插片改成非线路插片', () => {
    const { d: d0, sliced, tplShelf, shelfId, b1 } = setup()
    let d = placeOnSlot(d0, p('r-k1-up'), sliced.slots[0].id).draft
    d = placeOnSlot(d, p('r-2-up'), sliced.slots[1].id).draft
    d = placeOnBoard(d, p('r-10-up'), b1)
    expect(updateSlot(d, sliced.slots[0].id, { kind: 'other', note: '广告' }).dropped).toBe(1)
    expect(deleteSlot(d, sliced.slots[1].id).dropped).toBe(1)
    expect(deleteShelf(d, tplShelf).dropped).toBe(2)
    expect(deleteShelf(d, shelfId).dropped).toBe(1)
  })

  it('整版切到分片：编排删除，生成 1 个与牌面同尺寸的线路插片；切回整版删除全部插片', () => {
    const { d: d0, b1 } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    const r = updateBoard(d, b1, { kind: 'sliced' })
    expect(r.dropped).toBe(1)
    const b = findBoard(r.draft, b1)!.board
    expect(b.slots).toHaveLength(1)
    expect(b.slots[0]).toMatchObject({ no: 1, kind: 'route', width: 1200, height: 1800 })
    d = addSlot(r.draft, b1).draft
    d = placeOnSlot(d, p('r-2-up'), findBoard(d, b1)!.board.slots[1].id).draft
    const back = updateBoard(d, b1, { kind: 'whole' })
    expect(back.dropped).toBe(1)
    expect(findBoard(back.draft, b1)!.board.slots).toEqual([])
  })

  it('重新套用模板：替换站架下的站牌与插片，其上编排回到待编排', () => {
    const { d: d0, shelfId, b1, b2 } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnBoard(d, p('r-2-up'), b2)
    const r = reapplyTemplate(d, shelfId, TEMPLATE)
    expect(r.dropped).toBe(2)
    expect(r.draft.shelves[0].boards).toHaveLength(1)
    expect(r.draft.shelves[0].boards[0].no).toBe(1)
    expect(r.draft.shelves[0].typeName).toBe('候车亭灯箱')
    expect(statusOf(r.draft, 'r-k1-up#1')).toBe('waiting')
    expect(structureIssues(r.draft)).toEqual([])
  })
})

describe('poolOf 编排状态', () => {
  it('四种状态，环线两次途经各一条（AC-08），按自动排序规则排列', () => {
    const { d: d0, b1 } = setup()
    let d = placeOnBoard(d0, p('r-loop', 2), b1)
    d = hide(d, p('r-2-up'))
    // 失效：编排引用的途经已不是当前途经（停运线路、少经过一次）
    d = placeOnBoard(d, p('r-gone'), b1)
    d = placeOnBoard(d, p('r-k1-up', 2), b1)
    const pool = poolOf(d, PASSAGES, ROUTES)
    expect(pool.map((x) => [x.key, x.status])).toEqual([
      ['r-2-up#1', 'hidden'],
      ['r-gone#1', 'invalid'],
      ['r-10-up#1', 'waiting'],
      ['r-loop#1', 'waiting'],
      ['r-loop#2', 'placed'],
      ['r-k1-up#1', 'waiting'],
      ['r-k1-up#2', 'invalid'],
      ['r-k1-down#1', 'waiting'],
    ])
    expect(pool.find((x) => x.key === 'r-loop#1')).toMatchObject({ count: 2, lineName: '环1路', terminal: '人民广场' })
    expect(countsOf(pool)).toEqual({ waiting: 4, placed: 1, hidden: 1, invalid: 2 })
  })

  it('走向重新经过本站时，失效编排自动恢复', () => {
    const { d: d0, b1 } = setup()
    const d = placeOnBoard(d0, p('r-gone'), b1)
    expect(statusOf(d, 'r-gone#1')).toBe('invalid')
    const pool = poolOf(d, [...PASSAGES, { routeId: 'r-gone', pass: 1, count: 1 }], ROUTES)
    expect(pool.find((x) => x.key === 'r-gone#1')?.status).toBe('placed')
  })
})

describe('自动排序（AC-15）', () => {
  it('按线路名、走向、第几次途经排序，失效编排一起排序、不删除', () => {
    const { d: d0, b1 } = setup()
    let d = d0
    for (const [r, n] of [
      ['r-k1-down', 1],
      ['r-loop', 2],
      ['r-gone', 1],
      ['r-k1-up', 1],
      ['r-10-up', 1],
      ['r-loop', 1],
      ['r-2-up', 1],
    ] as const)
      d = placeOnBoard(d, p(r, n), b1)
    d = autoSort(d, b1, info)
    expect(onBoard(d, b1).map((s) => [keyOf(s), s.order])).toEqual([
      ['r-2-up#1', 1],
      ['r-gone#1', 2],
      ['r-10-up#1', 3],
      ['r-loop#1', 4],
      ['r-loop#2', 5],
      ['r-k1-up#1', 6],
      ['r-k1-down#1', 7],
    ])
    d = clearInvalid(d, ['r-gone#1'])
    expect(onBoard(d, b1).map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('保存校验', () => {
  it('结构规则：编号重复、整版站牌带插片、非线路插片缺说明、隐藏与放置并存、插片放两条', () => {
    const { d: d0, b1, b2, sliced } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnSlot(d, p('r-2-up'), sliced.slots[0].id).draft
    d.shelves[0].boards[1].no = 1
    d.shelves[0].boards[0].slots = [{ id: newId(), no: 1, kind: 'route', note: '', width: 1, height: 1 }]
    d.shelves[1].boards[0].slots[2].note = ''
    d.schedules.push({ ...d.schedules[0], id: newId(), placement: 'hidden', boardId: null, order: null })
    d.schedules.push({ ...d.schedules[1], id: newId(), routeId: 'r-10-up' })
    const msgs = structureIssues(d).map((i) => i.message)
    expect(msgs).toEqual(
      expect.arrayContaining([
        '站牌编号重复：一号牌',
        '一号牌是整版站牌，不能有插片',
        '三号牌 3号插片是非线路插片，要写说明',
        '三号牌 1号插片只能放一条线路',
        'r-k1-up#1不能同时隐藏和放在站牌上',
      ]),
    )
    expect(b2).toBeTruthy()
  })

  it('zod 输入模式带上结构规则', () => {
    const { d } = setup()
    const input = { rev: 1, reminder: '', shelves: d.shelves, schedules: [] }
    expect(signSetInput.safeParse(input).success).toBe(true)
    const bad = structuredClone(input)
    bad.shelves[0].boards[0].width = 0
    bad.shelves[1].no = 1
    const r = signSetInput.safeParse(bad)
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['应为正整数（毫米）', '站架编号重复：一号架']),
    )
  })

  it('失效编排只能留在原位；新放置的途经必须是当前途经', () => {
    const { d: d0, b1, b2 } = setup()
    const before = placeOnBoard(d0, p('r-gone'), b1)
    const live = new Set(PASSAGES.map((x) => passageKey(x.routeId, x.pass)))
    const label = (r: string, n: number) => `${info(r)?.lineName} 第${n}次`
    const opts = { live, before: before.schedules, label }
    // 原样保留、排序：通过
    expect(passageIssues(placeOnBoard(before, p('r-k1-up'), b1, { index: 0 }), opts)).toEqual([])
    // 移到别的站牌、复制、隐藏：拒绝
    for (const d of [
      placeOnBoard(before, p('r-gone'), b2, { moveFrom: before.schedules[0].id }),
      placeOnBoard(before, p('r-gone'), b2),
      hide(before, p('r-gone')),
    ])
      expect(passageIssues(d, opts)[0].message).toContain('失效编排只能保留原位')
    // 编辑期间线路刚停运：新放置被拒
    const fresh = placeOnBoard(d0, p('r-gone'), b1)
    expect(passageIssues(fresh, { ...opts, before: [] })[0].message).toBe(
      '9路 第1次已不经过本站（可能刚停运或改了站序），请刷新后重新编排',
    )
  })

  it('保存前提示：分片站牌没有线路插片、站架下没有站牌', () => {
    const { d: d0, sliced } = setup()
    let d = addShelf(d0, { type: SHELF_TYPE }).draft
    d = updateSlot(d, sliced.slots[0].id, { kind: 'other', note: 'a' }).draft
    d = updateSlot(d, sliced.slots[1].id, { kind: 'other', note: 'b' }).draft
    expect(saveWarnings(d)).toEqual(['三号牌是分片站牌，但没有线路插片', '三号架下没有站牌'])
  })
})

describe('站牌集快照', () => {
  const stop = { id: 'stop-1', name: '人民广场（东）' }
  const routeName = (id: string) => {
    const r = info(id)!
    return `${r.lineName} ${r.kind === 'up' ? '上行' : r.kind === 'down' ? '下行' : '环线'}`
  }

  it('空站牌集：新构造函数生成的内容，与 M1 存的空快照哈希相同', () => {
    const m1 = { schema: 1, stop: { id: stop.id, name: stop.name }, reminder: '', shelves: [], schedules: [] }
    // M1 的站牌集规范化选项是 {}
    expect(compareText(signSetSnapshotOf(stop, emptyDraft(), routeName), SIGN_SET_NORMALIZE)).toBe(compareText(m1, {}))
    expect(compareText(signSetSnapshot(stop), SIGN_SET_NORMALIZE)).toBe(compareText(m1, {}))
  })

  it('线路改名、站点改名、站架类型改名、编排顺序（数组顺序）变化都不改变哈希', () => {
    const { d: d0, b1, sliced } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b1)
    d = placeOnBoard(d, p('r-2-up'), b1)
    d = placeOnSlot(d, p('r-k1-up'), sliced.slots[0].id).draft
    d = hide(d, p('r-10-up'))
    const a = compareText(signSetSnapshotOf(stop, d, routeName), SIGN_SET_NORMALIZE)
    const shuffled = { ...d, schedules: [...d.schedules].reverse() }
    shuffled.shelves = shuffled.shelves.map((s) => ({ ...s, typeName: s.typeName + '（新名）' }))
    const b = compareText(
      signSetSnapshotOf({ ...stop, name: '人民广场站（东）' }, shuffled, (id) => `新${routeName(id)}`),
      SIGN_SET_NORMALIZE,
    )
    expect(b).toBe(a)
    // 真实修改：整版站牌内顺序调换
    const moved = moveWithin(d, onBoard(d, b1)[1].id, -1)
    expect(compareText(signSetSnapshotOf(stop, moved, routeName), SIGN_SET_NORMALIZE)).not.toBe(a)
  })

  it('编排按途经归组、按 id 排序，放置位置是集合', () => {
    const { d: d0, b1, b2 } = setup()
    let d = placeOnBoard(d0, p('r-k1-up'), b2)
    d = placeOnBoard(d, p('r-k1-up'), b1)
    d = hide(d, p('r-2-up'))
    const s = signSetSnapshotOf(stop, d, routeName)
    expect(s.schedules.map((x) => [x.id, x.hidden, x.places.length])).toEqual([
      ['r-2-up#1', true, 0],
      ['r-k1-up#1', false, 2],
    ])
    expect(s.schedules[1].route).toEqual({ id: 'r-k1-up', name: 'K1路 上行' })
  })

  it('差异：站架只比较自身字段，站牌从各站架摊平，编排按"K1路 上行（第 2 次）"显示', () => {
    const { d: d0, b1, sliced } = setup()
    const prev = signSetSnapshotOf(stop, d0, routeName)
    let d = placeOnBoard(d0, p('r-loop', 2), b1)
    d = placeOnBoard(d, p('r-k1-up'), b1)
    d.shelves[0].name = '主站架'
    d = updateSlot(d, sliced.slots[0].id, { width: 650 }).draft
    d = deleteBoard(d, d.shelves[0].boards[1].id).draft
    d.reminder = '夜1路暂停'
    const next = signSetSnapshotOf(stop, d, routeName)
    const diff = diffSnapshots(prev, next, SIGN_SET_DIFF_SPEC)
    expect(diff).toEqual([
      { kind: 'value', label: '温馨提示', from: '', to: '夜1路暂停' },
      { kind: 'items', label: '站架', items: [{ op: 'changed', label: '一号架 · 双立柱站架' }] },
      {
        kind: 'items',
        label: '站牌',
        items: [
          { op: 'removed', label: '二号牌' },
          { op: 'changed', label: '三号牌' },
        ],
      },
      {
        kind: 'items',
        label: '线路编排',
        items: [
          { op: 'added', label: 'K1路 上行' },
          { op: 'added', label: '环1路 环线（第 2 次）' },
        ],
      },
    ])
  })
})
