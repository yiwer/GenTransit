import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  ERROR_CODES,
  dedupeAdjacent,
  simplifyTrack,
  trackKeyOf,
  trackSegments,
  type LineTrackResult,
  type LngLatPair,
  type RouteTrack,
} from '@gentransit/shared'
import { AMAP_UPSTREAMS, scrub, type AmapUpstreams } from '../amap/regeo.service'
import { AppError, notFound } from '../common/errors'
import { ENV, type Env } from '../config/env'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

/** 走向表里和轨迹有关的列 */
export interface TrackRow {
  track: Prisma.JsonValue | null
  trackKey: string | null
  trackDistance: number | null
  trackAt: Date | null
}

/** 读取时组装轨迹：站序坐标的指纹和计算时不同就是已过期 */
export function trackOf(r: TrackRow, coords: LngLatPair[]): RouteTrack | null {
  if (!Array.isArray(r.track) || !r.trackAt) return null
  return {
    points: r.track as LngLatPair[],
    distance: r.trackDistance ?? 0,
    computedAt: r.trackAt.toISOString(),
    stale: r.trackKey !== trackKeyOf(dedupeAdjacent(coords)),
  }
}

/** 高德的错误码转成中文说明（常见的几种），其余原样带上 */
const AMAP_ERRORS: Record<string, string> = {
  '10001': 'Key 不正确或已过期',
  '10003': '今天的调用次数已用完',
  '10004': '调用太频繁，请稍后再试',
  '10019': '调用太频繁（超过每秒次数限制），请稍后再试',
  '10020': '调用太频繁（超过每秒次数限制），请稍后再试',
  '10021': '调用太频繁（超过每秒次数限制），请稍后再试',
  '10009': 'Key 的服务平台不对，需要"Web 服务"类型的 Key',
  '10044': '今天的调用次数已用完',
  '20003': '高德服务暂时不可用',
}

class PlanError extends Error {}

/** 任意两次请求之间至少隔这么久（毫秒，跨走向、跨线路都算），避免超过每秒调用次数限制 */
const GAP_MS = 400
/** 每秒次数超限的错误码：等一会儿自动重试 */
const QPS_CODES = new Set(['10004', '10019', '10020', '10021'])
const RETRY_WAIT_MS = [1000, 2000]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type DrivingResponse = {
  status?: string
  info?: string
  infocode?: string
  route?: { paths?: { distance?: string; steps?: { polyline?: string }[] }[] }
}

/**
 * 走向轨迹：按站序把站点依次作为途经点，调用高德 Web 服务"驾车路线规划 2.0"（/v5/direction/driving），
 * 每次最多 16 个途经点，长走向分段请求后拼接，再抽稀到 2 米。只在用户手动点"计算轨迹"时调用。
 * 结果存在走向上，不进修改快照；线路的 updatedAt 随之更新（只读 API 的增量同步能取到）
 */
@Injectable()
export class RouteTrackService {
  private readonly logger = new Logger('RouteTrack')
  /** 上一次请求高德的时间：所有请求排队，保持最小间隔 */
  private lastCall = 0

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(AMAP_UPSTREAMS) private readonly up: AmapUpstreams,
  ) {}

  available() {
    return Boolean(this.env.AMAP_API_KEY)
  }

  /** 计算一条线路的走向轨迹（默认全部走向）；各走向分别保存，一个失败不影响其他 */
  async computeLine(lineId: string, routeIds?: string[]): Promise<LineTrackResult> {
    const key = this.env.AMAP_API_KEY
    if (!key)
      throw new AppError(
        503,
        ERROR_CODES.amapUnavailable,
        '服务端没有配置高德 Web 服务 Key（AMAP_API_KEY），不能计算轨迹',
      )
    const line = await this.prisma.line.findUnique({
      where: { id: lineId },
      select: {
        routes: {
          select: {
            id: true,
            stops: { orderBy: { seq: 'asc' }, select: { stop: { select: { lng: true, lat: true } } } },
          },
        },
      },
    })
    if (!line) throw notFound('线路')
    const routes = routeIds ? line.routes.filter((r) => routeIds.includes(r.id)) : line.routes
    const results: LineTrackResult['results'] = []
    for (const r of routes) {
      const coords = dedupeAdjacent(r.stops.map((s) => [s.stop.lng, s.stop.lat] as LngLatPair))
      try {
        if (coords.length < 2) throw new PlanError('至少要有 2 个站点位置不同')
        const plan = await this.plan(coords, key)
        const now = new Date()
        await this.prisma.$transaction([
          this.prisma.route.update({
            where: { id: r.id },
            data: {
              track: plan.points,
              trackKey: trackKeyOf(coords),
              trackDistance: Math.round(plan.distance),
              trackAt: now,
            },
          }),
          // 只读 API 的"有变化"按线路的 updatedAt；不改 rev，不影响打开着的编辑表单
          this.prisma.line.update({ where: { id: lineId }, data: { updatedAt: now } }),
        ])
        results.push({ routeId: r.id, ok: true })
      } catch (e) {
        const message = e instanceof PlanError ? e.message : '无法连接高德服务，请稍后再试'
        if (!(e instanceof PlanError)) this.logger.warn(`走向 ${r.id} 计算轨迹失败：${scrub(String(e), [key])}`)
        results.push({ routeId: r.id, ok: false, message: scrub(message, [key]) })
      }
    }
    return { results }
  }

  /** 排队请求：和上一次请求至少隔 GAP_MS；每秒次数超限时等 1 秒、2 秒各重试一次 */
  private async request(url: string): Promise<DrivingResponse> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastCall + GAP_MS - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastCall = Date.now()
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const data = (await res.json()) as DrivingResponse
      if (data.status === '1' || !QPS_CODES.has(data.infocode ?? '') || attempt >= RETRY_WAIT_MS.length) return data
      await sleep(RETRY_WAIT_MS[attempt])
    }
  }

  /** 分段请求并拼接：相邻两段共用端点，拼接时去掉重复的接缝点 */
  private async plan(coords: LngLatPair[], key: string) {
    const points: LngLatPair[] = []
    let distance = 0
    const segments = trackSegments(coords)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const fmt = (p: LngLatPair) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`
      const qs = new URLSearchParams({
        key,
        origin: fmt(seg[0]),
        destination: fmt(seg[seg.length - 1]),
        // 2：常规最快，只返回一条路线；1：不使用轮渡
        strategy: '2',
        ferry: '1',
        show_fields: 'polyline',
      })
      if (seg.length > 2) qs.set('waypoints', seg.slice(1, -1).map(fmt).join(';'))
      const data = await this.request(`${this.up.restapi}/v5/direction/driving?${qs}`)
      if (data.status !== '1') {
        const known = AMAP_ERRORS[data.infocode ?? '']
        throw new PlanError(known ?? `高德返回：${data.info ?? '未知错误'}（${data.infocode ?? '无错误码'}）`)
      }
      const path = data.route?.paths?.[0]
      if (!path) throw new PlanError('高德没有规划出路线，站点可能离道路太远')
      distance += Number(path.distance ?? 0)
      for (const step of path.steps ?? []) {
        for (const pair of (step.polyline ?? '').split(';')) {
          const [lng, lat] = pair.split(',').map(Number)
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
          const last = points.at(-1)
          if (!last || last[0] !== lng || last[1] !== lat) points.push([lng, lat])
        }
      }
    }
    if (points.length < 2) throw new PlanError('高德没有返回轨迹坐标')
    return { points: simplifyTrack(points, 2), distance }
  }
}
