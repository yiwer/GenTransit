import { Injectable } from '@nestjs/common'
import type { Passage, SignSetCounts } from '@gentransit/shared'
import { Prisma } from '../generated/prisma/client'
import type { Tx } from '../prisma/prisma.service'

export type CountRow = SignSetCounts & { id: string }

/**
 * 编排状态的实时计算（M3 计划 3.2 节，BR-08，不建缓存）。都是原生 SQL：
 * 途经 = 运营中线路的路径站按（走向，站点）分组、按序号编号；编排按（站牌集，走向，途经）去重；
 * 两者全外连接得出待编排、失效、已编排、隐藏数
 */
@Injectable()
export class SignSetStatusService {
  /** 某站点当前的途经：运营中线路，按（走向，第几次途经） */
  async passagesAt(db: Tx, stopId: string): Promise<Passage[]> {
    return db.$queryRaw<Passage[]>`
      SELECT x."routeId"::text AS "routeId", x.pass::int AS pass, x.cnt::int AS count
      FROM (
        SELECT rs."routeId",
               row_number() OVER (PARTITION BY rs."routeId" ORDER BY rs.seq) AS pass,
               count(*) OVER (PARTITION BY rs."routeId") AS cnt
        FROM "RouteStop" rs
        WHERE rs."stopId" = ${stopId}::uuid
      ) x
      JOIN "Route" r ON r.id = x."routeId"
      JOIN "Line" l ON l.id = r."lineId"
      WHERE l.status = 'running'
      ORDER BY x."routeId", x.pass`
  }

  /**
   * 计数的 CTE：scope 限定参与计算的站牌集（子查询，返回列 id）；不传则全部站牌集。
   * 路径站先按站点限定再开窗口：分区是（走向，站点），限定站点不影响途经编号
   */
  countsCte(scope?: Prisma.Sql): Prisma.Sql {
    const inScope = (col: Prisma.Sql) => (scope ? Prisma.sql`AND ${col} IN (${scope})` : Prisma.empty)
    return Prisma.sql`
      p AS (
        SELECT ss.id AS "signSetId", rs."routeId",
               row_number() OVER (PARTITION BY rs."routeId", rs."stopId" ORDER BY rs.seq) AS pass
        FROM "RouteStop" rs
        JOIN "SignSet" ss ON ss."stopId" = rs."stopId"
        JOIN "Route" r ON r.id = rs."routeId"
        JOIN "Line" l ON l.id = r."lineId"
        WHERE l.status = 'running' ${inScope(Prisma.sql`ss.id`)}
      ),
      s AS (
        SELECT "signSetId", "routeId", pass, bool_or(placement = 'hidden') AS hidden
        FROM "Schedule"
        WHERE true ${inScope(Prisma.sql`"signSetId"`)}
        GROUP BY 1, 2, 3
      ),
      c AS (
        SELECT coalesce(p."signSetId", s."signSetId") AS id,
               (count(*) FILTER (WHERE s."routeId" IS NULL))::int AS waiting,
               (count(*) FILTER (WHERE p."routeId" IS NULL))::int AS invalid,
               (count(*) FILTER (WHERE p."routeId" IS NOT NULL AND s."routeId" IS NOT NULL AND NOT s.hidden))::int AS placed,
               (count(*) FILTER (WHERE p."routeId" IS NOT NULL AND s.hidden))::int AS hidden
        FROM p
        FULL OUTER JOIN s ON s."signSetId" = p."signSetId" AND s."routeId" = p."routeId" AND s.pass = p.pass
        GROUP BY 1
      )`
  }

  /** 若干站牌集的计数；没有途经也没有编排的站牌集全为 0 */
  async counts(db: Tx, ids: string[]): Promise<Map<string, SignSetCounts>> {
    const out = new Map<string, SignSetCounts>(ids.map((id) => [id, { waiting: 0, placed: 0, hidden: 0, invalid: 0 }]))
    if (!ids.length) return out
    const rows = await db.$queryRaw<CountRow[]>`
      WITH ${this.countsCte(Prisma.sql`SELECT unnest(${ids}::uuid[])`)}
      SELECT id::text AS id, waiting, invalid, placed, hidden FROM c`
    for (const r of rows) out.set(r.id, { waiting: r.waiting, invalid: r.invalid, placed: r.placed, hidden: r.hidden })
    return out
  }

  /** 若干站牌集当前途经的键（走向 ID#第几次途经），导出时判断编排状态 */
  async liveKeys(db: Tx, ids: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>()
    if (!ids.length) return out
    const rows = await db.$queryRaw<{ signSetId: string; key: string }[]>`
      WITH ${this.countsCte(Prisma.sql`SELECT unnest(${ids}::uuid[])`)}
      SELECT "signSetId"::text AS "signSetId", "routeId"::text || '#' || pass AS key FROM p`
    for (const r of rows) out.set(r.signSetId, (out.get(r.signSetId) ?? new Set()).add(r.key))
    return out
  }

  /** 若干站牌集当前的途经（只读 API 批量组装用）；count 为该走向经过本站的总次数 */
  async livePassages(db: Tx, ids: string[]): Promise<Map<string, Passage[]>> {
    const out = new Map<string, Passage[]>()
    if (!ids.length) return out
    const rows = await db.$queryRaw<{ signSetId: string; routeId: string; pass: number; count: number }[]>`
      WITH ${this.countsCte(Prisma.sql`SELECT unnest(${ids}::uuid[])`)}
      SELECT "signSetId"::text AS "signSetId", "routeId"::text AS "routeId", pass::int AS pass,
             (count(*) OVER (PARTITION BY "signSetId", "routeId"))::int AS count
      FROM p
      ORDER BY 1, 2, 3`
    for (const r of rows)
      out.set(r.signSetId, [...(out.get(r.signSetId) ?? []), { routeId: r.routeId, pass: r.pass, count: r.count }])
    return out
  }

  /** 工作台汇总：待处理站牌集数（有待编排或失效）、待编排总数、失效总数 */
  async summary(db: Tx) {
    const [row] = await db.$queryRaw<{ pendingSets: number; waiting: number; invalid: number }[]>`
      WITH ${this.countsCte()}
      SELECT (count(*) FILTER (WHERE waiting + invalid > 0))::int AS "pendingSets",
             coalesce(sum(waiting), 0)::int AS waiting,
             coalesce(sum(invalid), 0)::int AS invalid
      FROM c`
    return row
  }
}
