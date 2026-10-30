// 编辑器队列（需求 5.5.3，M5 计划 4.1）：从工作台、站牌集列表、线路详情进入编辑器时带上来源参数；
// 第一次进入时向服务端要站点顺序，存进 sessionStorage，之后前后移动都读这份快照，顺序不变
import { QUEUE_SOURCES, type QueueSource, type SignSetQueue } from '@gentransit/shared'
import { useEffect, useState } from 'react'
import { get } from '@/lib/api'

/** 编辑器自己的参数，不属于队列来源 */
const OWN_PARAMS = ['copyFrom']

interface Snapshot {
  stopIds: string[]
  total: number
  /** 本轮已保存过的站点 */
  done: string[]
}

/** URL 上的队列来源（from 及其筛选参数，规范化排序）；没有 from 时为 null */
export function queueParams(search: URLSearchParams): URLSearchParams | null {
  const from = search.get('from')
  if (!from || !(QUEUE_SOURCES as readonly string[]).includes(from)) return null
  const p = new URLSearchParams([...search].filter(([k]) => !OWN_PARAMS.includes(k)))
  p.sort()
  return p
}

/** 编辑器链接：带上队列来源 */
export const editorHref = (stopId: string, from: QueueSource, params: Record<string, string | undefined> = {}) => {
  const p = new URLSearchParams({ from })
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v)
  return `/sign-sets/${stopId}?${p}`
}

/** 回到来源页：列表保留原筛选与页码 */
export function sourceHref(p: URLSearchParams): { to: string; label: string } {
  const from = p.get('from') as QueueSource
  if (from === 'home') return { to: '/home', label: '工作台' }
  if (from === 'line') return { to: `/lines/${p.get('lineId')}`, label: '线路' }
  const rest = new URLSearchParams([...p].filter(([k]) => k !== 'from'))
  return { to: `/sign-sets${rest.size ? `?${rest}` : ''}`, label: '站牌集' }
}

const storeKey = (p: URLSearchParams) => `gt-queue:${p}`

function read(key: string): Snapshot | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}
function write(key: string, s: Snapshot) {
  try {
    sessionStorage.setItem(key, JSON.stringify(s))
  } catch {
    // 存不了就只在本页有效
  }
}

export interface Queue {
  index: number
  stopIds: string[]
  /** 来源的总数（队列最多 500 站） */
  total: number
  done: Set<string>
  prev?: string
  next?: string
  hrefOf: (stopId: string) => string
  source: { to: string; label: string }
  markDone: (stopId: string) => void
}

/** 当前站在队列里时返回队列；没有来源参数、或当前站不在快照里（例如手改了 URL）时为 null */
export function useQueue(stopId: string, search: URLSearchParams): Queue | null {
  const params = queueParams(search)
  const key = params ? storeKey(params) : null
  const [snap, setSnap] = useState<Snapshot | null>(() => (key ? read(key) : null))
  useEffect(() => {
    if (!key || !params || snap) return
    let alive = true
    get<SignSetQueue>('/api/sign-sets/queue', Object.fromEntries(params))
      .then((q) => {
        const s = { stopIds: q.stopIds, total: q.total, done: [] }
        write(key, s)
        if (alive) setSnap(s)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // params 由 key 决定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snap])
  if (!params || !key || !snap) return null
  const index = snap.stopIds.indexOf(stopId)
  if (index < 0) return null
  return {
    index,
    stopIds: snap.stopIds,
    total: snap.total,
    done: new Set(snap.done),
    prev: snap.stopIds[index - 1],
    next: snap.stopIds[index + 1],
    hrefOf: (id) => `/sign-sets/${id}?${params}`,
    source: sourceHref(params),
    markDone: (id) => {
      const cur = read(key) ?? snap
      if (cur.done.includes(id)) return
      const s = { ...cur, done: [...cur.done, id] }
      write(key, s)
      setSnap(s)
    },
  }
}
