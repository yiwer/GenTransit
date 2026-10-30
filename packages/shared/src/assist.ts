// M5 流程简化的规则（M5 计划第 2 节）：距离、对向站点（BR-19）、方位疑似反了（BR-20）、
// 插入位置建议、相邻站距离提醒，以及数据体检、批量修改、成组修改与编辑器队列的请求和返回类型
import { z } from 'zod'
import type { LineCheck, OrientationMode, RouteKind, StopCheck } from './enums'
import { ROUTE_KINDS } from './enums'
import { signSetListQuery, stopListQuery } from './schemas'
import type { Ref } from './types'

export interface Pt {
  lng: number
  lat: number
}

const RAD = Math.PI / 180

/** 球面距离（米），haversine；GCJ-02 坐标直接算，城市尺度误差可忽略 */
export function distanceM(a: Pt, b: Pt): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 以 o 为原点的局部等距投影（米），x 向东、y 向北 */
const project = (o: Pt, p: Pt) => ({
  x: (p.lng - o.lng) * Math.cos(o.lat * RAD) * 111320,
  y: (p.lat - o.lat) * 110540,
})

/* ---------------- 对向站点（BR-19） ---------------- */

export const OPPOSITE_MAX_M = 300
export const OPPOSITE_DIR: Readonly<Record<string, string>> = { 东: '西', 西: '东', 南: '北', 北: '南' }

/** 对向站点应有的方位；null 表示"同名的任意其他站点"（编码模式，或方位为"无""场站"） */
export const oppositeDirOf = (dir: string, mode: OrientationMode): string | null =>
  mode === 'orientation' ? (OPPOSITE_DIR[dir] ?? null) : null

/** 站点的最小引用（站序编辑、对向站点） */
export interface StopRef {
  id: string
  name: string
  direction: string
  lng: number
  lat: number
}

/** POST /api/stops/opposites 的返回：站点 ID → 对向站点（没有为 null） */
export type OppositeMap = Record<string, StopRef | null>

export const stopOppositesInput = z.object({ ids: z.array(z.uuid()).min(1).max(500) })

/* ---------------- 方位疑似反了（BR-20） ---------------- */

export const WRONG_SIDE_TOLERANCE_M = 5
const MIN_HEADING_M = 10

/**
 * 公交靠右行驶，站点应在行驶方向右侧。行驶方向取前后两站（首站 cur→next，末站 prev→cur）；
 * 对向站点比本站更靠右超过容差时返回 true
 */
export function wrongSide(prev: Pt | null, cur: Pt, next: Pt | null, opposite: Pt): boolean {
  if (!prev && !next) return false
  const o = prev ?? cur
  const v = project(o, next ?? cur)
  const len = Math.hypot(v.x, v.y)
  if (len < MIN_HEADING_M) return false
  /** 带符号的垂直距离：负数在行驶方向右侧 */
  const side = (p: Pt) => {
    const w = project(o, p)
    return (v.x * w.y - v.y * w.x) / len
  }
  return side(opposite) < side(cur) - WRONG_SIDE_TOLERANCE_M
}

/* ---------------- 插入位置与站间距离 ---------------- */

export interface InsertSuggestion {
  /** 插入后 X 在站序里的下标 */
  at: number
  reason: 'between' | 'head' | 'tail'
}

/** 站点加入站序的建议位置：绕行距离最短的相邻两站之间，或首末站（需求第 11 节） */
export function suggestInsert(stops: Pt[], x: Pt): InsertSuggestion {
  if (!stops.length) return { at: 0, reason: 'tail' }
  let best: InsertSuggestion & { cost: number } = { at: 0, reason: 'head', cost: distanceM(x, stops[0]) }
  for (let i = 0; i + 1 < stops.length; i++) {
    const cost = distanceM(stops[i], x) + distanceM(x, stops[i + 1]) - distanceM(stops[i], stops[i + 1])
    if (cost < best.cost) best = { at: i + 1, reason: 'between', cost }
  }
  const tail = distanceM(stops[stops.length - 1], x)
  if (tail < best.cost) best = { at: stops.length, reason: 'tail', cost: tail }
  return { at: best.at, reason: best.reason }
}

export const STOP_GAP_WARN_M = 3000

/** 与前一站距离超过阈值的行下标 */
export function gapWarnings(stops: Pt[], limit = STOP_GAP_WARN_M): number[] {
  const out: number[] = []
  for (let i = 1; i < stops.length; i++) if (distanceM(stops[i - 1], stops[i]) > limit) out.push(i)
  return out
}

/** 距离的显示：不到 1 公里用米，否则保留一位小数的公里 */
export const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)

/* ---------------- 数据体检（需求 5.2） ---------------- */

export const CHECK_LABEL: Record<StopCheck | LineCheck, string> = {
  noNameEn: '缺英文名',
  noRegion: '缺区、街道或路段',
  noShelf: '有线路经过但没有站架',
  noPhoto: '没有照片',
  noTrack: '没有算轨迹',
  trackStale: '轨迹已过期',
  gap: `相邻站相距超过 ${STOP_GAP_WARN_M / 1000} 公里`,
  wrongSide: '方位疑似反了',
}

export interface DataChecks {
  stops: Record<StopCheck, number>
  lines: Record<LineCheck, number>
  /** 有待编排或失效编排的站牌集 */
  pendingSets: number
}

/* ---------------- 成组修改线路：加入、替换（BR-22） ---------------- */

const rev = z.number().int().positive()

export const stopJoinInput = z.object({
  items: z
    .array(
      z.object({
        lineId: z.uuid(),
        rev,
        inserts: z
          .array(z.object({ kind: z.enum(ROUTE_KINDS), stopId: z.uuid(), at: z.number().int().min(0) }))
          .min(1)
          .max(4),
      }),
    )
    .min(1, '至少选一条线路')
    .max(50),
})
export type StopJoinInput = z.infer<typeof stopJoinInput>

export const stopReplaceInput = z.object({
  targetId: z.uuid(),
  refs: z
    .array(z.object({ lineId: z.uuid(), rev, kind: z.enum(ROUTE_KINDS), index: z.number().int().min(0) }))
    .min(1, '至少选一处引用')
    .max(500),
})
export type StopReplaceInput = z.infer<typeof stopReplaceInput>

/** 站点被路径站引用的一处（替换站点用） */
export interface StopReference {
  lineId: string
  lineName: string
  lineSuspended: boolean
  rev: number
  routeKind: RouteKind
  /** 在站序中的下标 */
  index: number
  prev: StopRef | null
  next: StopRef | null
}

export interface GroupLineResult {
  lines: { id: string; name: string; changed: boolean }[]
}

/* ---------------- 批量修改站点（需求 5.3.2） ---------------- */

export const STOP_BATCH_MAX = 2000

const patchRef = z.uuid().nullable().optional()
const patchCount = z.number().int('应为整数').min(0, '不能为负数').nullable().optional()

/** 键不出现 = 不改；值为 null（文本为空串）= 清空 */
export const stopBatchPatch = z
  .object({
    region: z
      .object({ cityId: z.uuid().nullable(), districtId: z.uuid().nullable(), streetId: z.uuid().nullable() })
      .nullable()
      .optional(),
    roadId: patchRef,
    maintainerId: patchRef,
    facilities: z
      .object({
        berths: patchCount,
        platformTypeId: patchRef,
        safetyId: patchRef,
        waiting: z.string().trim().max(200, '不能超过 200 字').optional(),
        shelterTypeId: patchRef,
        bigLightbox: patchCount,
        smallLightbox: patchCount,
        seats: patchCount,
      })
      .optional(),
    ext: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (p) =>
      p.region !== undefined ||
      p.roadId !== undefined ||
      p.maintainerId !== undefined ||
      Object.keys(p.facilities ?? {}).length > 0 ||
      Object.keys(p.ext ?? {}).length > 0,
    '至少要改一个字段',
  )
export type StopBatchPatch = z.infer<typeof stopBatchPatch>

export const stopBatchScope = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(STOP_BATCH_MAX) }),
  z.object({ filter: stopListQuery.omit({ page: true, size: true }) }),
])

export const stopBatchInput = z.object({ scope: stopBatchScope, patch: stopBatchPatch })
export type StopBatchInput = z.infer<typeof stopBatchInput>
export type StopBatchInputRaw = z.input<typeof stopBatchInput>

export interface StopBatchPreview {
  selected: number
  changing: number
  sample: { id: string; name: string; direction: string; fields: string[] }[]
}

export interface StopBatchResult {
  selected: number
  changed: number
}

/* ---------------- 沿线编排进度（需求 5.4.6）与编辑器队列（5.5.3） ---------------- */

export type ArrangeStatus = 'placed' | 'hidden' | 'waiting'

export interface LineArrangement {
  suspended: boolean
  routes: { routeId: string; kind: RouteKind; stops: { stopId: string; pass: number; status: ArrangeStatus }[] }[]
  /** 不在站序上、但仍留有本线路编排的站点 */
  invalid: (Ref & { direction: string; count: number })[]
  totals: { placed: number; hidden: number; waiting: number; invalidStops: number }
}

export const QUEUE_MAX = 500
export const QUEUE_SOURCES = ['list', 'home', 'line'] as const
export type QueueSource = (typeof QUEUE_SOURCES)[number]

export const signSetQueueQuery = signSetListQuery
  .omit({ page: true, size: true })
  .extend({ from: z.enum(QUEUE_SOURCES), lineId: z.uuid().optional() })
export type SignSetQueueQuery = z.infer<typeof signSetQueueQuery>

export interface SignSetQueue {
  stopIds: string[]
  total: number
}
