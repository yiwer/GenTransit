// 站牌集编辑器的操作集合：所有草稿修改经过 run()，统一处理"编号用尽"等提示与"N 条编排随之移除"
import {
  DraftError,
  hide,
  keyOf,
  passageLabel,
  placeOnBoard,
  placeOnSlot,
  placeTargets,
  removeKey,
  removeSchedule,
  unhide,
  type PassageRef,
  type PlaceTarget,
  type PoolItem,
  type ScheduleDraft,
  type SignSetDraft,
  type SignSetView,
} from '@gentransit/shared'
import { createContext, useContext, type ReactNode } from 'react'
import type { Sel } from '@/components/gt/elevation'

type Toast = (text: ReactNode, tone?: 'ok' | 'info' | 'warn' | 'error') => void
type Result = SignSetDraft | { draft: SignSetDraft; dropped?: number; replaced?: ScheduleDraft }

export const INVALID_MOVE = '这条线路已不经过本站，不能再放到别的站牌上'

export function makeEditor(opts: {
  view: SignSetView
  draft: SignSetDraft
  pool: PoolItem[]
  set: (d: SignSetDraft, mergeKey?: string) => void
  toast: Toast
  /** 确认弹窗（重新套用模板、切换站牌类型、删除结构） */
  confirm: (c: { title: string; body: ReactNode; ok: string; danger?: boolean; run: () => void }) => void
  sel: Sel | null
  setSel: (s: Sel | null) => void
}) {
  const { draft, pool, set, toast } = opts
  const byKey = new Map(pool.map((p) => [p.key, p]))
  const itemOf = (key: string) => byKey.get(key)

  /** 执行一次草稿修改；违反规则时提示，不改草稿。mergeKey：逐字输入合并成一步撤销 */
  const run = (fn: (d: SignSetDraft) => Result, mergeKey?: string) => {
    try {
      const r = fn(draft)
      const next = 'draft' in r ? r.draft : r
      if (next !== draft) set(next, mergeKey)
      if ('dropped' in r && r.dropped) toast(`${r.dropped} 条编排随之移除，相关线路回到待编排`, 'info')
      if ('replaced' in r && r.replaced) {
        const it = itemOf(keyOf(r.replaced))
        toast(`插片原有的 ${it ? passageLabel(it) : '线路'} 已回到待编排`, 'info')
      }
      return true
    } catch (e) {
      if (e instanceof DraftError) {
        toast(e.message, 'warn')
        return false
      }
      throw e
    }
  }

  const targets = placeTargets(draft)

  /** 放到站牌或插片；moveFrom 为移动（移除原处）。失效编排不能放到新位置（默认决定 1） */
  const place = (item: PoolItem, t: PlaceTarget, moveFrom?: string, index?: number) => {
    if (item.status === 'invalid') return toast(INVALID_MOVE, 'warn')
    const p: PassageRef = { routeId: item.routeId, pass: item.pass }
    run((d) =>
      t.kind === 'board' ? placeOnBoard(d, p, t.id, { moveFrom, index }) : placeOnSlot(d, p, t.id, { moveFrom }),
    )
  }

  return {
    ...opts,
    itemOf,
    run,
    targets,
    place,
    hide: (item: PoolItem) => {
      if (item.status === 'invalid') return toast('失效编排不能隐藏，可以移除', 'warn')
      if (run((d) => hide(d, item))) toast(`${passageLabel(item)} 已隐藏，不在本站任何站牌展示`, 'info')
    },
    unhide: (item: PoolItem) => run((d) => unhide(d, item.key)),
    removeSchedule: (id: string) => run((d) => removeSchedule(d, id)),
    removeKey: (key: string) => run((d) => removeKey(d, key)),
    /** 这条途经已放在哪些站牌、插片上 */
    placedOn: (item: PoolItem, t: PlaceTarget) =>
      item.schedules.some((s) =>
        t.kind === 'board' ? s.boardId === t.id && s.placement === 'board' : s.slotId === t.id,
      ),
  }
}

export type EditorApi = ReturnType<typeof makeEditor>

export const EditorCtx = createContext<EditorApi | null>(null)
export const useEditor = () => useContext(EditorCtx)!
