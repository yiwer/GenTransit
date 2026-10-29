import {
  MODE_ROUTE_KINDS,
  passIndices,
  poolOf,
  countsOf,
  type ExtOwner,
  type Passage,
  type RouteInfo,
  type RouteKind,
  type SignSetDraft,
  type V1Line,
  type V1Passage,
  type V1SignSet,
  type V1Stop,
} from '@gentransit/shared'
import type { Prisma } from '../generated/prisma/client'
import type { Tx } from '../prisma/prisma.service'

/**
 * 只读 API 的输出映射（M4 计划 3.1、3.2 节）：字段 camelCase；时间 ISO 8601 UTC；
 * 引用写成 { id, name }（名称取当前值）；枚举输出代码值；文件写成 { id, url }，地址为 /api/v1/files/{id}
 */

const REF = { select: { id: true, name: true } } as const

export const fileOf = (id: string) => ({ id, url: `/api/v1/files/${id}` })
const ref = (r: { id: string; name: string } | null) => (r ? { id: r.id, name: r.name } : null)
const iso = (d: Date) => d.toISOString()
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')

/* ---------------- 扩展字段 ---------------- */

export type ExtKeys = Record<ExtOwner, string[]>

/** 启用中的扩展字段键（每页读一次） */
export async function enabledExtKeys(db: Tx): Promise<ExtKeys> {
  const rows = await db.extField.findMany({ where: { enabled: true }, select: { owner: true, key: true } })
  const out: ExtKeys = { stop: [], line: [], routeStop: [] }
  for (const r of rows) out[r.owner].push(r.key)
  return out
}

/** 只含启用中的字段，空值不输出 */
export function extOf(values: unknown, keys: string[]): Record<string, string | number | string[]> {
  const v = (values ?? {}) as Record<string, unknown>
  const out: Record<string, string | number | string[]> = {}
  for (const k of keys) {
    const x = v[k]
    if (x === null || x === undefined || x === '') continue
    if (typeof x === 'string' || typeof x === 'number') out[k] = x
    else if (Array.isArray(x)) out[k] = x.map(String)
  }
  return out
}

/* ---------------- 站点 ---------------- */

export const STOP_V1_INCLUDE = {
  city: REF,
  district: REF,
  street: REF,
  road: REF,
  platformType: REF,
  safety: REF,
  shelterType: REF,
  maintainer: REF,
  landmarks: { include: { landmark: REF } },
  photos: { orderBy: { sort: 'asc' as const }, select: { uploadId: true } },
} satisfies Prisma.StopInclude

type StopRow = Prisma.StopGetPayload<{ include: typeof STOP_V1_INCLUDE }>

export function stopOf(s: StopRow, ext: ExtKeys): V1Stop {
  return {
    id: s.id,
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
      berths: s.berths,
      platformType: ref(s.platformType),
      safety: ref(s.safety),
      waiting: s.waiting,
      shelterType: ref(s.shelterType),
      bigLightbox: s.bigLightbox,
      smallLightbox: s.smallLightbox,
      seats: s.seats,
    },
    maintainer: ref(s.maintainer),
    remark: s.remark,
    landmarks: s.landmarks.map((l) => ({ id: l.landmark.id, name: l.landmark.name })).sort(byName),
    photos: s.photos.map((p) => fileOf(p.uploadId)),
    ext: extOf(s.ext, ext.stop),
    createdAt: iso(s.createdAt),
    changedAt: iso(s.updatedAt),
  }
}

/* ---------------- 线路 ---------------- */

export const LINE_V1_INCLUDE = {
  company: REF,
  fareSystem: REF,
  routes: {
    include: {
      stops: {
        orderBy: { seq: 'asc' as const },
        include: { stop: { select: { id: true, name: true, direction: true } } },
      },
    },
  },
} satisfies Prisma.LineInclude

type LineRow = Prisma.LineGetPayload<{ include: typeof LINE_V1_INCLUDE }>

const KIND_ORDER = Object.values(MODE_ROUTE_KINDS).flat()
const kindOrder = (k: RouteKind) => KIND_ORDER.indexOf(k)

export function lineOf(l: LineRow, ext: ExtKeys): V1Line {
  return {
    id: l.id,
    name: l.name,
    number: l.number,
    nameEn: l.nameEn,
    mode: l.mode,
    status: l.status,
    ticketType: l.ticketType,
    fareSystem: ref(l.fareSystem),
    fare: l.fare,
    company: ref(l.company),
    ext: extOf(l.ext, ext.line),
    routes: [...l.routes]
      .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
      .map((r) => {
        const pass = passIndices(r.stops.map((x) => x.stopId))
        return {
          id: r.id,
          kind: r.kind,
          serviceType: r.serviceType,
          serviceTime: r.serviceTime,
          interval: r.interval,
          stops: r.stops.map((x, i) => ({
            seq: i + 1,
            stop: { id: x.stop.id, name: x.stop.name, direction: x.stop.direction },
            pass: pass[i],
            times: [...x.times],
            ext: extOf(x.ext, ext.routeStop),
          })),
        }
      }),
    createdAt: iso(l.createdAt),
    changedAt: iso(l.updatedAt),
  }
}

/* ---------------- 站牌集 ---------------- */

export interface SignSetBundle {
  id: string
  stop: { id: string; name: string; direction: string }
  reminder: string
  changedAt: Date
  shelves: {
    id: string
    no: number
    type: { id: string; name: string }
    name: string
    desc: string
    noPhysical: boolean
    material: string
    sort: number
    boards: {
      id: string
      no: number
      face: V1SignSet['shelves'][number]['boards'][number]['face']
      kind: V1SignSet['shelves'][number]['boards'][number]['kind']
      width: number
      height: number
      remark: string
      slots: {
        id: string
        no: number
        kind: V1SignSet['shelves'][number]['boards'][number]['slots'][number]['kind']
        note: string
        width: number
        height: number
      }[]
    }[]
  }[]
  draft: SignSetDraft
  passages: Passage[]
  routes: RouteInfo[]
}

/** 按途经归组；待编排的途经也列出，places 为空 */
export function signSetOf(b: SignSetBundle): V1SignSet {
  const pool = poolOf(b.draft, b.passages, b.routes)
  const passages: V1Passage[] = pool.map((p) => ({
    line: { id: p.lineId, name: p.lineName },
    route: { id: p.routeId, kind: p.kind },
    pass: p.pass,
    status: p.status,
    places: p.schedules
      .filter((s) => s.placement !== 'hidden' && s.boardId)
      .map((s) => ({ boardId: s.boardId!, slotId: s.slotId, order: s.placement === 'board' ? s.order : null }))
      .sort((a, b) => (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : (a.order ?? 0) - (b.order ?? 0))),
  }))
  return {
    id: b.id,
    stop: { id: b.stop.id, name: b.stop.name, direction: b.stop.direction },
    reminder: b.reminder,
    shelves: b.shelves.map((sh) => ({
      id: sh.id,
      no: sh.no,
      type: { id: sh.type.id, name: sh.type.name },
      name: sh.name,
      desc: sh.desc,
      noPhysical: sh.noPhysical,
      material: sh.material,
      sort: sh.sort,
      boards: sh.boards.map((bd) => ({
        id: bd.id,
        no: bd.no,
        face: bd.face,
        kind: bd.kind,
        width: bd.width,
        height: bd.height,
        remark: bd.remark,
        slots: bd.slots.map((s) => ({
          id: s.id,
          no: s.no,
          kind: s.kind,
          note: s.note,
          width: s.width,
          height: s.height,
        })),
      })),
    })),
    passages,
    counts: countsOf(pool),
    changedAt: iso(b.changedAt),
  }
}
