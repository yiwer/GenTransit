// 站牌集（M3 计划第 2、3.3、4.2 节）：结构与编排的草稿模型（纯函数）、编排状态、自动排序、保存校验、快照
import { cnNum, compareLineName } from './domain'
import { ROUTE_KIND_LABEL, ROUTE_KINDS, type ObjectType, type RouteKind, type SnapshotAction } from './enums'
import type { DiffField, NormalizeOptions } from './snapshot'
import type { Ref, Upload } from './types'

/* ---------------- 枚举 ---------------- */

export const BOARD_FACES = ['front', 'back', 'A', 'B', 'C', 'D', 'E', 'F'] as const
export type BoardFace = (typeof BOARD_FACES)[number]
export const BOARD_FACE_LABEL: Record<BoardFace, string> = {
  front: '正面',
  back: '背面',
  A: 'A面',
  B: 'B面',
  C: 'C面',
  D: 'D面',
  E: 'E面',
  F: 'F面',
}

export const BOARD_KINDS = ['whole', 'sliced'] as const
export type BoardKind = (typeof BOARD_KINDS)[number]
export const BOARD_KIND_LABEL: Record<BoardKind, string> = { whole: '整版', sliced: '分片' }

export const SLOT_KINDS = ['route', 'other'] as const
export type SlotKind = (typeof SLOT_KINDS)[number]
export const SLOT_KIND_LABEL: Record<SlotKind, string> = { route: '线路插片', other: '非线路插片' }

export const PLACEMENTS = ['board', 'slot', 'hidden'] as const
export type Placement = (typeof PLACEMENTS)[number]
export const PLACEMENT_LABEL: Record<Placement, string> = { board: '站牌', slot: '插片', hidden: '隐藏' }

export const SCHEDULE_STATUSES = ['waiting', 'placed', 'hidden', 'invalid'] as const
export type ScheduleStatusKey = (typeof SCHEDULE_STATUSES)[number]
export const SCHEDULE_STATUS_LABEL = {
  waiting: '待编排',
  placed: '已编排',
  hidden: '隐藏',
  invalid: '失效',
} as const satisfies Record<ScheduleStatusKey, string>

export const SHELF_NO_MAX = 15
export const BOARD_NO_MAX = 90
export const SLOT_NO_MAX = 99
/** 站牌、插片宽高上限（毫米，默认决定 2） */
export const SIZE_MAX_MM = 10000
export const REMINDER_MAX = 1000

export const shelfLabel = (no: number) => `${cnNum(no)}号架`
export const boardLabel = (no: number) => `${cnNum(no)}号牌`
export const slotLabel = (no: number) => `${no}号插片`

/* ---------------- 草稿 ---------------- */

export interface SlotDraft {
  id: string
  no: number
  kind: SlotKind
  note: string
  width: number
  height: number
}

export interface BoardDraft {
  id: string
  no: number
  face: BoardFace
  kind: BoardKind
  width: number
  height: number
  remark: string
  slots: SlotDraft[]
}

export interface ShelfDraft {
  id: string
  no: number
  typeId: string
  /** 站架类型名称（显示用；保存时只提交 typeId） */
  typeName: string
  name: string
  desc: string
  noPhysical: boolean
  material: string
  boards: BoardDraft[]
}

/** 一条线路编排：放在整版站牌（带顺序）、线路插片上，或隐藏 */
export interface ScheduleDraft {
  id: string
  routeId: string
  pass: number
  placement: Placement
  /** 放在插片上时同时记下插片所在的站牌 */
  boardId: string | null
  slotId: string | null
  /** 整版站牌内的顺序，从 1 起 */
  order: number | null
}

export interface SignSetDraft {
  reminder: string
  shelves: ShelfDraft[]
  schedules: ScheduleDraft[]
}

export type ScheduleLike = Omit<ScheduleDraft, 'id'>

/** 途经的键：走向 ID + 第几次途经（BR-05） */
export const passageKey = (routeId: string, pass: number) => `${routeId}#${pass}`
export const keyOf = (s: { routeId: string; pass: number }) => passageKey(s.routeId, s.pass)

/** 新节点 ID：前端生成，已有节点沿用原 ID（默认决定 8）。非安全上下文没有 randomUUID，退回 getRandomValues */
export function newId(): string {
  const c = (
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string; getRandomValues: (a: Uint8Array) => Uint8Array }
    }
  ).crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** 草稿操作违反规则（例如编号用尽）：界面提示 message */
export class DraftError extends Error {}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

export const emptyDraft = (): SignSetDraft => ({ reminder: '', shelves: [], schedules: [] })

export const allBoards = (d: Pick<SignSetDraft, 'shelves'>) =>
  d.shelves.flatMap((shelf) => shelf.boards.map((board) => ({ shelf, board })))
export const allSlots = (d: Pick<SignSetDraft, 'shelves'>) =>
  allBoards(d).flatMap(({ shelf, board }) => board.slots.map((slot) => ({ shelf, board, slot })))
export const findShelf = (d: Pick<SignSetDraft, 'shelves'>, id: string) => d.shelves.find((s) => s.id === id)
export const findBoard = (d: Pick<SignSetDraft, 'shelves'>, id: string) => allBoards(d).find((x) => x.board.id === id)
export const findSlot = (d: Pick<SignSetDraft, 'shelves'>, id: string) => allSlots(d).find((x) => x.slot.id === id)

/** 整版站牌上的编排，按顺序 */
export const onBoard = (d: Pick<SignSetDraft, 'schedules'>, boardId: string) =>
  d.schedules
    .filter((s) => s.placement === 'board' && s.boardId === boardId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
export const inSlot = (d: Pick<SignSetDraft, 'schedules'>, slotId: string) =>
  d.schedules.find((s) => s.placement === 'slot' && s.slotId === slotId)

/** 整版站牌内顺序重排为 1…n */
function renumber(d: SignSetDraft) {
  for (const { board } of allBoards(d)) onBoard(d, board.id).forEach((s, i) => (s.order = i + 1))
}

const withoutKey = (d: SignSetDraft, key: string, pred: (s: ScheduleDraft) => boolean) =>
  d.schedules.filter((s) => !(keyOf(s) === key && pred(s)))

export interface PassageRef {
  routeId: string
  pass: number
}

/* ---------------- 编排操作（BR-06、BR-07） ---------------- */

/**
 * 放到整版站牌。index：插入位置（缺省放到末尾）；该途经已在这块牌上则只调整位置。
 * moveFrom：从另一处编排移动过来（移除原处）
 */
export function placeOnBoard(
  src: SignSetDraft,
  p: PassageRef,
  boardId: string,
  opts: { index?: number; moveFrom?: string } = {},
): SignSetDraft {
  const d = clone(src)
  const f = findBoard(d, boardId)
  if (!f) throw new DraftError('站牌不存在')
  if (f.board.kind !== 'whole') throw new DraftError('分片站牌的线路要放进插片里')
  const key = passageKey(p.routeId, p.pass)
  d.schedules = withoutKey(d, key, (s) => s.placement === 'hidden')
  const from = opts.moveFrom ? d.schedules.find((s) => s.id === opts.moveFrom) : undefined
  if (from && !(from.placement === 'board' && from.boardId === boardId))
    d.schedules = d.schedules.filter((s) => s !== from)
  const list = onBoard(d, boardId)
  const existing = list.find((s) => keyOf(s) === key)
  const others = list.filter((s) => s !== existing)
  const target: ScheduleDraft = existing ?? {
    id: newId(),
    routeId: p.routeId,
    pass: p.pass,
    placement: 'board',
    boardId,
    slotId: null,
    order: 0,
  }
  if (!existing) d.schedules.push(target)
  const at = opts.index === undefined ? others.length : Math.max(0, Math.min(opts.index, others.length))
  others.splice(at, 0, target)
  others.forEach((s, i) => (s.order = i + 1))
  renumber(d)
  return d
}

/**
 * 放到线路插片。插片已有别的线路时，原线路被替换（回到待编排或别处的放置）；
 * 同一块站牌上已有这条途经时视为在站牌内移动（同一块站牌最多一次）
 */
export function placeOnSlot(
  src: SignSetDraft,
  p: PassageRef,
  slotId: string,
  opts: { moveFrom?: string } = {},
): { draft: SignSetDraft; replaced?: ScheduleDraft } {
  const d = clone(src)
  const f = findSlot(d, slotId)
  if (!f) throw new DraftError('插片不存在')
  if (f.slot.kind !== 'route') throw new DraftError('非线路插片不能放线路')
  const key = passageKey(p.routeId, p.pass)
  const old = inSlot(d, slotId)
  if (old && keyOf(old) === key) return { draft: src }
  d.schedules = withoutKey(d, key, (s) => s.placement === 'hidden' || s.boardId === f.board.id)
  if (opts.moveFrom) d.schedules = d.schedules.filter((s) => s.id !== opts.moveFrom)
  if (old) d.schedules = d.schedules.filter((s) => s.id !== old.id)
  d.schedules.push({
    id: newId(),
    routeId: p.routeId,
    pass: p.pass,
    placement: 'slot',
    boardId: f.board.id,
    slotId,
    order: null,
  })
  renumber(d)
  return { draft: d, replaced: old }
}

/** 隐藏：同时移除该途经在本站的全部放置 */
export function hide(src: SignSetDraft, p: PassageRef): SignSetDraft {
  const d = clone(src)
  const key = passageKey(p.routeId, p.pass)
  d.schedules = withoutKey(d, key, () => true)
  d.schedules.push({
    id: newId(),
    routeId: p.routeId,
    pass: p.pass,
    placement: 'hidden',
    boardId: null,
    slotId: null,
    order: null,
  })
  renumber(d)
  return d
}

export function unhide(src: SignSetDraft, key: string): SignSetDraft {
  const d = clone(src)
  d.schedules = withoutKey(d, key, (s) => s.placement === 'hidden')
  return d
}

export function removeSchedule(src: SignSetDraft, scheduleId: string): SignSetDraft {
  const d = clone(src)
  d.schedules = d.schedules.filter((s) => s.id !== scheduleId)
  renumber(d)
  return d
}

/** 移除一条途经在本站的全部编排 */
export function removeKey(src: SignSetDraft, key: string): SignSetDraft {
  const d = clone(src)
  d.schedules = withoutKey(d, key, () => true)
  renumber(d)
  return d
}

/** 一键清理失效编排 */
export function clearInvalid(src: SignSetDraft, invalidKeys: string[]): SignSetDraft {
  const keys = new Set(invalidKeys)
  const d = clone(src)
  d.schedules = d.schedules.filter((s) => !keys.has(keyOf(s)))
  renumber(d)
  return d
}

/** 整版站牌内按给定 ID 顺序排列 */
export function reorder(src: SignSetDraft, boardId: string, ids: string[]): SignSetDraft {
  const d = clone(src)
  const list = onBoard(d, boardId)
  const pos = new Map(ids.map((id, i) => [id, i]))
  list.sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
  list.forEach((s, i) => (s.order = i + 1))
  return d
}

/** 整版站牌内上移、下移一位（Alt+↑/↓） */
export function moveWithin(src: SignSetDraft, scheduleId: string, delta: number): SignSetDraft {
  const s = src.schedules.find((x) => x.id === scheduleId)
  if (!s || s.placement !== 'board' || !s.boardId) return src
  const ids = onBoard(src, s.boardId).map((x) => x.id)
  const i = ids.indexOf(scheduleId)
  const j = Math.max(0, Math.min(ids.length - 1, i + delta))
  if (i === j) return src
  ids.splice(i, 1)
  ids.splice(j, 0, scheduleId)
  return reorder(src, s.boardId, ids)
}

/* ---------------- 途经、状态与排序 ---------------- */

/** 走向的显示信息（含停运线路与失效编排引用的走向） */
export interface RouteInfo {
  id: string
  lineId: string
  lineName: string
  kind: RouteKind
  suspended: boolean
  /** 终点站名（走向末站） */
  terminal: string
}

/** 本站当前的一次途经：运营中线路的走向，在站序中第 pass 次经过本站；count 为本走向经过本站的总次数 */
export interface Passage {
  routeId: string
  pass: number
  count: number
}

export interface PoolItem {
  key: string
  routeId: string
  pass: number
  count: number
  lineId: string
  lineName: string
  kind: RouteKind
  terminal: string
  suspended: boolean
  status: ScheduleStatusKey
  schedules: ScheduleDraft[]
}

export const routeLabel = (r: { lineName: string; kind: RouteKind }) => `${r.lineName} ${ROUTE_KIND_LABEL[r.kind]}`

/** "K1路 上行"；同一走向多次经过本站时加"（第 2 次）" */
export const passageLabel = (r: { lineName: string; kind: RouteKind; pass: number; count?: number }) =>
  (r.count ?? 1) > 1 || r.pass > 1 ? `${routeLabel(r)}（第 ${r.pass} 次）` : routeLabel(r)

const kindRank = (k: RouteKind) => ROUTE_KINDS.indexOf(k)

/** 自动排序规则（2.4）：线路名（5.5.6）→ 走向（上行、下行、内环、外环、单向、环线）→ 第几次途经 */
export function comparePassages(
  a: { lineName: string; kind: RouteKind; pass: number },
  b: { lineName: string; kind: RouteKind; pass: number },
) {
  return compareLineName(a.lineName, b.lineName) || kindRank(a.kind) - kindRank(b.kind) || a.pass - b.pass
}

/**
 * 编排状态（需求 5.5.2，BR-08）：
 * 已编排 = 有放置且途经仍存在；隐藏 = 有隐藏且途经仍存在；待编排 = 途经存在但没有编排；
 * 失效 = 有编排但（走向，第几次途经）已不是当前途经
 */
export function poolOf(d: Pick<SignSetDraft, 'schedules'>, passages: Passage[], routes: RouteInfo[]): PoolItem[] {
  const routeOf = new Map(routes.map((r) => [r.id, r]))
  const byKey = new Map<string, ScheduleDraft[]>()
  for (const s of d.schedules) byKey.set(keyOf(s), [...(byKey.get(keyOf(s)) ?? []), s])
  const item = (
    routeId: string,
    pass: number,
    count: number,
    status: ScheduleStatusKey,
    schedules: ScheduleDraft[],
  ) => {
    const r = routeOf.get(routeId)
    return {
      key: passageKey(routeId, pass),
      routeId,
      pass,
      count,
      lineId: r?.lineId ?? '',
      lineName: r?.lineName ?? '（已删除的线路）',
      kind: r?.kind ?? 'oneway',
      terminal: r?.terminal ?? '',
      suspended: r?.suspended ?? false,
      status,
      schedules,
    }
  }
  const live = new Set<string>()
  const items: PoolItem[] = passages.map((p) => {
    const key = passageKey(p.routeId, p.pass)
    live.add(key)
    const sch = byKey.get(key) ?? []
    const status = sch.length === 0 ? 'waiting' : sch.some((s) => s.placement === 'hidden') ? 'hidden' : 'placed'
    return item(p.routeId, p.pass, p.count, status, sch)
  })
  for (const [key, sch] of byKey) if (!live.has(key)) items.push(item(sch[0].routeId, sch[0].pass, 1, 'invalid', sch))
  return items.sort(comparePassages)
}

export interface SignSetCounts {
  waiting: number
  placed: number
  hidden: number
  invalid: number
}

export function countsOf(pool: Pick<PoolItem, 'status'>[]): SignSetCounts {
  const c: SignSetCounts = { waiting: 0, placed: 0, hidden: 0, invalid: 0 }
  for (const p of pool) c[p.status]++
  return c
}

/** 整版站牌自动排序（AC-15）：只调整顺序，失效编排一起排序、不删除（BR-15） */
export function autoSort(
  src: SignSetDraft,
  boardId: string,
  info: (routeId: string) => { lineName: string; kind: RouteKind } | undefined,
): SignSetDraft {
  const fallback = { lineName: '', kind: 'oneway' as RouteKind }
  const ids = onBoard(src, boardId)
    .map((s) => ({ ...(info(s.routeId) ?? fallback), id: s.id, pass: s.pass }))
    .sort(comparePassages)
    .map((x) => x.id)
  return reorder(src, boardId, ids)
}

/* ---------------- 结构操作（第 2.2 节） ---------------- */

const nextNo = (used: number[], max: number) => {
  for (let i = 1; i <= max; i++) if (!used.includes(i)) return i
  return null
}
const usedBoardNos = (d: SignSetDraft) => allBoards(d).map((x) => x.board.no)

/** 去掉这些站牌（及其插片）上的编排，返回去掉的条数 */
function dropPlacementsOf(d: SignSetDraft, boardIds: string[]) {
  const ids = new Set(boardIds)
  const before = d.schedules.length
  d.schedules = d.schedules.filter((s) => !(s.boardId && ids.has(s.boardId)))
  return before - d.schedules.length
}

export interface TemplateSlot {
  no: number
  kind: SlotKind
  note: string
  width: number
  height: number
}

export interface TemplateBoard {
  face: BoardFace
  kind: BoardKind
  width: number
  height: number
  remark: string
  slots: TemplateSlot[]
}

export interface ShelfTemplateLike {
  type: Ref
  desc: string
  noPhysical: boolean
  boards: TemplateBoard[]
}

/** 按模板生成站牌：编号取下一个可用值，ID 新生成；站架和模板之间不保留关联（BR-14） */
function boardsFromTemplate(d: SignSetDraft, t: ShelfTemplateLike): BoardDraft[] {
  const used = usedBoardNos(d)
  return t.boards.map((b) => {
    const no = nextNo(used, BOARD_NO_MAX)
    if (no === null) throw new DraftError(`站牌编号 1–${BOARD_NO_MAX} 已用完，放不下这个模板的站牌`)
    used.push(no)
    return {
      id: newId(),
      no,
      face: b.face,
      kind: b.kind,
      width: b.width,
      height: b.height,
      remark: b.remark,
      slots: b.kind === 'sliced' ? b.slots.map((s) => ({ ...s, id: newId() })) : [],
    }
  })
}

/** 添加站架：空白（type 为站架类型），或从模板生成 */
export function addShelf(
  src: SignSetDraft,
  opts: { type: Ref; template?: ShelfTemplateLike },
): { draft: SignSetDraft; shelfId: string } {
  const d = clone(src)
  const no = nextNo(
    d.shelves.map((s) => s.no),
    SHELF_NO_MAX,
  )
  if (no === null) throw new DraftError(`站架编号 1–${SHELF_NO_MAX} 已用完，不能再添加站架`)
  const t = opts.template
  const type = t?.type ?? opts.type
  const shelf: ShelfDraft = {
    id: newId(),
    no,
    typeId: type.id,
    typeName: type.name,
    name: '',
    desc: t?.desc ?? '',
    noPhysical: t?.noPhysical ?? false,
    material: '',
    boards: t ? boardsFromTemplate(d, t) : [],
  }
  d.shelves.push(shelf)
  return { draft: d, shelfId: shelf.id }
}

/** 重新套用模板：替换站架下的站牌与插片（站架类型随模板），其上编排删除 */
export function reapplyTemplate(
  src: SignSetDraft,
  shelfId: string,
  t: ShelfTemplateLike,
): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const shelf = findShelf(d, shelfId)
  if (!shelf) throw new DraftError('站架不存在')
  const dropped = dropPlacementsOf(
    d,
    shelf.boards.map((b) => b.id),
  )
  shelf.boards = []
  shelf.boards = boardsFromTemplate(d, t)
  shelf.typeId = t.type.id
  shelf.typeName = t.type.name
  return { draft: d, dropped }
}

/** 站架上的编排条数（重新套用、删除前的确认文案用） */
export const placementsOnShelf = (d: SignSetDraft, shelfId: string) => {
  const ids = new Set(findShelf(d, shelfId)?.boards.map((b) => b.id) ?? [])
  return d.schedules.filter((s) => s.boardId && ids.has(s.boardId)).length
}

export const placementsOnBoard = (d: SignSetDraft, boardId: string) =>
  d.schedules.filter((s) => s.boardId === boardId).length

export function deleteShelf(src: SignSetDraft, shelfId: string): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const shelf = findShelf(d, shelfId)
  if (!shelf) return { draft: src, dropped: 0 }
  const dropped = dropPlacementsOf(
    d,
    shelf.boards.map((b) => b.id),
  )
  d.shelves = d.shelves.filter((s) => s.id !== shelfId)
  return { draft: d, dropped }
}

export type ShelfPatch = Partial<
  Pick<ShelfDraft, 'no' | 'typeId' | 'typeName' | 'name' | 'desc' | 'noPhysical' | 'material'>
>

export function updateShelf(src: SignSetDraft, shelfId: string, patch: ShelfPatch): SignSetDraft {
  const d = clone(src)
  const shelf = findShelf(d, shelfId)
  if (!shelf) return src
  if (patch.no !== undefined && patch.no !== shelf.no && d.shelves.some((s) => s.no === patch.no))
    throw new DraftError(`${shelfLabel(patch.no)}已被占用`)
  Object.assign(shelf, patch)
  return d
}

/** 站架内调整站架在立面上的位置（从左到右） */
export function moveShelf(src: SignSetDraft, shelfId: string, delta: number): SignSetDraft {
  const i = src.shelves.findIndex((s) => s.id === shelfId)
  const j = Math.max(0, Math.min(src.shelves.length - 1, i + delta))
  if (i < 0 || i === j) return src
  const d = clone(src)
  const [s] = d.shelves.splice(i, 1)
  d.shelves.splice(j, 0, s)
  return d
}

export function addBoard(src: SignSetDraft, shelfId: string): { draft: SignSetDraft; boardId: string } {
  const d = clone(src)
  const shelf = findShelf(d, shelfId)
  if (!shelf) throw new DraftError('站架不存在')
  const no = nextNo(usedBoardNos(d), BOARD_NO_MAX)
  if (no === null) throw new DraftError(`站牌编号 1–${BOARD_NO_MAX} 已用完，不能再添加站牌`)
  const b: BoardDraft = {
    id: newId(),
    no,
    face: 'front',
    kind: 'whole',
    width: 1200,
    height: 1800,
    remark: '',
    slots: [],
  }
  shelf.boards.push(b)
  return { draft: d, boardId: b.id }
}

export function deleteBoard(src: SignSetDraft, boardId: string): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const f = findBoard(d, boardId)
  if (!f) return { draft: src, dropped: 0 }
  const dropped = dropPlacementsOf(d, [boardId])
  f.shelf.boards = f.shelf.boards.filter((b) => b.id !== boardId)
  return { draft: d, dropped }
}

export type BoardPatch = Partial<Pick<BoardDraft, 'no' | 'face' | 'kind' | 'width' | 'height' | 'remark'>>

/**
 * 修改站牌。整版与分片切换时其上编排删除；切到分片生成 1 个与牌面同尺寸的线路插片（默认决定 3），
 * 切到整版删除全部插片
 */
export function updateBoard(
  src: SignSetDraft,
  boardId: string,
  patch: BoardPatch,
): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const f = findBoard(d, boardId)
  if (!f) return { draft: src, dropped: 0 }
  const b = f.board
  if (patch.no !== undefined && patch.no !== b.no && usedBoardNos(d).includes(patch.no))
    throw new DraftError(`${boardLabel(patch.no)}已被占用`)
  let dropped = 0
  const switching = patch.kind !== undefined && patch.kind !== b.kind
  Object.assign(b, patch)
  if (switching) {
    dropped = dropPlacementsOf(d, [boardId])
    b.slots =
      b.kind === 'sliced' ? [{ id: newId(), no: 1, kind: 'route', note: '', width: b.width, height: b.height }] : []
  }
  return { draft: d, dropped }
}

/** 站架内调整站牌位置 */
export function moveBoard(src: SignSetDraft, boardId: string, delta: number): SignSetDraft {
  const f = findBoard(src, boardId)
  if (!f) return src
  const i = f.shelf.boards.findIndex((b) => b.id === boardId)
  const j = Math.max(0, Math.min(f.shelf.boards.length - 1, i + delta))
  if (i === j) return src
  const d = clone(src)
  const shelf = findShelf(d, f.shelf.id)!
  const [b] = shelf.boards.splice(i, 1)
  shelf.boards.splice(j, 0, b)
  return d
}

export function addSlot(src: SignSetDraft, boardId: string): { draft: SignSetDraft; slotId: string } {
  const d = clone(src)
  const f = findBoard(d, boardId)
  if (!f) throw new DraftError('站牌不存在')
  if (f.board.kind !== 'sliced') throw new DraftError('整版站牌没有插片，先改为分片站牌')
  const no = nextNo(
    f.board.slots.map((s) => s.no),
    SLOT_NO_MAX,
  )
  if (no === null) throw new DraftError(`插片编号 1–${SLOT_NO_MAX} 已用完`)
  const last = f.board.slots.at(-1)
  const slot: SlotDraft = {
    id: newId(),
    no,
    kind: 'route',
    note: '',
    width: last?.width ?? f.board.width,
    height: last?.height ?? Math.min(f.board.height, 360),
  }
  f.board.slots.push(slot)
  return { draft: d, slotId: slot.id }
}

export type SlotPatch = Partial<Pick<SlotDraft, 'no' | 'kind' | 'note' | 'width' | 'height'>>

/** 修改插片；线路插片改成非线路插片时，插片上的编排删除 */
export function updateSlot(
  src: SignSetDraft,
  slotId: string,
  patch: SlotPatch,
): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const f = findSlot(d, slotId)
  if (!f) return { draft: src, dropped: 0 }
  if (patch.no !== undefined && patch.no !== f.slot.no && f.board.slots.some((s) => s.no === patch.no))
    throw new DraftError(`${boardLabel(f.board.no)}已有${slotLabel(patch.no)}`)
  let dropped = 0
  if (patch.kind === 'other' && f.slot.kind === 'route') {
    const before = d.schedules.length
    d.schedules = d.schedules.filter((s) => s.slotId !== slotId)
    dropped = before - d.schedules.length
  }
  Object.assign(f.slot, patch)
  return { draft: d, dropped }
}

export function deleteSlot(src: SignSetDraft, slotId: string): { draft: SignSetDraft; dropped: number } {
  const d = clone(src)
  const f = findSlot(d, slotId)
  if (!f) return { draft: src, dropped: 0 }
  const before = d.schedules.length
  d.schedules = d.schedules.filter((s) => s.slotId !== slotId)
  f.board.slots = f.board.slots.filter((s) => s.id !== slotId)
  return { draft: d, dropped: before - d.schedules.length }
}

/** "放到…""复制到…"菜单的可选目标：整版站牌与线路插片 */
export interface PlaceTarget {
  kind: 'board' | 'slot'
  id: string
  board: BoardDraft
  shelf: ShelfDraft
  slot?: SlotDraft
  /** 插片里已有的编排 */
  occupant?: ScheduleDraft
}

export function placeTargets(d: SignSetDraft): PlaceTarget[] {
  return allBoards(d).flatMap(({ shelf, board }): PlaceTarget[] =>
    board.kind === 'whole'
      ? [{ kind: 'board', id: board.id, board, shelf }]
      : board.slots
          .filter((s) => s.kind === 'route')
          .map((slot) => ({ kind: 'slot', id: slot.id, board, shelf, slot, occupant: inSlot(d, slot.id) })),
  )
}

/** 某块分片站牌上第一个空的线路插片 */
export const firstEmptySlot = (d: SignSetDraft, boardId: string) =>
  findBoard(d, boardId)?.board.slots.find((sl) => sl.kind === 'route' && !inSlot(d, sl.id))

/* ---------------- 校验 ---------------- */

export interface SignSetIssue {
  path: string
  message: string
}

type StructureInput = {
  shelves: (Pick<ShelfDraft, 'id' | 'no'> & { boards: BoardDraft[] })[]
  schedules: ScheduleLike[]
}

const placeIdOf = (s: ScheduleLike) =>
  s.placement === 'hidden' ? 'hidden' : s.placement === 'slot' ? `slot:${s.slotId}` : `board:${s.boardId}`

/**
 * 结构与编排规则（2.2 节、BR-06、BR-07）：编号范围与唯一、ID 唯一、非线路插片说明、
 * 放置方式与目标一致、隐藏与放置互斥、同一块站牌最多一次、每个插片最多一条
 */
export function structureIssues(
  d: StructureInput,
  label: (routeId: string, pass: number) => string = passageKey,
): SignSetIssue[] {
  const out: SignSetIssue[] = []
  const ids = new Set<string>()
  const dupId = (id: string, path: string) => {
    if (ids.has(id)) out.push({ path, message: '站架、站牌、插片的 ID 重复' })
    ids.add(id)
  }
  const shelfNos = new Set<number>()
  const boardNos = new Set<number>()
  const boards = new Map<string, BoardDraft>()
  const slots = new Map<string, { board: BoardDraft; slot: SlotDraft }>()
  d.shelves.forEach((sh, i) => {
    dupId(sh.id, `shelves.${i}.id`)
    if (shelfNos.has(sh.no)) out.push({ path: `shelves.${i}.no`, message: `站架编号重复：${shelfLabel(sh.no)}` })
    shelfNos.add(sh.no)
    sh.boards.forEach((b, j) => {
      const path = `shelves.${i}.boards.${j}`
      dupId(b.id, `${path}.id`)
      boards.set(b.id, b)
      if (boardNos.has(b.no)) out.push({ path: `${path}.no`, message: `站牌编号重复：${boardLabel(b.no)}` })
      boardNos.add(b.no)
      if (b.kind === 'whole' && b.slots.length)
        out.push({ path: `${path}.slots`, message: `${boardLabel(b.no)}是整版站牌，不能有插片` })
      const slotNos = new Set<number>()
      b.slots.forEach((s, k) => {
        dupId(s.id, `${path}.slots.${k}.id`)
        slots.set(s.id, { board: b, slot: s })
        if (slotNos.has(s.no))
          out.push({ path: `${path}.slots.${k}.no`, message: `${boardLabel(b.no)}的插片编号重复：${slotLabel(s.no)}` })
        slotNos.add(s.no)
        if (s.kind === 'other' && !s.note.trim())
          out.push({
            path: `${path}.slots.${k}.note`,
            message: `${boardLabel(b.no)} ${slotLabel(s.no)}是非线路插片，要写说明`,
          })
      })
    })
  })

  const perKey = new Map<string, { hidden: number; boards: string[] }>()
  const slotTaken = new Set<string>()
  const orders = new Map<string, Set<number>>()
  d.schedules.forEach((s, i) => {
    const path = `schedules.${i}`
    const name = label(s.routeId, s.pass)
    const k = perKey.get(keyOf(s)) ?? { hidden: 0, boards: [] }
    perKey.set(keyOf(s), k)
    if (s.placement === 'hidden') {
      if (s.boardId || s.slotId) out.push({ path, message: `${name}：隐藏的编排不能指定站牌或插片` })
      k.hidden++
      return
    }
    if (s.placement === 'board') {
      const b = s.boardId ? boards.get(s.boardId) : undefined
      if (!b || s.slotId) return out.push({ path, message: `${name}：放置的站牌不存在` })
      if (b.kind !== 'whole') return out.push({ path, message: `${name}：${boardLabel(b.no)}是分片站牌，要放进插片里` })
      if (!s.order || s.order < 1) return out.push({ path, message: `${name}：缺少在${boardLabel(b.no)}上的顺序` })
      const used = orders.get(b.id) ?? new Set<number>()
      if (used.has(s.order)) out.push({ path, message: `${boardLabel(b.no)}上的线路顺序重复` })
      used.add(s.order)
      orders.set(b.id, used)
      k.boards.push(b.id)
      return
    }
    const f = s.slotId ? slots.get(s.slotId) : undefined
    if (!f || s.boardId !== f.board.id) return out.push({ path, message: `${name}：放置的插片不存在` })
    if (f.slot.kind !== 'route')
      return out.push({
        path,
        message: `${name}：${boardLabel(f.board.no)} ${slotLabel(f.slot.no)}是非线路插片，不能放线路`,
      })
    if (slotTaken.has(f.slot.id))
      out.push({ path, message: `${boardLabel(f.board.no)} ${slotLabel(f.slot.no)}只能放一条线路` })
    slotTaken.add(f.slot.id)
    k.boards.push(f.board.id)
  })
  for (const [key, k] of perKey) {
    const [routeId, pass] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))]
    const name = label(routeId, pass)
    if (k.hidden > 1) out.push({ path: 'schedules', message: `${name}隐藏了不止一次` })
    if (k.hidden && k.boards.length) out.push({ path: 'schedules', message: `${name}不能同时隐藏和放在站牌上` })
    const seen = new Set<string>()
    for (const b of k.boards) {
      if (seen.has(b)) {
        out.push({ path: 'schedules', message: `${name}在${boardLabel(boards.get(b)!.no)}上出现了不止一次` })
        break
      }
      seen.add(b)
    }
  }
  return out
}

/**
 * 与当前途经有关的规则（2.1 节、3.4 节）：不是当前途经的（走向，途经）只能出现在保存前它已经在的位置上——
 * 失效编排可以保留、排序、移除，不能放到新的站牌或插片上；编辑期间线路刚停运时提示刷新
 */
export function passageIssues(
  d: { schedules: ScheduleLike[] },
  opts: { live: Set<string>; before: ScheduleLike[]; label: (routeId: string, pass: number) => string },
): SignSetIssue[] {
  const beforeOf = new Map<string, Set<string>>()
  for (const s of opts.before) beforeOf.set(keyOf(s), (beforeOf.get(keyOf(s)) ?? new Set()).add(placeIdOf(s)))
  const out: SignSetIssue[] = []
  const reported = new Set<string>()
  d.schedules.forEach((s, i) => {
    const key = keyOf(s)
    if (opts.live.has(key) || reported.has(key)) return
    const was = beforeOf.get(key)
    if (was?.has(placeIdOf(s))) return
    reported.add(key)
    const name = opts.label(s.routeId, s.pass)
    out.push({
      path: `schedules.${i}`,
      message: was
        ? `${name}已不经过本站，失效编排只能保留原位、排序或移除，不能放到新的站牌或插片上`
        : `${name}已不经过本站（可能刚停运或改了站序），请刷新后重新编排`,
    })
  })
  return out
}

/** 保存前提示（2.3 节，默认决定 4）：可以保存，但先列出来确认 */
export function saveWarnings(d: Pick<SignSetDraft, 'shelves'>): string[] {
  const out: string[] = []
  for (const sh of d.shelves) {
    if (!sh.boards.length) out.push(`${shelfLabel(sh.no)}下没有站牌`)
    for (const b of sh.boards)
      if (b.kind === 'sliced' && !b.slots.some((s) => s.kind === 'route'))
        out.push(`${boardLabel(b.no)}是分片站牌，但没有线路插片`)
  }
  return out
}

/* ---------------- 快照（3.3 节） ---------------- */

export interface SlotSnapshot {
  id: string
  no: number
  kind: SlotKind
  note: string
  width: number
  height: number
}

export interface BoardSnapshot {
  id: string
  no: number
  face: BoardFace
  kind: BoardKind
  width: number
  height: number
  remark: string
  slots: SlotSnapshot[]
}

export interface ShelfSnapshot {
  id: string
  no: number
  type: Ref
  name: string
  desc: string
  noPhysical: boolean
  material: string
  boards: BoardSnapshot[]
}

export interface PlaceSnapshot {
  boardId: string
  slotId: string | null
  order: number | null
}

export interface ScheduleSnapshot {
  /** 走向 ID + 第几次途经 */
  id: string
  /** 名称写"K1路 上行"；规范化后只留 ID，线路改名不改变哈希 */
  route: Ref
  pass: number
  hidden: boolean
  /** 集合（规范化时排序） */
  places: PlaceSnapshot[]
}

/** 站牌集快照：顶层外形与 M1 相同，站牌嵌在站架里 */
export interface SignSetSnapshotV1 {
  schema: 1
  /** 名称写"站名（方位）" */
  stop: Ref
  reminder: string
  /** 按排列顺序；站牌按站架内顺序 */
  shelves: ShelfSnapshot[]
  /** 按途经归组，每次途经一条，按 id 排序 */
  schedules: ScheduleSnapshot[]
}

type SnapshotDraft = {
  reminder: string
  shelves: (Omit<ShelfDraft, 'typeName'> & { typeName: string })[]
  schedules: ScheduleLike[]
}

/** 由站牌集内容构造快照；routeName 给出走向的显示名（"K1路 上行"） */
export function signSetSnapshotOf(
  stop: Ref,
  d: SnapshotDraft,
  routeName: (routeId: string) => string,
): SignSetSnapshotV1 {
  const groups = new Map<string, ScheduleSnapshot>()
  for (const s of d.schedules) {
    const id = keyOf(s)
    const g = groups.get(id) ?? {
      id,
      route: { id: s.routeId, name: routeName(s.routeId) },
      pass: s.pass,
      hidden: false,
      places: [],
    }
    groups.set(id, g)
    if (s.placement === 'hidden') g.hidden = true
    else g.places.push({ boardId: s.boardId!, slotId: s.slotId, order: s.placement === 'board' ? s.order : null })
  }
  return {
    schema: 1,
    stop: { id: stop.id, name: stop.name },
    reminder: d.reminder,
    shelves: d.shelves.map((sh) => ({
      id: sh.id,
      no: sh.no,
      type: { id: sh.typeId, name: sh.typeName },
      name: sh.name,
      desc: sh.desc,
      noPhysical: sh.noPhysical,
      material: sh.material,
      boards: sh.boards.map((b) => ({
        id: b.id,
        no: b.no,
        face: b.face,
        kind: b.kind,
        width: b.width,
        height: b.height,
        remark: b.remark,
        slots: b.slots.map((s) => ({
          id: s.id,
          no: s.no,
          kind: s.kind,
          note: s.note,
          width: s.width,
          height: s.height,
        })),
      })),
    })),
    schedules: [...groups.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

/** 空站牌集（新建站点、导入新建站点） */
export const signSetSnapshot = (stop: Ref): SignSetSnapshotV1 => signSetSnapshotOf(stop, emptyDraft(), () => '')

/** 编排的放置位置是集合（默认决定 7） */
export const SIGN_SET_NORMALIZE: NormalizeOptions = { sets: ['schedules.places'] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : [])

export const SIGN_SET_DIFF_SPEC: DiffField[] = [
  { path: 'reminder', label: '温馨提示' },
  {
    path: 'shelves',
    label: '站架',
    kind: 'list',
    // 只比较站架自身字段
    items: (s) => arr(isObj(s) ? s.shelves : []).map((x) => (isObj(x) ? { ...x, boards: undefined } : x)),
    labelOf: (x) => {
      const sh = x as Partial<ShelfSnapshot>
      return `${shelfLabel(sh.no ?? 0)}${sh.type?.name ? ` · ${sh.type.name}` : ''}`
    },
  },
  {
    path: 'boards',
    label: '站牌',
    kind: 'list',
    // 从各站架摊平；插片改动算这块牌"修改"
    items: (s) => arr(isObj(s) ? s.shelves : []).flatMap((sh) => arr(isObj(sh) ? sh.boards : [])),
    labelOf: (x) => boardLabel((x as Partial<BoardSnapshot>).no ?? 0),
  },
  {
    path: 'schedules',
    label: '线路编排',
    kind: 'list',
    labelOf: (x) => {
      const s = x as Partial<ScheduleSnapshot>
      const name = s.route?.name ?? ''
      return (s.pass ?? 1) > 1 ? `${name}（第 ${s.pass} 次）` : name
    },
  },
]

/* ---------------- 接口数据 ---------------- */

export interface SignSetStop {
  id: string
  name: string
  direction: string
}

/** 编辑器与预览：站牌集内容 + 当前途经清单 + 计数 */
export interface SignSetView extends SignSetDraft {
  id: string
  rev: number
  stop: SignSetStop
  /** 途经与编排引用的走向 */
  routes: RouteInfo[]
  passages: Passage[]
  counts: SignSetCounts
  snapshotCount: number
  updatedAt: string
}

export interface SignSetListItem {
  id: string
  stop: SignSetStop
  lines: { id: string; name: string; suspended: boolean }[]
  city: Ref | null
  district: Ref | null
  street: Ref | null
  road: Ref | null
  shelves: number
  /** 站架类型（去重，按出现次数） */
  shelfTypes: { name: string; count: number }[]
  boards: number
  /** 站牌尺寸（去重），如 1200×1800 */
  boardSizes: string[]
  waiting: number
  invalid: number
  updatedAt: string
}

export interface SignSetSummary {
  /** 有待编排或失效的站牌集数 */
  pendingSets: number
  waiting: number
  invalid: number
  signSets: number
}

export interface ShelfTemplate {
  id: string
  name: string
  type: Ref
  desc: string
  noPhysical: boolean
  image: Upload | null
  boards: TemplateBoard[]
  updatedAt: string
}

/** 停运、恢复、删除、改模式的确认弹窗：影响范围（默认决定 14） */
export interface LineImpact {
  stops: number
  signSets: number
  schedules: number
}

/** 工作台"最近修改"：每个对象一行 */
export interface RecentChange {
  snapshotId: string
  objectType: ObjectType
  objectId: string
  objectName: string
  action: SnapshotAction
  note: string
  createdAt: string
  /** 对象是否还存在；已删除的只能打开修改历史 */
  exists: boolean
  /** 站牌集所属站点 */
  stopId: string | null
}
