// 修改快照：内容结构、规范化（用于比较哈希）与字段级差异
import { LINE_MODE_LABEL, ROUTE_KIND_LABEL, ROUTE_KINDS, type ExtType, type LineMode, type RouteKind } from './enums'
import { formatExtValue, stopLabel } from './domain'
import {
  LINE_STATUS_LABEL,
  SERVICE_TYPE_LABEL,
  TICKET_TYPE_LABEL,
  passIndices,
  type LineStatus,
  type ServiceType,
  type TicketType,
} from './line'
import type { Ref, StopDetail } from './types'

export const SNAPSHOT_SCHEMA = 1

/* ---------- 内容结构 ---------- */

export interface ExtSnapshotValue {
  name: string
  type: ExtType
  value: unknown
}

/** 站点快照：自包含，引用对象连同当时的名称一起存 */
export interface StopSnapshotV1 {
  schema: 1
  name: string
  direction: string
  nameEn: string
  lng: number
  lat: number
  city: Ref | null
  district: Ref | null
  street: Ref | null
  road: Ref | null
  qrUrl: string
  facilities: {
    berths: number | null
    platformType: Ref | null
    safety: Ref | null
    waiting: string
    shelterType: Ref | null
    bigLightbox: number | null
    smallLightbox: number | null
    seats: number | null
  }
  maintainer: Ref | null
  remark: string
  landmarks: Ref[]
  photos: Ref[]
  ext: Record<string, ExtSnapshotValue>
}

const ref = (r: Ref | null): Ref | null => (r ? { id: r.id, name: r.name } : null)

export type StopSnapshotSource = Pick<
  StopDetail,
  | 'name'
  | 'direction'
  | 'nameEn'
  | 'lng'
  | 'lat'
  | 'city'
  | 'district'
  | 'street'
  | 'road'
  | 'qrUrl'
  | 'facilities'
  | 'maintainer'
  | 'remark'
  | 'landmarks'
  | 'photos'
  | 'ext'
>

/** 由站点详情构造快照内容；扩展字段带上当时的字段名与类型（含已停用字段） */
export function stopSnapshot(
  s: StopSnapshotSource,
  extDefs: { key: string; name: string; type: ExtType }[],
): StopSnapshotV1 {
  const ext: Record<string, ExtSnapshotValue> = {}
  for (const d of extDefs) {
    const v = s.ext[d.key]
    if (v !== null && v !== undefined && v !== '') ext[d.key] = { name: d.name, type: d.type, value: v }
  }
  const f = s.facilities
  return {
    schema: 1,
    name: s.name,
    direction: s.direction,
    nameEn: s.nameEn,
    lng: s.lng,
    lat: s.lat,
    city: ref(s.city),
    district: ref(s.district),
    street: ref(s.street),
    road: ref(s.road),
    qrUrl: s.qrUrl,
    facilities: {
      berths: f.berths,
      platformType: ref(f.platformType),
      safety: ref(f.safety),
      waiting: f.waiting,
      shelterType: ref(f.shelterType),
      bigLightbox: f.bigLightbox,
      smallLightbox: f.smallLightbox,
      seats: f.seats,
    },
    maintainer: ref(s.maintainer),
    remark: s.remark,
    landmarks: [...s.landmarks].map((l) => ({ id: l.id, name: l.name })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    photos: s.photos.map((p) => ({ id: p.id, name: p.originalName })),
    ext,
  }
}

/* ---------- 规范化 ---------- */

export interface NormalizeOptions {
  /** 这些路径上的数组是集合：按 id 排序后再比较 */
  sets?: string[]
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const keysAre = (o: Record<string, unknown>, ks: string[]) => {
  const own = Object.keys(o)
  return own.length === ks.length && ks.every((k) => own.includes(k))
}

/**
 * 规范化快照内容，用于计算比较哈希：
 * - 引用对象（恰好 { id, name }）只留 id，改名不算修改
 * - 扩展字段取值（恰好 { name, type, value }）只留 value
 * - 空字符串与 null 视为相同；值为空的键去掉
 * - 集合路径上的数组按 id 排序
 */
export function normalize(value: unknown, opts: NormalizeOptions = {}, path = ''): Json {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    const items = value.map((v) => normalize(v, opts, path))
    if (opts.sets?.includes(path)) {
      const idOf = (x: Json) => (isPlain(x) && typeof x.id === 'string' ? x.id : JSON.stringify(x))
      items.sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))
    }
    return items
  }
  if (isPlain(value)) {
    if (keysAre(value, ['id', 'name'])) return { id: normalize(value.id) }
    if (keysAre(value, ['name', 'type', 'value'])) return normalize(value.value, opts, path)
    const out: { [k: string]: Json } = {}
    for (const k of Object.keys(value).sort()) {
      const v = normalize(value[k], opts, path ? `${path}.${k}` : k)
      if (v !== null) out[k] = v
    }
    return out
  }
  return null
}

/** 键排序后的确定性序列化 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isPlain(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export const STOP_NORMALIZE: NormalizeOptions = { sets: ['landmarks'] }

/** 比较用的规范文本；服务端对它取 SHA-256 作为 compareHash */
export const compareText = (content: unknown, opts?: NormalizeOptions) => canonicalJson(normalize(content, opts))

/* ---------- 差异 ---------- */

export type DiffField =
  /** format：把代码值显示成中文（如模式、状态） */
  | { path: string; label: string; kind?: 'value'; format?: (v: unknown) => string }
  | { path: string; label: string; kind: 'set' }
  /**
   * 列表。labelPath：显示名取自哪个字段（如路径站的 stop.name）；
   * items：从整份快照取出要比较的数组（如把各站架的站牌摊平），不传则取 path；labelOf：自定义显示名
   */
  | {
      path: string
      label: string
      kind: 'list'
      labelPath?: string
      items?: (snapshot: unknown) => unknown[]
      labelOf?: (item: unknown) => string
    }
  | { path: string; label: string; kind: 'ext' }

export type DiffItemOp = 'added' | 'removed' | 'moved' | 'changed'

export type DiffEntry =
  | { kind: 'value'; label: string; from: string; to: string }
  | { kind: 'items'; label: string; items: { op: DiffItemOp; label: string }[] }

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (isPlain(o) ? o[k] : undefined), obj)

/** 取值的展示文本 */
export function display(v: unknown): string {
  return displayValue(v)
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (Array.isArray(v)) return v.map(displayValue).filter(Boolean).join('、')
  if (isPlain(v)) {
    if (typeof v.name === 'string') return v.name
    return JSON.stringify(v)
  }
  return String(v)
}

const same = (a: unknown, b: unknown) => canonicalJson(normalize(a)) === canonicalJson(normalize(b))
const idOf = (x: unknown) => (isPlain(x) && typeof x.id === 'string' ? x.id : canonicalJson(x))

/** 最长递增子序列里的下标集合：不在其中的公共项视为"移动" */
function lisIndices(seq: number[]): Set<number> {
  const tails: number[] = []
  const prev: number[] = new Array(seq.length).fill(-1)
  for (let i = 0; i < seq.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (seq[tails[mid]] < seq[i]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = tails[lo - 1]
    tails[lo] = i
  }
  const keep = new Set<number>()
  let k = tails.length ? tails[tails.length - 1] : -1
  while (k >= 0) {
    keep.add(k)
    k = prev[k]
  }
  return keep
}

/** 有序列表的差异：按 id 对齐，输出增、删、移动、修改；labelPath 或 labelOf 指定显示名 */
export function diffList(
  prev: unknown[],
  next: unknown[],
  labelPath?: string,
  labelOf?: (item: unknown) => string,
): { op: DiffItemOp; label: string }[] {
  const display = (x: unknown) => (labelOf ? labelOf(x) : displayValue(labelPath ? get(x, labelPath) : x))
  const out: { op: DiffItemOp; label: string }[] = []
  const prevIds = prev.map(idOf)
  const nextIds = next.map(idOf)
  const prevSet = new Set(prevIds)
  const nextSet = new Set(nextIds)
  prev.forEach((p, i) => !nextSet.has(prevIds[i]) && out.push({ op: 'removed', label: display(p) }))
  next.forEach((n, i) => !prevSet.has(nextIds[i]) && out.push({ op: 'added', label: display(n) }))
  // 公共项在新列表中的顺序，映射为旧列表下标
  const common = next.map((n, i) => ({ n, i })).filter(({ i }) => prevSet.has(nextIds[i]))
  const seq = common.map(({ i }) => prevIds.indexOf(nextIds[i]))
  const keep = lisIndices(seq)
  common.forEach(({ n }, ci) => {
    const p = prev[seq[ci]]
    if (!keep.has(ci)) out.push({ op: 'moved', label: display(n) })
    else if (!same(p, n)) out.push({ op: 'changed', label: display(n) })
  })
  return out
}

/** 两份快照之间的字段级差异；prev 为 null 时（新增）返回空 */
export function diffSnapshots(prev: unknown, next: unknown, spec: DiffField[]): DiffEntry[] {
  if (!prev || !next) return []
  const out: DiffEntry[] = []
  for (const f of spec) {
    const a = f.kind === 'list' && f.items ? f.items(prev) : get(prev, f.path)
    const b = f.kind === 'list' && f.items ? f.items(next) : get(next, f.path)
    if (f.kind === 'set' || f.kind === 'list') {
      const pa = Array.isArray(a) ? a : []
      const pb = Array.isArray(b) ? b : []
      const items =
        f.kind === 'set'
          ? [
              ...pa
                .filter((x) => !pb.some((y) => idOf(y) === idOf(x)))
                .map((x) => ({ op: 'removed' as const, label: display(x) })),
              ...pb
                .filter((x) => !pa.some((y) => idOf(y) === idOf(x)))
                .map((x) => ({ op: 'added' as const, label: display(x) })),
            ]
          : diffList(pa, pb, f.labelPath, f.labelOf)
      if (items.length) out.push({ kind: 'items', label: f.label, items })
    } else if (f.kind === 'ext') {
      const ea = isPlain(a) ? (a as Record<string, ExtSnapshotValue>) : {}
      const eb = isPlain(b) ? (b as Record<string, ExtSnapshotValue>) : {}
      for (const k of [...new Set([...Object.keys(ea), ...Object.keys(eb)])].sort()) {
        const va = ea[k]?.value ?? null
        const vb = eb[k]?.value ?? null
        if (!same(va, vb))
          out.push({
            kind: 'value',
            label: eb[k]?.name ?? ea[k]?.name ?? k,
            from: formatExtValue(va),
            to: formatExtValue(vb),
          })
      }
    } else if (!same(a, b)) {
      const fmt = f.format ?? display
      out.push({ kind: 'value', label: f.label, from: a == null ? '' : fmt(a), to: b == null ? '' : fmt(b) })
    }
  }
  return out
}

export const STOP_DIFF_SPEC: DiffField[] = [
  { path: 'name', label: '站名' },
  { path: 'direction', label: '方位' },
  { path: 'nameEn', label: '英文名' },
  { path: 'lng', label: '经度' },
  { path: 'lat', label: '纬度' },
  { path: 'city', label: '市' },
  { path: 'district', label: '区' },
  { path: 'street', label: '街道' },
  { path: 'road', label: '路段' },
  { path: 'qrUrl', label: '二维码 URL' },
  { path: 'facilities.berths', label: '泊位数' },
  { path: 'facilities.platformType', label: '站台类型' },
  { path: 'facilities.safety', label: '安全设施' },
  { path: 'facilities.waiting', label: '候车设施' },
  { path: 'facilities.shelterType', label: '候车亭类型' },
  { path: 'facilities.bigLightbox', label: '大灯箱数' },
  { path: 'facilities.smallLightbox', label: '小灯箱数' },
  { path: 'facilities.seats', label: '座椅数' },
  { path: 'maintainer', label: '维护公司' },
  { path: 'remark', label: '备注' },
  { path: 'landmarks', label: '地标', kind: 'set' },
  { path: 'photos', label: '照片', kind: 'list' },
  { path: 'ext', label: '扩展字段', kind: 'ext' },
]

/** 改动了哪些字段（标签列表），用于"未保存：改了哪些字段"和快照说明 */
export const changedLabels = (prev: unknown, next: unknown, spec: DiffField[]) =>
  diffSnapshots(prev, next, spec).map((d) => d.label)

/* ---------- 线路快照（M2 计划 3.2） ---------- */

export interface RouteStopSnapshot {
  /** 站点 ID + 第几次途经：重建路径站不产生假差异 */
  id: string
  /** 名称写"站名（方位）"；规范化后只留 ID，站点改名不改变哈希 */
  stop: Ref
  times: string[]
  ext: Record<string, ExtSnapshotValue>
}

export interface RouteSnapshot {
  serviceType: ServiceType | null
  serviceTime: string
  interval: string
  stops: RouteStopSnapshot[]
}

export interface LineSnapshotV1 {
  schema: 1
  name: string
  number: string
  nameEn: string
  mode: LineMode
  status: LineStatus
  ticketType: TicketType | null
  fare: string
  company: Ref | null
  fareSystem: Ref | null
  ext: Record<string, ExtSnapshotValue>
  routes: Partial<Record<RouteKind, RouteSnapshot>>
}

export interface LineSnapshotSource {
  name: string
  number: string
  nameEn: string
  mode: LineMode
  status: LineStatus
  ticketType: TicketType | null
  fare: string
  company: Ref | null
  fareSystem: Ref | null
  ext: Record<string, unknown>
  routes: {
    kind: RouteKind
    serviceType: ServiceType | null
    serviceTime: string
    interval: string
    stops: { stop: { id: string; name: string; direction: string }; times: string[]; ext: Record<string, unknown> }[]
  }[]
}

type ExtDefLite = { key: string; name: string; type: ExtType }

const extSnapshot = (values: Record<string, unknown>, defs: ExtDefLite[]) => {
  const out: Record<string, ExtSnapshotValue> = {}
  for (const d of defs) {
    const v = values[d.key]
    if (v !== null && v !== undefined && v !== '') out[d.key] = { name: d.name, type: d.type, value: v }
  }
  return out
}

/** 由线路详情构造快照内容：走向按走向名作键，路径站 ID = 站点 ID + 第几次途经 */
export function lineSnapshot(s: LineSnapshotSource, lineExt: ExtDefLite[], routeStopExt: ExtDefLite[]): LineSnapshotV1 {
  const routes: Partial<Record<RouteKind, RouteSnapshot>> = {}
  for (const r of s.routes) {
    const pass = passIndices(r.stops.map((x) => x.stop.id))
    routes[r.kind] = {
      serviceType: r.serviceType,
      serviceTime: r.serviceTime,
      interval: r.interval,
      stops: r.stops.map((x, i) => ({
        id: `${x.stop.id}#${pass[i]}`,
        stop: { id: x.stop.id, name: stopLabel(x.stop) },
        times: [...x.times],
        ext: extSnapshot(x.ext, routeStopExt),
      })),
    }
  }
  return {
    schema: 1,
    name: s.name,
    number: s.number,
    nameEn: s.nameEn,
    mode: s.mode,
    status: s.status,
    ticketType: s.ticketType,
    fare: s.fare,
    company: ref(s.company),
    fareSystem: ref(s.fareSystem),
    ext: extSnapshot(s.ext, lineExt),
    routes,
  }
}

export const LINE_NORMALIZE: NormalizeOptions = {}

const label =
  <T extends string>(map: Record<T, string>) =>
  (v: unknown) =>
    map[v as T] ?? String(v)

export const LINE_DIFF_SPEC: DiffField[] = [
  { path: 'name', label: '线路名' },
  { path: 'number', label: '管理编号' },
  { path: 'nameEn', label: '英文名' },
  { path: 'mode', label: '线路模式', format: label(LINE_MODE_LABEL) },
  { path: 'status', label: '状态', format: label(LINE_STATUS_LABEL) },
  { path: 'company', label: '公交公司' },
  { path: 'ticketType', label: '售票类型', format: label(TICKET_TYPE_LABEL) },
  { path: 'fareSystem', label: '票制' },
  { path: 'fare', label: '票价' },
  { path: 'ext', label: '扩展字段', kind: 'ext' },
  ...ROUTE_KINDS.flatMap((k): DiffField[] => [
    { path: `routes.${k}.serviceType`, label: `${ROUTE_KIND_LABEL[k]} · 服务类型`, format: label(SERVICE_TYPE_LABEL) },
    { path: `routes.${k}.serviceTime`, label: `${ROUTE_KIND_LABEL[k]} · 服务时间` },
    { path: `routes.${k}.interval`, label: `${ROUTE_KIND_LABEL[k]} · 发车间隔` },
    { path: `routes.${k}.stops`, label: `${ROUTE_KIND_LABEL[k]} · 站序`, kind: 'list', labelPath: 'stop.name' },
  ]),
]
