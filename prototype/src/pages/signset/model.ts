// PROTOTYPE — 站牌集编辑操作（纯函数），规则对应需求 BR-05 ~ BR-07、BR-14、BR-15
import type { Board, Schedule, Shelf, ShelfTemplate, SignSet, Slot } from '../../data/types'
import { compareLineName, keyOf, uid, type PoolItem } from '../../lib/domain'

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export const allBoards = (ss: SignSet) => ss.shelves.flatMap((sh) => sh.boards.map((b) => ({ shelf: sh, board: b })))
export const allSlots = (ss: SignSet) => allBoards(ss).flatMap(({ shelf, board }) => board.slots.map((slot) => ({ shelf, board, slot })))
export const findBoard = (ss: SignSet, id: string) => allBoards(ss).find((x) => x.board.id === id)
export const findSlot = (ss: SignSet, id: string) => allSlots(ss).find((x) => x.slot.id === id)

const skey = (s: Schedule) => keyOf(s.routeId, s.nth)

export const onBoard = (ss: SignSet, boardId: string) =>
  ss.schedules.filter((s) => s.place.type === 'board' && s.place.boardId === boardId).sort((a, b) => (a.place as any).order - (b.place as any).order)
export const inSlot = (ss: SignSet, slotId: string) => ss.schedules.find((s) => s.place.type === 'slot' && s.place.slotId === slotId)

const renumber = (ss: SignSet, boardId: string) => {
  onBoard(ss, boardId).forEach((s, i) => ((s.place as any).order = i + 1))
}

const newSchedule = (item: Pick<PoolItem, 'routeId' | 'nth' | 'lineName' | 'kind'>, place: Schedule['place']): Schedule => ({
  id: uid('c'), routeId: item.routeId, nth: item.nth, lineName: item.lineName, kind: item.kind, place,
})

const unhide = (ss: SignSet, key: string) => {
  ss.schedules = ss.schedules.filter((s) => !(skey(s) === key && s.place.type === 'hidden'))
}

/** 放到整版站牌（index 为插入位置；已在该站牌上则调整位置） */
export function placeOnBoard(src: SignSet, item: Pick<PoolItem, 'key' | 'routeId' | 'nth' | 'lineName' | 'kind'>, boardId: string, index?: number, moveFromScheduleId?: string): SignSet {
  const ss = clone(src)
  unhide(ss, item.key)
  if (moveFromScheduleId) ss.schedules = ss.schedules.filter((s) => s.id !== moveFromScheduleId)
  const list = onBoard(ss, boardId)
  const existing = list.find((s) => skey(s) === item.key)
  const others = list.filter((s) => s !== existing)
  const target = existing ?? newSchedule(item, { type: 'board', boardId, order: 0 })
  if (!existing) ss.schedules.push(target)
  const at = index === undefined ? others.length : Math.max(0, Math.min(index, others.length))
  others.splice(at, 0, target)
  others.forEach((s, i) => (s.place = { type: 'board', boardId, order: i + 1 }))
  if (moveFromScheduleId) allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return ss
}

/** 放到线路插片；插片已有线路时，原线路回到线路池 */
export function placeOnSlot(src: SignSet, item: Pick<PoolItem, 'key' | 'routeId' | 'nth' | 'lineName' | 'kind'>, slotId: string, moveFromScheduleId?: string): { ss: SignSet; replaced?: string } {
  const ss = clone(src)
  const slot = findSlot(ss, slotId)
  if (!slot || slot.slot.kind !== '线路') return { ss: src }
  unhide(ss, item.key)
  if (moveFromScheduleId) ss.schedules = ss.schedules.filter((s) => s.id !== moveFromScheduleId)
  const old = inSlot(ss, slotId)
  if (old && skey(old) === item.key) return { ss }
  if (old) ss.schedules = ss.schedules.filter((s) => s !== old)
  ss.schedules.push(newSchedule(item, { type: 'slot', slotId }))
  allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return { ss, replaced: old?.lineName }
}

/** 一次途经要么隐藏，要么放在站牌上 */
export function hide(src: SignSet, item: Pick<PoolItem, 'key' | 'routeId' | 'nth' | 'lineName' | 'kind'>): SignSet {
  const ss = clone(src)
  ss.schedules = ss.schedules.filter((s) => skey(s) !== item.key)
  ss.schedules.push(newSchedule(item, { type: 'hidden' }))
  allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return ss
}

export function removeSchedule(src: SignSet, scheduleId: string): SignSet {
  const ss = clone(src)
  ss.schedules = ss.schedules.filter((s) => s.id !== scheduleId)
  allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return ss
}

export function removeKey(src: SignSet, key: string): SignSet {
  const ss = clone(src)
  ss.schedules = ss.schedules.filter((s) => skey(s) !== key)
  allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return ss
}

export function clearInvalid(src: SignSet, invalidKeys: string[]): SignSet {
  const ss = clone(src)
  ss.schedules = ss.schedules.filter((s) => !invalidKeys.includes(skey(s)))
  allBoards(ss).forEach(({ board }) => renumber(ss, board.id))
  return ss
}

export function reorder(src: SignSet, boardId: string, ids: string[]): SignSet {
  const ss = clone(src)
  ids.forEach((id, i) => {
    const s = ss.schedules.find((x) => x.id === id)
    if (s && s.place.type === 'board') s.place = { type: 'board', boardId, order: i + 1 }
  })
  return ss
}

/** 自动排序：只调整顺序，不删除任何编排（含失效） */
export function autoSort(src: SignSet, boardId: string): SignSet {
  const ids = onBoard(src, boardId)
    .slice()
    .sort((a, b) => compareLineName(a.lineName, b.lineName) || a.kind.localeCompare(b.kind) || a.nth - b.nth)
    .map((s) => s.id)
  return reorder(src, boardId, ids)
}

const nextNo = (used: number[], max: number) => {
  for (let i = 1; i <= max; i++) if (!used.includes(i)) return i
  return max + 1
}
const usedBoardNos = (ss: SignSet) => allBoards(ss).map((x) => x.board.no)

export function boardsFromTemplate(ss: SignSet, t: ShelfTemplate): Board[] {
  const used = usedBoardNos(ss)
  return t.boards.map((b) => {
    const no = nextNo(used, 90)
    used.push(no)
    return { ...clone(b), id: uid('b'), no, slots: b.slots.map((s) => ({ ...s, id: uid('sl') })) }
  })
}

export function addShelf(src: SignSet, t?: ShelfTemplate): { ss: SignSet; shelfId: string } {
  const ss = clone(src)
  const no = nextNo(ss.shelves.map((s) => s.no), 15)
  const shelf: Shelf = {
    id: uid('sh'), no, type: t?.type ?? '单立柱站架', name: '', desc: t?.desc ?? '', noPhysical: t?.noPhysical ?? false, material: '',
    boards: t ? boardsFromTemplate(ss, t) : [],
  }
  ss.shelves.push(shelf)
  return { ss, shelfId: shelf.id }
}

/** 重新套用模板：替换站架下全部站牌，原站牌上的编排删除（线路回到线路池） */
export function reapplyTemplate(src: SignSet, shelfId: string, t: ShelfTemplate): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const shelf = ss.shelves.find((s) => s.id === shelfId)!
  const dropped = dropPlacementsOf(ss, shelf.boards)
  shelf.boards = []
  shelf.boards = boardsFromTemplate(ss, t)
  shelf.type = t.type
  return { ss, dropped }
}

function dropPlacementsOf(ss: SignSet, boards: Board[]) {
  const boardIds = boards.map((b) => b.id)
  const slotIds = boards.flatMap((b) => b.slots.map((s) => s.id))
  const before = ss.schedules.length
  ss.schedules = ss.schedules.filter((s) => !((s.place.type === 'board' && boardIds.includes(s.place.boardId)) || (s.place.type === 'slot' && slotIds.includes(s.place.slotId))))
  return before - ss.schedules.length
}

export function deleteShelf(src: SignSet, shelfId: string): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const shelf = ss.shelves.find((s) => s.id === shelfId)!
  const dropped = dropPlacementsOf(ss, shelf.boards)
  ss.shelves = ss.shelves.filter((s) => s.id !== shelfId)
  return { ss, dropped }
}

export function addBoard(src: SignSet, shelfId: string): { ss: SignSet; boardId: string } {
  const ss = clone(src)
  const b: Board = { id: uid('b'), no: nextNo(usedBoardNos(ss), 90), face: '正面', kind: '整版', w: 1200, h: 1800, remark: '', slots: [] }
  ss.shelves.find((s) => s.id === shelfId)!.boards.push(b)
  return { ss, boardId: b.id }
}

export function deleteBoard(src: SignSet, boardId: string): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const { shelf, board } = findBoard(ss, boardId)!
  const dropped = dropPlacementsOf(ss, [board])
  shelf.boards = shelf.boards.filter((b) => b.id !== boardId)
  return { ss, dropped }
}

export function updateBoard(src: SignSet, boardId: string, patch: Partial<Board>): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const { board } = findBoard(ss, boardId)!
  let dropped = 0
  if (patch.kind && patch.kind !== board.kind) {
    dropped = dropPlacementsOf(ss, [board])
    if (patch.kind === '整版') board.slots = []
    else board.slots = [1, 2, 3, 4].map((no) => ({ id: uid('sl'), no, kind: '线路' as const, note: '', w: Math.floor(board.w / 2) - 20, h: 360 }))
  }
  Object.assign(board, patch)
  return { ss, dropped }
}

export function updateShelf(src: SignSet, shelfId: string, patch: Partial<Shelf>): SignSet {
  const ss = clone(src)
  Object.assign(ss.shelves.find((s) => s.id === shelfId)!, patch)
  return ss
}

export function addSlot(src: SignSet, boardId: string): SignSet {
  const ss = clone(src)
  const { board } = findBoard(ss, boardId)!
  const no = nextNo(board.slots.map((s) => s.no), 99)
  const last = board.slots[board.slots.length - 1]
  board.slots.push({ id: uid('sl'), no, kind: '线路', note: '', w: last?.w ?? 700, h: last?.h ?? 360 })
  return ss
}

export function updateSlot(src: SignSet, slotId: string, patch: Partial<Slot>): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const { slot } = findSlot(ss, slotId)!
  let dropped = 0
  if (patch.kind === '非线路' && slot.kind === '线路') {
    const before = ss.schedules.length
    ss.schedules = ss.schedules.filter((s) => !(s.place.type === 'slot' && s.place.slotId === slotId))
    dropped = before - ss.schedules.length
  }
  Object.assign(slot, patch)
  return { ss, dropped }
}

export function deleteSlot(src: SignSet, slotId: string): { ss: SignSet; dropped: number } {
  const ss = clone(src)
  const { board } = findSlot(ss, slotId)!
  const before = ss.schedules.length
  ss.schedules = ss.schedules.filter((s) => !(s.place.type === 'slot' && s.place.slotId === slotId))
  board.slots = board.slots.filter((s) => s.id !== slotId)
  return { ss, dropped: before - ss.schedules.length }
}

/** 某块分片站牌上第一个空的线路插片 */
export const firstEmptySlot = (ss: SignSet, boardId: string) => findBoard(ss, boardId)?.board.slots.find((sl) => sl.kind === '线路' && !inSlot(ss, sl.id))

export const boardLabel = (b: Board, cn: (n: number) => string) => `${cn(b.no)}号牌`
export const shelfLabel = (s: Shelf, cn: (n: number) => string) => `${cn(s.no)}号架`
