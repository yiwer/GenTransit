import { Injectable } from '@nestjs/common'
import type { Passage, SignSetCounts } from '@gentransit/shared'
import { Prisma } from '../generated/prisma/client'
import { PrismaService, type Tx } from '../prisma/prisma.service'

export type CountRow = SignSetCounts & { id: string }

/** 全部站牌集的计数：站牌集 ID → 计数；没有途经也没有编排的站牌集不在里面（全为 0） */
export type CountSnapshot = ReadonlyMap<string, SignSetCounts>

export const ZERO_COUNTS: SignSetCounts = { waiting: 0, placed: 0, hidden: 0, invalid: 0 }

/**
 * 编排状态的计算（M3 计划 3.2 节，BR-08）。都是原生 SQL：
 * 途经 = 运营中线路的路径站按（走向，站点）分组、按序号编号；编排按（站牌集，走向，途经）去重；
 * 两者全外连接得出待编排、失效、已编排、隐藏数。
 * 全部站牌集的计数（工作台汇总、数据体检、逐站编排队列、站牌集列表的"只看待处理"与按待处理排序）
 * 按数据版本缓存一份快照（M6 计划 3.5 节）；编辑器、线路影响分析按需实时计算少数几个站牌集，不读快照
 */
@Injectable()
export class SignSetStatusService {
  private snapshot: { version: string; counts: Promise<CountSnapshot> } | null = null

  constructor(private readonly prisma: PrismaService) {}

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
  private countsCte(scope?: Prisma.Sql): Prisma.Sql {
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
    const out = new Map<string, SignSetCounts>(ids.map((id) => [id, { ...ZERO_COUNTS }]))
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

  /**
   * 数据版本：影响计数的表的行数与最后修改时间。编排（Schedule）没有 updatedAt，但编辑器保存与删除走向
   * 都会改站牌集的 rev（updatedAt 随之变），新增与删除由行数反映。每张表扫一遍，设计规模下约 20 ms
   */
  private async version(): Promise<string> {
    const part = (table: string) =>
      Prisma.raw(`(SELECT count(*) || ',' || coalesce(max("updatedAt")::text, '') FROM "${table}")`)
    const [row] = await this.prisma.$queryRaw<{ version: string }[]>`
      SELECT concat_ws('|', ${Prisma.join(
        ['Line', 'Route', 'RouteStop', 'SignSet', 'Shelf', 'Board', 'Slot', 'Stop'].map(part),
      )}, (SELECT count(*)::text FROM "Schedule")) AS version`
    return row.version
  }

  /** 全部站牌集的计数快照：数据版本变了才重算；同一版本的并发请求共用同一次计算 */
  async all(): Promise<CountSnapshot> {
    const version = await this.version()
    if (this.snapshot?.version === version) return this.snapshot.counts
    const entry = { version, counts: this.computeAll() }
    this.snapshot = entry
    // 算失败了不留在缓存里，下次请求重算
    entry.counts.catch(() => {
      if (this.snapshot === entry) this.snapshot = null
    })
    return entry.counts
  }

  private async computeAll(): Promise<CountSnapshot> {
    const rows = await this.prisma.$queryRaw<CountRow[]>`
      WITH ${this.countsCte()}
      SELECT id::text AS id, waiting, invalid, placed, hidden FROM c`
    return new Map(
      rows.map((r) => [r.id, { waiting: r.waiting, invalid: r.invalid, placed: r.placed, hidden: r.hidden }]),
    )
  }

  /** 工作台汇总：待处理站牌集数（有待编排或失效）、待编排总数、失效总数 */
  async summary() {
    let pendingSets = 0
    let waiting = 0
    let invalid = 0
    for (const c of (await this.all()).values()) {
      if (c.waiting + c.invalid > 0) pendingSets++
      waiting += c.waiting
      invalid += c.invalid
    }
    return { pendingSets, waiting, invalid }
  }
}
