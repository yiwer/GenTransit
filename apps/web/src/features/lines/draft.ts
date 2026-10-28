// 线路表单的草稿：与接口的 LineInput 互转；改模式按位置对应；构造快照用于"改了哪些字段"与冲突差异
import {
  LINE_DIFF_SPEC,
  MODE_ROUTE_KINDS,
  changedLabels,
  lineInput,
  lineSnapshot,
  type BusCompany,
  type DictItem,
  type ExtFieldDef,
  type LineDetail,
  type LineInputRaw,
  type LineMode,
  type LineSnapshotV1,
  type RouteKind,
  type ServiceType,
  type TicketType,
} from '@gentransit/shared'

export interface StopRef {
  id: string
  name: string
  direction: string
  lng: number
  lat: number
}

export interface StopRow {
  /** 行的稳定键（拖拽排序用），与数据库 ID 无关 */
  key: string
  stop: StopRef
  times: string[]
  ext: Record<string, unknown>
}

export interface RouteDraft {
  kind: RouteKind
  serviceType: ServiceType | null
  serviceTime: string
  interval: string
  stops: StopRow[]
}

export interface LineDraft {
  name: string
  number: string
  nameEn: string
  mode: LineMode
  status: 'running' | 'suspended'
  companyId: string | null
  ticketType: TicketType | null
  fareSystemId: string | null
  fare: string
  ext: Record<string, unknown>
  routes: RouteDraft[]
  /** 改模式后多出来的走向：切回原模式时恢复，保存时删除 */
  stash: RouteDraft[]
}

let seq = 0
export const rowKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`

export const emptyRoute = (kind: RouteKind): RouteDraft => ({
  kind,
  serviceType: null,
  serviceTime: '',
  interval: '',
  stops: [],
})

export const blankLineDraft = (mode: LineMode = 'twoway'): LineDraft => ({
  name: '',
  number: '',
  nameEn: '',
  mode,
  status: 'running',
  companyId: null,
  ticketType: null,
  fareSystemId: null,
  fare: '',
  ext: {},
  routes: MODE_ROUTE_KINDS[mode].map(emptyRoute),
  stash: [],
})

export const lineDraftOf = (l: LineDetail): LineDraft => ({
  name: l.name,
  number: l.number,
  nameEn: l.nameEn,
  mode: l.mode,
  status: l.status,
  companyId: l.company?.id ?? null,
  ticketType: l.ticketType,
  fareSystemId: l.fareSystem?.id ?? null,
  fare: l.fare,
  ext: { ...l.ext },
  routes: MODE_ROUTE_KINDS[l.mode].map((k) => {
    const r = l.routes.find((x) => x.kind === k)
    return r
      ? {
          kind: k,
          serviceType: r.serviceType,
          serviceTime: r.serviceTime,
          interval: r.interval,
          stops: r.stops.map((s) => ({ key: rowKey(), stop: s.stop, times: [...s.times], ext: { ...s.ext } })),
        }
      : emptyRoute(k)
  }),
  stash: [],
})

/**
 * 改模式（M2 计划 2.1）：按位置对应，第 i 个走向改名为新模式的第 i 个走向并保留数据；
 * 多出来的放进 stash（保存时删除，切回原模式时按位置恢复）
 */
export function changeMode(d: LineDraft, mode: LineMode): LineDraft {
  const all = [...d.routes, ...d.stash]
  const kinds = MODE_ROUTE_KINDS[mode]
  return {
    ...d,
    mode,
    routes: kinds.map((k, i) => (all[i] ? { ...all[i], kind: k } : emptyRoute(k))),
    stash: all.slice(kinds.length),
  }
}

/** 反向生成：用另一个走向的站序倒序生成本走向的初稿（只在双边、双环下使用） */
export function reverseOf(source: RouteDraft): StopRow[] {
  return [...source.stops].reverse().map((s) => ({ key: rowKey(), stop: s.stop, times: [], ext: {} }))
}

export const toLineInput = (d: LineDraft): LineInputRaw => ({
  name: d.name,
  number: d.number,
  nameEn: d.nameEn,
  mode: d.mode,
  companyId: d.companyId,
  ticketType: d.ticketType,
  fareSystemId: d.fareSystemId,
  fare: d.fare,
  ext: d.ext,
  routes: d.routes.map((r) => ({
    kind: r.kind,
    serviceType: r.serviceType,
    serviceTime: r.serviceTime,
    interval: r.interval,
    stops: r.stops.map((s) => ({ stopId: s.stop.id, times: s.times, ext: s.ext })),
  })),
})

/** 客户端校验：与服务端同一个 zod 模式；键为字段路径（如 routes.0.stops） */
export function validateLine(d: LineDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  const r = lineInput.safeParse(toLineInput(d))
  if (!r.success)
    for (const i of r.error.issues) {
      const k = i.path.join('.')
      if (!errors[k]) errors[k] = i.message
    }
  return errors
}

export interface LineLookups {
  companies: BusCompany[]
  dicts: DictItem[]
  lineExt: ExtFieldDef[]
  routeStopExt: ExtFieldDef[]
}

/** 草稿 → 快照内容（公司、票制名称取自已加载的列表） */
export function lineSnapshotOf(d: LineDraft, lk: LineLookups): LineSnapshotV1 {
  const company = lk.companies.find((c) => c.id === d.companyId)
  const fare = lk.dicts.find((x) => x.id === d.fareSystemId)
  return lineSnapshot(
    {
      name: d.name.trim(),
      number: d.number.trim(),
      nameEn: d.nameEn.trim(),
      mode: d.mode,
      status: d.status,
      ticketType: d.ticketType,
      fare: d.fare.trim(),
      company: company ? { id: company.id, name: company.name } : d.companyId ? { id: d.companyId, name: '' } : null,
      fareSystem: fare ? { id: fare.id, name: fare.name } : d.fareSystemId ? { id: d.fareSystemId, name: '' } : null,
      ext: d.ext,
      routes: d.routes.map((r) => ({
        kind: r.kind,
        serviceType: r.serviceType,
        serviceTime: r.serviceTime.trim(),
        interval: r.interval.trim(),
        stops: r.stops.map((s) => ({ stop: s.stop, times: s.times, ext: s.ext })),
      })),
    },
    lk.lineExt,
    lk.routeStopExt,
  )
}

export const lineChanges = (base: LineDraft, d: LineDraft, lk: LineLookups) =>
  changedLabels(lineSnapshotOf(base, lk), lineSnapshotOf(d, lk), LINE_DIFF_SPEC)
