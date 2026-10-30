// 数据体检（需求 5.2，M5 计划 3.6）：站点检查项用 SQL 计数（与站点列表的 check 筛选同一组条件）；
// 线路检查项要算对向站与方位，按"线路、走向、站点的最后修改时间 + 数量"作版本缓存，版本变了才重算
import { Injectable } from '@nestjs/common'
import {
  LINE_CHECKS,
  STOP_CHECKS,
  dedupeAdjacent,
  gapWarnings,
  trackKeyOf,
  wrongSide,
  type DataChecks,
  type LineCheck,
  type LngLatPair,
} from '@gentransit/shared'
import { oppositesOf } from '../common/opposites'
import { PrismaService } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { SignSetStatusService } from '../sign-sets/sign-set-status.service'
import { stopCheckWhere } from '../stops/stop-checks'

interface RouteRow {
  routeId: string
  lineId: string
  trackKey: string | null
  tracked: boolean
  stopId: string
  lng: number
  lat: number
}

@Injectable()
export class DataCheckService {
  private cache: { version: string; sets: Record<LineCheck, Set<string>> } | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly status: SignSetStatusService,
  ) {}

  async counts(): Promise<DataChecks> {
    const [stops, sets, summary] = await Promise.all([
      Promise.all(STOP_CHECKS.map((c) => this.prisma.stop.count({ where: stopCheckWhere(c) }))),
      this.lineSets(),
      this.status.summary(),
    ])
    return {
      stops: Object.fromEntries(STOP_CHECKS.map((c, i) => [c, stops[i]])) as DataChecks['stops'],
      lines: Object.fromEntries(LINE_CHECKS.map((c) => [c, sets[c].size])) as DataChecks['lines'],
      pendingSets: summary.pendingSets,
    }
  }

  /** 线路列表的 check 筛选 */
  async lineIds(check: LineCheck): Promise<Set<string>> {
    return (await this.lineSets())[check]
  }

  private async lineSets(): Promise<Record<LineCheck, Set<string>>> {
    const { orientationMode } = await this.settings.get(this.prisma)
    const [v] = await this.prisma.$queryRaw<{ version: string }[]>`
      SELECT concat_ws('|',
        (SELECT max("updatedAt") FROM "Line"), (SELECT count(*) FROM "Line"),
        (SELECT max("updatedAt") FROM "Route"), (SELECT count(*) FROM "Route"),
        (SELECT max("updatedAt") FROM "Stop"), (SELECT count(*) FROM "Stop")) AS version`
    const version = `${orientationMode}|${v.version}`
    if (this.cache?.version === version) return this.cache.sets

    const [rows, opposites] = await Promise.all([
      this.prisma.$queryRaw<RouteRow[]>`
        SELECT r.id::text AS "routeId", r."lineId"::text AS "lineId", r."trackKey", r."trackAt" IS NOT NULL AS tracked,
               rs."stopId"::text AS "stopId", s.lng, s.lat
        FROM "Route" r
        JOIN "RouteStop" rs ON rs."routeId" = r.id
        JOIN "Stop" s ON s.id = rs."stopId"
        ORDER BY r.id, rs.seq`,
      oppositesOf(this.prisma, orientationMode),
    ])
    const sets = Object.fromEntries(LINE_CHECKS.map((c) => [c, new Set<string>()])) as Record<LineCheck, Set<string>>
    for (let i = 0; i < rows.length;) {
      let j = i
      while (j < rows.length && rows[j].routeId === rows[i].routeId) j++
      const route = rows.slice(i, j)
      const { lineId, tracked, trackKey } = route[0]
      if (!tracked) sets.noTrack.add(lineId)
      else if (trackKey !== trackKeyOf(dedupeAdjacent(route.map((s) => [s.lng, s.lat] as LngLatPair))))
        sets.trackStale.add(lineId)
      if (gapWarnings(route).length) sets.gap.add(lineId)
      if (
        route.some((s, k) => {
          const o = opposites.get(s.stopId)
          return o && wrongSide(route[k - 1] ?? null, s, route[k + 1] ?? null, o)
        })
      )
        sets.wrongSide.add(lineId)
      i = j
    }
    this.cache = { version, sets }
    return sets
  }
}
