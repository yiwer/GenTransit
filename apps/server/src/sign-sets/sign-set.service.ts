import { Injectable } from '@nestjs/common'
import {
  ERROR_CODES,
  ROUTE_KIND_LABEL,
  SIGN_SET_DIFF_SPEC,
  changedLabels,
  compareLineName,
  countsOf,
  keyOf,
  passageIssues,
  passageLabel,
  poolOf,
  signSetSnapshotOf,
  stopLabel,
  type Page,
  type RouteInfo,
  type SaveResult,
  type ScheduleDraft,
  type SignSetDraft,
  type SignSetInput,
  type SignSetListItem,
  type SignSetListQuery,
  type SignSetSnapshotV1,
  type SignSetView,
  type StopDetail,
} from '@gentransit/shared'
import { AppError, invalid, notFound } from '../common/errors'
import { Prisma } from '../generated/prisma/client'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SnapshotService } from '../snapshots/snapshot.service'
import { SignSetStatusService } from './sign-set-status.service'

const REF = { select: { id: true, name: true } } as const

const STRUCT_INCLUDE = {
  stop: { select: { id: true, name: true, direction: true } },
  shelves: {
    orderBy: { sort: 'asc' as const },
    include: {
      type: REF,
      boards: { orderBy: { sort: 'asc' as const }, include: { slots: { orderBy: { sort: 'asc' as const } } } },
    },
  },
  schedules: { orderBy: [{ boardId: 'asc' as const }, { order: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.SignSetInclude

type StructRow = Prisma.SignSetGetPayload<{ include: typeof STRUCT_INCLUDE }>

/** 保存后内容与最后一份快照相同：回滚业务写入 */
class NoChange extends Error {}

const routeName = (r: Pick<RouteInfo, 'lineName' | 'kind'> | undefined) =>
  r ? `${r.lineName} ${ROUTE_KIND_LABEL[r.kind]}` : ''

/** 站牌尺寸参数 1200x1800 */
const parseSize = (s: string) => s.split('x').map(Number) as [number, number]
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

@Injectable()
export class SignSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
    readonly status: SignSetStatusService,
  ) {}

  /* ---------------- 读取 ---------------- */

  private toDraft(row: StructRow): SignSetDraft {
    return {
      reminder: row.reminder,
      shelves: row.shelves.map((sh) => ({
        id: sh.id,
        no: sh.no,
        typeId: sh.typeId,
        typeName: sh.type.name,
        name: sh.name,
        desc: sh.desc,
        noPhysical: sh.noPhysical,
        material: sh.material,
        boards: sh.boards.map((b) => ({
          id: b.id,
          no: b.no,
          face: b.face,
          kind: b.kind,
          width: b.width,
          height: b.height,
          remark: b.remark,
          slots: b.slots.map((s) => ({
            id: s.id,
            no: s.no,
            kind: s.kind,
            note: s.note,
            width: s.width,
            height: s.height,
          })),
        })),
      })),
      schedules: row.schedules.map((s): ScheduleDraft => ({
        id: s.id,
        routeId: s.routeId,
        pass: s.pass,
        placement: s.placement,
        boardId: s.boardId,
        slotId: s.slotId,
        order: s.order,
      })),
    }
  }

  /** 走向的显示信息：线路名、走向、是否停运、终点站（走向末站） */
  async routeInfos(db: Tx, routeIds: string[]): Promise<RouteInfo[]> {
    if (!routeIds.length) return []
    const rows = await db.route.findMany({
      where: { id: { in: [...new Set(routeIds)] } },
      select: {
        id: true,
        kind: true,
        line: { select: { id: true, name: true, status: true } },
        stops: { orderBy: { seq: 'desc' }, take: 1, select: { stop: { select: { name: true } } } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      lineId: r.line.id,
      lineName: r.line.name,
      kind: r.kind,
      suspended: r.line.status === 'suspended',
      terminal: r.stops[0]?.stop.name ?? '',
    }))
  }

  /** 编辑器与预览：站牌集内容、当前途经、计数 */
  async view(db: Tx, stopId: string): Promise<SignSetView> {
    const row = await db.signSet.findUnique({ where: { stopId }, include: STRUCT_INCLUDE })
    if (!row) throw notFound('站牌集')
    const draft = this.toDraft(row)
    const passages = await this.status.passagesAt(db, stopId)
    const routes = await this.routeInfos(db, [
      ...passages.map((p) => p.routeId),
      ...draft.schedules.map((s) => s.routeId),
    ])
    const snapshotCount = await db.snapshot.count({ where: { objectType: 'signSet', objectId: row.id } })
    return {
      ...draft,
      id: row.id,
      rev: row.rev,
      stop: row.stop,
      routes,
      passages,
      counts: countsOf(poolOf(draft, passages, routes)),
      snapshotCount,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  get(stopId: string) {
    return this.view(this.prisma, stopId)
  }

  /** 站点详情"站牌集"一节的计数 */
  async brief(db: Tx, signSetId: string | undefined): Promise<StopDetail['signSet']> {
    if (!signSetId) return { id: '', shelves: 0, boards: 0, waiting: 0, invalid: 0 }
    const [shelves, boards, counts] = await Promise.all([
      db.shelf.count({ where: { signSetId } }),
      db.board.count({ where: { signSetId } }),
      this.status.counts(db, [signSetId]),
    ])
    const c = counts.get(signSetId)!
    return { id: signSetId, shelves, boards, waiting: c.waiting, invalid: c.invalid }
  }

  /** 若干站牌集的快照内容（保存、连带修改、站点删除用）；每批 500 个 */
  async contents(db: Tx, ids: string[]): Promise<Map<string, SignSetSnapshotV1>> {
    const out = new Map<string, SignSetSnapshotV1>()
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db.signSet.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, include: STRUCT_INCLUDE })
      const routes = new Map(
        (
          await this.routeInfos(
            db,
            rows.flatMap((r) => r.schedules.map((s) => s.routeId)),
          )
        ).map((r) => [r.id, r]),
      )
      for (const r of rows)
        out.set(
          r.id,
          signSetSnapshotOf({ id: r.stop.id, name: stopLabel(r.stop) }, this.toDraft(r), (id) =>
            routeName(routes.get(id)),
          ),
        )
    }
    return out
  }

  /* ---------------- 保存 ---------------- */

  private conflict(latest: SignSetView) {
    return new AppError(409, ERROR_CODES.conflict, '这个站牌集已在别处修改，没有覆盖', { latest })
  }

  /**
   * 整个站牌集一次保存（BR-18）：按 rev 条件更新；整体替换站架、站牌、插片、编排（ID 由前端生成，保持稳定）；
   * 内容与最后一份快照相同则回滚，返回 changed=false
   */
  async save(id: string, input: SignSetInput): Promise<SaveResult<SignSetView>> {
    const ss = await this.prisma.signSet.findUnique({ where: { id }, select: { stopId: true } })
    if (!ss) throw notFound('站牌集')
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cur = await tx.signSet.findUnique({ where: { id }, select: { rev: true, stopId: true } })
        if (!cur) throw notFound('站牌集')
        if (cur.rev !== input.rev) throw this.conflict(await this.view(tx, cur.stopId))
        await this.validate(tx, id, cur.stopId, input)
        const n = await tx.signSet.updateMany({
          where: { id, rev: input.rev },
          data: { reminder: input.reminder, rev: { increment: 1 } },
        })
        if (n.count === 0) throw this.conflict(await this.view(tx, cur.stopId))
        await this.replace(tx, id, input)
        const content = (await this.contents(tx, [id])).get(id)!
        const r = await this.snapshots.record(tx, {
          type: 'signSet',
          id,
          name: content.stop.name,
          action: 'update',
          content,
          noteFrom: (prev) => `修改：${changedLabels(prev, content, SIGN_SET_DIFF_SPEC).join('、')}`,
        })
        if (!r.written) throw new NoChange()
        return { changed: true, item: await this.view(tx, cur.stopId) }
      })
    } catch (e) {
      if (e instanceof NoChange) return { changed: false, item: await this.get(ss.stopId) }
      throw e
    }
  }

  /** 服务端校验：结构（zod 已做）之外的引用与途经规则（3.4 节） */
  private async validate(tx: Tx, id: string, stopId: string, input: SignSetInput) {
    const shelfIds = input.shelves.map((s) => s.id)
    const boardIds = input.shelves.flatMap((s) => s.boards.map((b) => b.id))
    const slotIds = input.shelves.flatMap((s) => s.boards.flatMap((b) => b.slots.map((x) => x.id)))
    const foreign = await Promise.all([
      tx.shelf.count({ where: { id: { in: shelfIds }, signSetId: { not: id } } }),
      tx.board.count({ where: { id: { in: boardIds }, signSetId: { not: id } } }),
      tx.slot.count({ where: { id: { in: slotIds }, board: { signSetId: { not: id } } } }),
    ])
    if (foreign.some((n) => n > 0)) throw invalid('提交里有属于别的站牌集的站架、站牌或插片')

    const typeIds = [...new Set(input.shelves.map((s) => s.typeId))]
    const types = await tx.dictItem.count({ where: { id: { in: typeIds }, category: 'shelfType' } })
    if (types !== typeIds.length) throw invalid('站架类型不存在')

    const routeIds = [...new Set(input.schedules.map((s) => s.routeId))]
    const routes = new Map((await this.routeInfos(tx, routeIds)).map((r) => [r.id, r]))
    if (routes.size !== routeIds.length) throw invalid('线路编排引用的走向不存在，请刷新后重新编排')

    const [passages, before] = await Promise.all([
      this.status.passagesAt(tx, stopId),
      tx.schedule.findMany({ where: { signSetId: id } }),
    ])
    const issues = passageIssues(input, {
      live: new Set(passages.map(keyOf)),
      before,
      label: (routeId, pass) => passageLabel({ ...routes.get(routeId)!, pass }),
    })
    if (issues.length) throw invalid(issues[0].message, { issues })
  }

  /** 整体替换：先删编排与站架（级联到站牌、插片），再按提交内容重建；整版站牌内顺序规整为 1…n */
  private async replace(tx: Tx, id: string, input: SignSetInput) {
    await tx.schedule.deleteMany({ where: { signSetId: id } })
    await tx.shelf.deleteMany({ where: { signSetId: id } })
    const boards = input.shelves.flatMap((sh) => sh.boards.map((b, sort) => ({ ...b, shelfId: sh.id, sort })))
    if (input.shelves.length)
      await tx.shelf.createMany({
        data: input.shelves.map((sh, sort) => ({
          id: sh.id,
          signSetId: id,
          typeId: sh.typeId,
          no: sh.no,
          name: sh.name,
          desc: sh.desc,
          noPhysical: sh.noPhysical,
          material: sh.material,
          sort,
        })),
      })
    if (boards.length)
      await tx.board.createMany({
        data: boards.map((b) => ({
          id: b.id,
          shelfId: b.shelfId,
          signSetId: id,
          no: b.no,
          face: b.face,
          kind: b.kind,
          width: b.width,
          height: b.height,
          remark: b.remark,
          sort: b.sort,
        })),
      })
    const slots = boards.flatMap((b) => b.slots.map((s, sort) => ({ ...s, boardId: b.id, sort })))
    if (slots.length) await tx.slot.createMany({ data: slots })
    const orderOf = new Map<(typeof input.schedules)[number], number>()
    for (const b of boards) {
      const list = input.schedules
        .filter((s) => s.placement === 'board' && s.boardId === b.id)
        .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
      list.forEach((s, i) => orderOf.set(s, i + 1))
    }
    if (input.schedules.length)
      await tx.schedule.createMany({
        data: input.schedules.map((s) => ({
          signSetId: id,
          routeId: s.routeId,
          pass: s.pass,
          placement: s.placement,
          boardId: s.placement === 'hidden' ? null : s.boardId,
          slotId: s.placement === 'slot' ? s.slotId : null,
          order: s.placement === 'board' ? (orderOf.get(s) ?? null) : null,
        })),
      })
  }

  /* ---------------- 列表、汇总 ---------------- */

  /** 列表与导出共用的筛选：返回站牌集 ID 的子查询 */
  private filterSql(q: Omit<SignSetListQuery, 'page' | 'size' | 'sort' | 'pending'>) {
    const conds: Prisma.Sql[] = [Prisma.sql`true`]
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`
      conds.push(Prisma.sql`(st.name ILIKE ${like} OR st."nameEn" ILIKE ${like}
        OR EXISTS (SELECT 1 FROM "DictItem" d WHERE d.id = st."roadId" AND d.name ILIKE ${like}))`)
    }
    if (q.streetId) conds.push(Prisma.sql`st."streetId" = ${q.streetId}::uuid`)
    if (q.roadId) conds.push(Prisma.sql`st."roadId" = ${q.roadId}::uuid`)
    if (q.lineIds?.length)
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM "RouteStop" rs JOIN "Route" r ON r.id = rs."routeId"
        WHERE rs."stopId" = st.id AND r."lineId" = ANY(${q.lineIds}::uuid[]))`)
    if (q.shelfTypeIds?.length)
      conds.push(Prisma.sql`EXISTS (SELECT 1 FROM "Shelf" sh
        WHERE sh."signSetId" = ss.id AND sh."typeId" = ANY(${q.shelfTypeIds}::uuid[]))`)
    if (q.boardSize) {
      const [w, h] = parseSize(q.boardSize)
      conds.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "Board" b WHERE b."signSetId" = ss.id AND b.width = ${w} AND b.height = ${h})`,
      )
    }
    return {
      sql: Prisma.sql`SELECT ss.id FROM "SignSet" ss JOIN "Stop" st ON st.id = ss."stopId" WHERE ${Prisma.join(conds, ' AND ')}`,
      /** 有筛选条件：计数只对筛选范围内的站牌集计算；没有时直接算全部，省去范围判断 */
      scoped: conds.length > 1,
    }
  }

  /**
   * 筛选、"只看待处理"、排序后的站牌集 ID；一条 SQL 同时返回总数与当前页。
   * 只有"只看待处理"与按待处理数排序需要先算出筛选范围内全部站牌集的计数；
   * 其余情况不在这里计数（列表只对当前页计数，导出不需要）
   */
  async ids(q: Omit<SignSetListQuery, 'page' | 'size'>, page?: { skip: number; take: number }) {
    const counted = q.pending || q.sort === '-pending'
    const pendingOf = Prisma.sql`coalesce(c.waiting, 0) + coalesce(c.invalid, 0)`
    const order =
      q.sort === '-pending'
        ? Prisma.sql`${pendingOf} DESC, st.name, st.direction, ss.id`
        : q.sort === '-updatedAt'
          ? Prisma.sql`ss."updatedAt" DESC, ss.id`
          : Prisma.sql`st.name, st.direction, ss.id`
    const f = this.filterSql(q)
    const counts = counted
      ? Prisma.sql`, ${this.status.countsCte(f.scoped ? Prisma.sql`SELECT id FROM f` : undefined)}`
      : Prisma.empty
    const window = page ? Prisma.sql`WHERE rn > ${page.skip} AND rn <= ${page.skip + page.take}` : Prisma.empty
    const [row] = await this.prisma.$queryRaw<{ total: number; items: { id: string }[] }[]>`
      WITH f AS (${f.sql})${counts},
      r AS (
        SELECT ss.id, row_number() OVER (ORDER BY ${order}) AS rn
        FROM f
        JOIN "SignSet" ss ON ss.id = f.id
        JOIN "Stop" st ON st.id = ss."stopId"
        ${counted ? Prisma.sql`LEFT JOIN c ON c.id = f.id` : Prisma.empty}
        ${q.pending ? Prisma.sql`WHERE ${pendingOf} > 0` : Prisma.empty}
      )
      SELECT (SELECT count(*) FROM r)::int AS total,
             coalesce((SELECT json_agg(json_build_object('id', id) ORDER BY rn) FROM r ${window}), '[]'::json) AS items`
    return row
  }

  async list(q: SignSetListQuery): Promise<Page<SignSetListItem>> {
    const { total, items } = await this.ids(q, { skip: (q.page - 1) * q.size, take: q.size })
    const counts = await this.status.counts(
      this.prisma,
      items.map((x) => x.id),
    )
    const rows = await this.prisma.signSet.findMany({
      where: { id: { in: items.map((x) => x.id) } },
      select: {
        id: true,
        updatedAt: true,
        stop: {
          select: {
            id: true,
            name: true,
            direction: true,
            city: REF,
            district: REF,
            street: REF,
            road: REF,
            routeStops: { select: { route: { select: { line: { select: { id: true, name: true, status: true } } } } } },
          },
        },
        shelves: {
          orderBy: { sort: 'asc' },
          select: { type: { select: { name: true } }, boards: { select: { width: true, height: true } } },
        },
      },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    return {
      items: items.map(({ id }) => {
        const r = byId.get(id)!
        const { waiting, invalid } = counts.get(id)!
        const lines = new Map<string, SignSetListItem['lines'][number]>()
        for (const { route } of r.stop.routeStops)
          lines.set(route.line.id, {
            id: route.line.id,
            name: route.line.name,
            suspended: route.line.status === 'suspended',
          })
        const types = new Map<string, number>()
        for (const sh of r.shelves) types.set(sh.type.name, (types.get(sh.type.name) ?? 0) + 1)
        const boards = r.shelves.flatMap((sh) => sh.boards)
        return {
          id,
          stop: { id: r.stop.id, name: r.stop.name, direction: r.stop.direction },
          lines: [...lines.values()].sort((a, b) => compareLineName(a.name, b.name)),
          city: r.stop.city,
          district: r.stop.district,
          street: r.stop.street,
          road: r.stop.road,
          shelves: r.shelves.length,
          shelfTypes: [...types].map(([name, count]) => ({ name, count })),
          boards: boards.length,
          boardSizes: [...new Set(boards.map((b) => `${b.width}×${b.height}`))],
          waiting,
          invalid,
          updatedAt: r.updatedAt.toISOString(),
        }
      }),
      total,
      page: q.page,
      size: q.size,
    }
  }

  /** 已有的站牌尺寸（筛选下拉） */
  async boardSizes(): Promise<{ width: number; height: number; count: number }[]> {
    const rows = await this.prisma.board.groupBy({
      by: ['width', 'height'],
      _count: { _all: true },
      orderBy: [{ width: 'asc' }, { height: 'asc' }],
    })
    return rows.map((r) => ({ width: r.width, height: r.height, count: r._count._all }))
  }

  async summary() {
    const [row, signSets] = await Promise.all([this.status.summary(this.prisma), this.prisma.signSet.count()])
    return { ...row, signSets }
  }

  /* ---------------- 导出 ---------------- */

  /** 导出用：按给定顺序分批读出结构、编排与当前途经 */
  async *exportBatches(all: string[]) {
    for (let i = 0; i < all.length; i += 500) {
      const ids = all.slice(i, i + 500)
      const rows = await this.prisma.signSet.findMany({ where: { id: { in: ids } }, include: STRUCT_INCLUDE })
      const byId = new Map(rows.map((r) => [r.id, r]))
      const live = await this.status.liveKeys(this.prisma, ids)
      const routes = new Map(
        (
          await this.routeInfos(
            this.prisma,
            rows.flatMap((r) => r.schedules.map((s) => s.routeId)),
          )
        ).map((r) => [r.id, r]),
      )
      yield ids.map((id) => {
        const r = byId.get(id)!
        return { stop: r.stop, draft: this.toDraft(r), live: live.get(id) ?? new Set<string>(), routes }
      })
    }
  }
}
