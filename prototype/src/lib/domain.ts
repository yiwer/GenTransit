// PROTOTYPE — 排序、途经与编排状态的原型实现（规则见 docs/requirements.md 5.5.2、5.5.6）
import type { Line, RouteKind, Schedule, SignSet, Stop } from '../data/types'

const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: false })
const LINE_RE = /^([^\d]*)(\d+)(.*)$/

export function compareLineName(a: string, b: string): number {
  if (!a) return b ? 1 : 0
  if (!b) return -1
  const ma = a.match(LINE_RE)
  const mb = b.match(LINE_RE)
  if (!ma && !mb) return collator.compare(a, b)
  if (ma && !mb) {
    const p = ma[1]
    if (!p) return -1
    if (p === b) return 1
    return collator.compare(p, b) || 1
  }
  if (!ma && mb) {
    const p = mb[1]
    if (!p) return 1
    if (p === a) return -1
    return collator.compare(a, p) || -1
  }
  const [, pa, na, sa] = ma!
  const [, pb, nb, sb] = mb!
  if (!pa && pb) return -1
  if (pa && !pb) return 1
  const pc = collator.compare(pa, pb)
  if (pc) return pc
  const nc = Number(na) - Number(nb)
  if (nc) return nc
  return collator.compare(sa, sb)
}

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
export function cnNum(n: number): string {
  if (n <= 0) return String(n)
  if (n < 10) return CN[n]
  if (n < 20) return '十' + CN[n % 10]
  if (n < 100) return CN[Math.floor(n / 10)] + '十' + CN[n % 10]
  return String(n)
}

export interface Passage {
  key: string
  routeId: string
  nth: number
  timesAtStop: number
  lineId: string
  lineName: string
  kind: RouteKind
  terminal: string
}

export const keyOf = (routeId: string, nth: number) => `${routeId}#${nth}`

export function passagesAt(stopId: string, lines: Line[], stops: Stop[]): Passage[] {
  const stopName = (id: string) => stops.find((s) => s.id === id)?.name ?? '?'
  const out: Passage[] = []
  for (const line of lines) {
    if (line.status !== '运营') continue
    for (const route of line.routes) {
      const times = route.stopIds.filter((id) => id === stopId).length
      let nth = 0
      route.stopIds.forEach((id) => {
        if (id !== stopId) return
        nth += 1
        out.push({
          key: keyOf(route.id, nth),
          routeId: route.id,
          nth,
          timesAtStop: times,
          lineId: line.id,
          lineName: line.name,
          kind: route.kind,
          terminal: stopName(route.stopIds[route.stopIds.length - 1]),
        })
      })
    }
  }
  return out.sort((a, b) => compareLineName(a.lineName, b.lineName) || a.kind.localeCompare(b.kind) || a.nth - b.nth)
}

export type ScheduleStatus = '待编排' | '已编排' | '隐藏' | '失效'

export interface PoolItem {
  key: string
  routeId: string
  nth: number
  timesAtStop: number
  lineName: string
  kind: RouteKind
  terminal: string
  status: ScheduleStatus
  schedules: Schedule[]
}

export function poolOf(ss: SignSet, passages: Passage[]): PoolItem[] {
  const byKey = new Map<string, Schedule[]>()
  for (const s of ss.schedules) {
    const k = keyOf(s.routeId, s.nth)
    byKey.set(k, [...(byKey.get(k) ?? []), s])
  }
  const items: PoolItem[] = passages.map((p) => {
    const sch = byKey.get(p.key) ?? []
    const status: ScheduleStatus = sch.length === 0 ? '待编排' : sch.some((s) => s.place.type === 'hidden') ? '隐藏' : '已编排'
    return { key: p.key, routeId: p.routeId, nth: p.nth, timesAtStop: p.timesAtStop, lineName: p.lineName, kind: p.kind, terminal: p.terminal, status, schedules: sch }
  })
  const live = new Set(passages.map((p) => p.key))
  for (const [k, sch] of byKey) {
    if (live.has(k)) continue
    items.push({ key: k, routeId: sch[0].routeId, nth: sch[0].nth, timesAtStop: 1, lineName: sch[0].lineName, kind: sch[0].kind, terminal: '—', status: '失效', schedules: sch })
  }
  return items.sort((a, b) => compareLineName(a.lineName, b.lineName) || a.kind.localeCompare(b.kind) || a.nth - b.nth)
}

export const STATUS_ORDER: ScheduleStatus[] = ['待编排', '已编排', '隐藏', '失效']

export const uid = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}`

export const nowText = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
