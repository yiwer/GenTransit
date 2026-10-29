// 站牌集与站架模板的查询钩子
import type {
  Page,
  ShelfTemplate,
  SignSetDraft,
  SignSetInputRaw,
  SignSetListItem,
  SignSetSummary,
  SignSetView,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { get } from '@/lib/api'

export const signSetKey = (stopId: string) => ['sign-sets', 'stop', stopId] as const
export const templatesKey = ['shelf-templates'] as const

export const useSignSet = (stopId: string | undefined) =>
  useQuery({
    queryKey: signSetKey(stopId ?? ''),
    queryFn: () => get<SignSetView>(`/api/stops/${stopId}/sign-set`),
    enabled: Boolean(stopId),
  })

export const useSignSetList = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: ['sign-sets', 'list', params],
    queryFn: () => get<Page<SignSetListItem>>('/api/sign-sets', params),
    placeholderData: (prev) => prev,
  })

export const useSignSetSummary = () =>
  useQuery({ queryKey: ['sign-sets', 'summary'], queryFn: () => get<SignSetSummary>('/api/sign-sets/summary') })

export const useBoardSizes = () =>
  useQuery({
    queryKey: ['sign-sets', 'board-sizes'],
    queryFn: () => get<{ width: number; height: number; count: number }[]>('/api/sign-sets/board-sizes'),
  })

export const useShelfTemplates = () =>
  useQuery({ queryKey: templatesKey, queryFn: () => get<ShelfTemplate[]>('/api/shelf-templates') })

/** 保存时提交的内容：站架只交 typeId，编排不交 ID */
export const toInput = (d: SignSetDraft, rev: number): SignSetInputRaw => ({
  rev,
  reminder: d.reminder,
  shelves: d.shelves.map((sh) => ({
    id: sh.id,
    no: sh.no,
    typeId: sh.typeId,
    name: sh.name,
    desc: sh.desc,
    noPhysical: sh.noPhysical,
    material: sh.material,
    boards: sh.boards,
  })),
  schedules: d.schedules.map((s) => ({
    routeId: s.routeId,
    pass: s.pass,
    placement: s.placement,
    boardId: s.boardId,
    slotId: s.slotId,
    order: s.order,
  })),
})

/** 只取草稿部分（比较是否有未保存修改） */
export const draftOf = (v: SignSetDraft): SignSetDraft => ({
  reminder: v.reminder,
  shelves: v.shelves,
  schedules: v.schedules,
})

/** 草稿的撤销与重做（默认决定 11）：草稿是不可变对象，保存一个历史栈即可 */
export function useDraftHistory(initial: SignSetDraft) {
  const [state, setState] = useState({
    past: [] as SignSetDraft[],
    now: initial,
    future: [] as SignSetDraft[],
    merge: null as string | null,
  })
  /** mergeKey：连续修改同一个文本字段（逐字输入）合并成一步撤销 */
  const set = useCallback(
    (next: SignSetDraft | ((d: SignSetDraft) => SignSetDraft), mergeKey?: string) =>
      setState((s) => {
        const n = typeof next === 'function' ? next(s.now) : next
        if (n === s.now) return s
        if (mergeKey && mergeKey === s.merge && s.past.length) return { ...s, now: n, future: [] }
        return { past: [...s.past, s.now].slice(-200), now: n, future: [], merge: mergeKey ?? null }
      }),
    [],
  )
  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length
          ? { past: s.past.slice(0, -1), now: s.past.at(-1)!, future: [s.now, ...s.future], merge: null }
          : s,
      ),
    [],
  )
  const redo = useCallback(
    () =>
      setState((s) =>
        s.future.length ? { past: [...s.past, s.now], now: s.future[0], future: s.future.slice(1), merge: null } : s,
      ),
    [],
  )
  const reset = useCallback((d: SignSetDraft) => setState({ past: [], now: d, future: [], merge: null }), [])
  return {
    draft: state.now,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
