// PROTOTYPE — 三个编辑器变体共用的状态与拖放规则（布局各自独立）
import { PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useState } from 'react'
import { SHELF_TEMPLATES } from '../../data/mock'
import { useDebug, useStore } from '../../data/store'
import type { Board, Shelf, ShelfTemplate, SignSet, Slot } from '../../data/types'
import { passagesAt, poolOf, type PoolItem } from '../../lib/domain'
import { useToast } from '../../ui'
import * as M from './model'

export type Sel = { type: 'shelf' | 'board' | 'slot'; id: string } | null

export function useEditor(stopId: string) {
  const { stops, lines, getSignSet, saveSignSet } = useStore()
  const toast = useToast()
  const stop = stops.find((s) => s.id === stopId)
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(getSignSet(stopId)))
  const [draft, setDraft] = useState<SignSet>(() => M.clone(getSignSet(stopId)))
  const [sel, setSel] = useState<Sel>(null)
  const passages = useMemo(() => passagesAt(stopId, lines, stops), [stopId, lines, stops])
  const pool = useMemo(() => poolOf(draft, passages), [draft, passages])
  const dirty = JSON.stringify(draft) !== savedJson
  const counts = {
    待编排: pool.filter((p) => p.status === '待编排').length,
    已编排: pool.filter((p) => p.status === '已编排').length,
    隐藏: pool.filter((p) => p.status === '隐藏').length,
    失效: pool.filter((p) => p.status === '失效').length,
  }
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 站牌集草稿: draft, 线路池: pool.map((p) => `${p.lineName} ${p.kind}${p.timesAtStop > 1 ? ` 第${p.nth}次` : ''} → ${p.status}`), 有未保存修改: dirty }), [draft, pool, dirty])

  useEffect(() => {
    if (!dirty) return
    const before = (e: BeforeUnloadEvent) => e.preventDefault()
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]')
      if (a && !window.confirm('站牌集有未保存的修改，确定离开？')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', click, true)
    }
  }, [dirty])

  const itemOf = (key: string) => pool.find((p) => p.key === key)
  const dropNote = (n: number) => n > 0 && toast(`${n} 条编排随之移除，相关线路回到线路池`, 'info')

  const ops = {
    placeOnBoard: (item: PoolItem, boardId: string, index?: number, moveFrom?: string) => setDraft((d) => M.placeOnBoard(d, item, boardId, index, moveFrom)),
    placeOnSlot: (item: PoolItem, slotId: string, moveFrom?: string) => {
      const r = M.placeOnSlot(draft, item, slotId, moveFrom)
      if (r.replaced) toast(`插片原有的 ${r.replaced} 已回到线路池`, 'info')
      setDraft(r.ss)
    },
    hide: (item: PoolItem) => setDraft((d) => M.hide(d, item)),
    unhide: (item: PoolItem) => setDraft((d) => M.removeKey(d, item.key)),
    removeSchedule: (id: string) => setDraft((d) => M.removeSchedule(d, id)),
    removeAll: (item: PoolItem) => setDraft((d) => M.removeKey(d, item.key)),
    clearInvalid: (keys?: string[]) => {
      const ks = keys ?? pool.filter((p) => p.status === '失效').map((p) => p.key)
      setDraft((d) => M.clearInvalid(d, ks))
      toast(`已清理 ${ks.length} 条失效编排`)
    },
    reorder: (boardId: string, ids: string[]) => setDraft((d) => M.reorder(d, boardId, ids)),
    autoSort: (boardId: string) => {
      setDraft((d) => M.autoSort(d, boardId))
      toast('已按线路名自动排序')
    },
    addShelf: (tid?: string) => {
      const t = tid ? SHELF_TEMPLATES.find((x) => x.id === tid) : undefined
      const r = M.addShelf(draft, t)
      setDraft(r.ss)
      setSel({ type: 'shelf', id: r.shelfId })
    },
    reapply: (shelfId: string, t: ShelfTemplate) => {
      const r = M.reapplyTemplate(draft, shelfId, t)
      setDraft(r.ss)
      dropNote(r.dropped)
    },
    deleteShelf: (id: string) => {
      const r = M.deleteShelf(draft, id)
      setDraft(r.ss)
      setSel(null)
      dropNote(r.dropped)
    },
    addBoard: (shelfId: string) => {
      const r = M.addBoard(draft, shelfId)
      setDraft(r.ss)
      setSel({ type: 'board', id: r.boardId })
    },
    deleteBoard: (id: string) => {
      const r = M.deleteBoard(draft, id)
      setDraft(r.ss)
      setSel(null)
      dropNote(r.dropped)
    },
    updateBoard: (id: string, patch: any) => {
      const r = M.updateBoard(draft, id, patch)
      setDraft(r.ss)
      dropNote(r.dropped)
    },
    updateShelf: (id: string, patch: any) => setDraft((d) => M.updateShelf(d, id, patch)),
    addSlot: (boardId: string) => setDraft((d) => M.addSlot(d, boardId)),
    updateSlot: (id: string, patch: any) => {
      const r = M.updateSlot(draft, id, patch)
      setDraft(r.ss)
      dropNote(r.dropped)
    },
    deleteSlot: (id: string) => {
      const r = M.deleteSlot(draft, id)
      setDraft(r.ss)
      setSel(null)
      dropNote(r.dropped)
    },
    setReminder: (v: string) => setDraft((d) => ({ ...d, reminder: v })),
  }

  const save = () => {
    const r = saveSignSet(draft)
    setSavedJson(JSON.stringify(draft))
    if (r.changed) toast('已保存站牌集，生成一份修改快照')
    else toast('内容没有变化，没有生成修改快照', 'info')
  }
  const reset = () => {
    setDraft(JSON.parse(savedJson))
    setSel(null)
    toast('已撤销本次未保存的修改', 'info')
  }

  return { stop, draft, pool, counts, passages, dirty, sel, setSel, ops, save, reset, itemOf }
}

export type Editor = ReturnType<typeof useEditor>

/**
 * 拖放 id 约定：
 * 线路池条目 `pool:<key>`；站牌上的编排 `sch:<scheduleId>`；
 * 放置目标 `board:<id>`、`slot:<id>`、`hidden`、`pool`
 */
export function useEditorDnd(ed: Editor) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [active, setActive] = useState<{ item: PoolItem; fromSchedule?: string } | null>(null)
  const toast = useToast()

  const resolve = (id: string): { item: PoolItem; fromSchedule?: string } | null => {
    if (id.startsWith('pool:')) {
      const item = ed.itemOf(id.slice(5))
      return item ? { item } : null
    }
    if (id.startsWith('sch:')) {
      const sid = id.slice(4)
      const s = ed.draft.schedules.find((x) => x.id === sid)
      if (!s) return null
      const item = ed.itemOf(`${s.routeId}#${s.nth}`)
      return item ? { item, fromSchedule: sid } : null
    }
    return null
  }

  const onDragStart = (e: DragStartEvent) => setActive(resolve(String(e.active.id)))

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const src = resolve(String(e.active.id))
    if (!src || !e.over) return
    const overId = String(e.over.id)
    const { item, fromSchedule } = src
    const invalidWarn = () => toast('失效编排的线路已不经过本站，不能再放到别的站牌上', 'warn')
    if (item.status === '失效' && overId !== 'pool' && !overId.startsWith('sch:')) return invalidWarn()
    if (overId === 'pool') {
      // 站牌上的线路拖回待编排区 = 移除这一处编排；隐藏的线路拖回来 = 取消隐藏
      if (fromSchedule) ed.ops.removeSchedule(fromSchedule)
      else if (item.status === '隐藏') ed.ops.unhide(item)
      return
    }
    if (overId === 'hidden') {
      if (item.status === '隐藏') return
      ed.ops.hide(item)
      return toast(`${item.lineName} ${item.kind} 已隐藏，不在本站任何站牌展示`, 'info')
    }
    // 缩略图：整版放到末尾，分片放进第一个空的线路插片
    if (overId.startsWith('thumb:')) {
      const b = M.findBoard(ed.draft, overId.slice(6))
      if (!b) return
      if (b.board.kind === '整版') return ed.ops.placeOnBoard(item, b.board.id, undefined, fromSchedule && M.onBoard(ed.draft, b.board.id).some((s) => s.id === fromSchedule) ? undefined : fromSchedule)
      const empty = M.firstEmptySlot(ed.draft, b.board.id)
      if (!empty) return toast('这块分片站牌没有空的线路插片了', 'warn')
      return ed.ops.placeOnSlot(item, empty.id, fromSchedule)
    }
    if (overId.startsWith('slot:')) {
      const slot = M.findSlot(ed.draft, overId.slice(5))
      if (slot?.slot.kind === '非线路') return toast('非线路插片不能放线路', 'warn')
      return ed.ops.placeOnSlot(item, overId.slice(5), fromSchedule)
    }
    if (overId.startsWith('board:')) {
      const b = M.findBoard(ed.draft, overId.slice(6))
      if (b?.board.kind === '分片') return toast('分片站牌的线路要放进插片里', 'warn')
      return ed.ops.placeOnBoard(item, overId.slice(6), undefined, fromSchedule && M.onBoard(ed.draft, overId.slice(6)).some((s) => s.id === fromSchedule) ? undefined : fromSchedule)
    }
    if (overId.startsWith('sch:')) {
      const target = ed.draft.schedules.find((s) => s.id === overId.slice(4))
      if (!target || target.place.type !== 'board') return
      const boardId = target.place.boardId
      const list = M.onBoard(ed.draft, boardId)
      const ids = list.map((s) => s.id)
      const to = ids.indexOf(target.id)
      if (fromSchedule && ids.includes(fromSchedule)) {
        ed.ops.reorder(boardId, arrayMove(ids, ids.indexOf(fromSchedule), to))
      } else if (item.status === '失效') {
        invalidWarn()
      } else {
        ed.ops.placeOnBoard(item, boardId, to, fromSchedule)
      }
    }
  }

  return { sensors, active, onDragStart, onDragEnd, onDragCancel: () => setActive(null) }
}

export interface Target {
  kind: 'board' | 'slot'
  id: string
  shelf: Shelf
  board: Board
  slot?: Slot
  occupant?: string
}

/** "放到…"菜单可选目标 */
export function targetsOf(ed: Editor): Target[] {
  return M.allBoards(ed.draft).flatMap(({ shelf, board }): Target[] =>
    board.kind === '整版'
      ? [{ kind: 'board', id: board.id, shelf, board }]
      : board.slots.filter((s) => s.kind === '线路').map((slot) => ({ kind: 'slot', id: slot.id, shelf, board, slot, occupant: M.inSlot(ed.draft, slot.id)?.lineName })),
  )
}
