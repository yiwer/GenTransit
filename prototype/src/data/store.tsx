// PROTOTYPE — 内存状态，刷新页面即复原；不做任何持久化
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { buildLines, buildSignSets, buildStops, emptySignSet } from './mock'
import type { Line, SignSet, SnapshotEntry, Stop } from './types'
import { nowText } from '../lib/domain'

const STOP_FIELD_LABEL: Record<string, string> = {
  name: '站名', direction: '方位', nameEn: '英文名', lng: '经度', lat: '纬度', district: '区', street: '街道', road: '路段',
  maintainer: '维护公司', remark: '备注', qrUrl: '二维码 URL', landmarkIds: '地标', facilities: '站台设施', photos: '照片',
}

export function diffStop(a: Stop | undefined, b: Stop): string[] {
  if (!a) return ['新建']
  return Object.keys(STOP_FIELD_LABEL).filter((k) => JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k])).map((k) => STOP_FIELD_LABEL[k])
}

const normSignSet = (s: SignSet) => JSON.stringify({ ...s, schedules: [...s.schedules].sort((x, y) => x.id.localeCompare(y.id)) })

interface Store {
  stops: Stop[]
  lines: Line[]
  snapshots: SnapshotEntry[]
  getSignSet: (stopId: string) => SignSet
  saveStop: (s: Stop) => { changed: boolean; fields: string[] }
  deleteStop: (id: string) => { ok: boolean; reason?: string }
  saveSignSet: (s: SignSet) => { changed: boolean }
  setLineStatus: (id: string, status: Line['status']) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stops, setStops] = useState<Stop[]>(buildStops)
  const [lines, setLines] = useState<Line[]>(buildLines)
  const [signSets, setSignSets] = useState<Record<string, SignSet>>(buildSignSets)
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([])

  const push = useCallback((e: Omit<SnapshotEntry, 'id' | 'at'>) => {
    setSnapshots((xs) => [{ ...e, id: xs.length + 1, at: nowText() }, ...xs])
  }, [])

  const getSignSet = useCallback((stopId: string) => signSets[stopId] ?? emptySignSet(stopId), [signSets])

  const saveStop = useCallback(
    (s: Stop) => {
      const prev = stops.find((x) => x.id === s.id)
      const fields = diffStop(prev, s)
      if (prev && fields.length === 0) return { changed: false, fields }
      const next = { ...s, updatedAt: nowText() }
      setStops((xs) => (prev ? xs.map((x) => (x.id === s.id ? next : x)) : [next, ...xs]))
      push({ objType: '站点', objId: s.id, objName: `${s.name}（${s.direction}）`, action: prev ? '修改' : '新增', summary: prev ? `修改：${fields.join('、')}` : '新建站点，并创建空站牌集' })
      return { changed: true, fields }
    },
    [stops, push],
  )

  const deleteStop = useCallback(
    (id: string) => {
      const used = lines.filter((l) => l.routes.some((r) => r.stopIds.includes(id)))
      if (used.length) return { ok: false, reason: `仍被 ${used.map((l) => l.name).join('、')} 的路径站引用` }
      const s = stops.find((x) => x.id === id)!
      setStops((xs) => xs.map((x) => (x.id === id ? { ...x, deleted: true } : x)))
      push({ objType: '站点', objId: id, objName: `${s.name}（${s.direction}）`, action: '删除', summary: '删除站点，连带删除站牌集' })
      return { ok: true }
    },
    [lines, stops, push],
  )

  const saveSignSet = useCallback(
    (ss: SignSet) => {
      const prev = signSets[ss.stopId] ?? emptySignSet(ss.stopId)
      if (normSignSet(prev) === normSignSet(ss)) return { changed: false }
      setSignSets((m) => ({ ...m, [ss.stopId]: ss }))
      const st = stops.find((x) => x.id === ss.stopId)
      push({ objType: '站牌集', objId: ss.stopId, objName: st ? `${st.name}（${st.direction}）` : ss.stopId, action: '修改', summary: `站架 ${ss.shelves.length} 个，编排 ${ss.schedules.length} 条` })
      return { changed: true }
    },
    [signSets, stops, push],
  )

  const setLineStatus = useCallback(
    (id: string, status: Line['status']) => {
      const l = lines.find((x) => x.id === id)
      if (!l || l.status === status) return
      setLines((xs) => xs.map((x) => (x.id === id ? { ...x, status, updatedAt: nowText() } : x)))
      push({ objType: '线路', objId: id, objName: l.name, action: '修改', summary: `状态：${l.status} → ${status}` })
    },
    [lines, push],
  )

  const value = useMemo(
    () => ({ stops, lines, snapshots, getSignSet, saveStop, deleteStop, saveSignSet, setLineStatus }),
    [stops, lines, snapshots, getSignSet, saveStop, deleteStop, saveSignSet, setLineStatus],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useStore = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}

// 原型状态面板：当前页面登记要展示的数据
const DebugCtx = createContext<{ data: unknown; set: (d: unknown) => void }>({ data: null, set: () => {} })
export function DebugProvider({ children }: { children: ReactNode }) {
  const [data, set] = useState<unknown>(null)
  const v = useMemo(() => ({ data, set }), [data])
  return <DebugCtx.Provider value={v}>{children}</DebugCtx.Provider>
}
export const useDebug = () => useContext(DebugCtx)
