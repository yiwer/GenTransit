import { Inject, Injectable } from '@nestjs/common'
import {
  ERROR_CODES,
  LINE_DIFF_SPEC,
  MODE_ROUTE_KINDS,
  ROUTE_KIND_LABEL,
  changedLabels,
  compareLineName,
  lineSnapshot,
  mapRoutesOnModeChange,
  passIndices,
  stopLabel,
  type ArrangeStatus,
  type GroupLineResult,
  type LineArrangement,
  type LineDeleteCheck,
  type LineDetail,
  type LineImpact,
  type LineInput,
  type LineListItem,
  type LineListQuery,
  type LineNameCheck,
  type LineOptions,
  type LineOptionsQuery,
  type LineUpdateInput,
  type Page,
  type Ref,
  type RouteDetail,
  type RouteKind,
  type SaveResult,
  type StopJoinInput,
  type StopReference,
  type StopReplaceInput,
  type TransferStop,
} from '@gentransit/shared'
import { AppError, duplicate, invalid, notFound } from '../common/errors'
import { validateExt, type ExtDef } from '../common/ext'
import { DataCheckService } from '../data-checks/data-check.service'
import { Prisma } from '../generated/prisma/client'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SnapshotService } from '../snapshots/snapshot.service'
import { ROUTE_REMOVAL_HOOK, type RouteRemovalHook } from './route-removal.hook'
import { trackOf } from './route-track.service'

const REF = { select: { id: true, name: true } } as const
const STOP_SELECT = { id: true, name: true, direction: true, lng: true, lat: true } as const

const DETAIL_INCLUDE = {
  company: REF,
  fareSystem: REF,
  routes: { include: { stops: { orderBy: { seq: 'asc' as const }, include: { stop: { select: STOP_SELECT } } } } },
} satisfies Prisma.LineInclude

const LIST_INCLUDE = {
  company: REF,
  fareSystem: REF,
  routes: {
    // 列表不带轨迹（Q79）：地图只按站点连线
    select: {
      id: true,
      kind: true,
      stops: { orderBy: { seq: 'asc' as const }, select: { stop: { select: { name: true, lng: true, lat: true } } } },
    },
  },
} satisfies Prisma.LineInclude

type DetailRow = Prisma.LineGetPayload<{ include: typeof DETAIL_INCLUDE }>
type ListRow = Prisma.LineGetPayload<{ include: typeof LIST_INCLUDE }>

const ref = (r: Ref | null): Ref | null => (r ? { id: r.id, name: r.name } : null)
const kindOrder = (kind: RouteKind) => Object.values(MODE_ROUTE_KINDS).flat().indexOf(kind)

/** 保存后内容与最后一份快照相同：回滚业务写入 */
class NoChange extends Error {}

export interface LineExtDefs {
  line: ExtDef[]
  routeStop: ExtDef[]
}

@Injectable()
export class LineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
    @Inject(ROUTE_REMOVAL_HOOK) private readonly hook: RouteRemovalHook,
    private readonly checks: DataCheckService,
  ) {}

  /* ---------------- 读取 ---------------- */

  get(id: string) {
    return this.detail(this.prisma, id)
  }

  async detail(db: Tx, id: string): Promise<LineDetail> {
    const l = await db.line.findUnique({ where: { id }, include: DETAIL_INCLUDE })
    if (!l) throw notFound('线路')
    const snapshotCount = await db.snapshot.count({ where: { objectType: 'line', objectId: id } })
    return this.toDetail(l, snapshotCount)
  }

  /** 批量读取详情（导出、导入分析用，不计快照数）；每批 500 条，避免逐条查询 */
  async details(db: Tx, ids: string[]): Promise<LineDetail[]> {
    const out: LineDetail[] = []
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db.line.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, include: DETAIL_INCLUDE })
      out.push(...rows.map((l) => this.toDetail(l, 0)))
    }
    return out
  }

  private toDetail(l: DetailRow, snapshotCount: number): LineDetail {
    const routes: RouteDetail[] = [...l.routes]
      .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
      .map((r) => {
        const pass = passIndices(r.stops.map((s) => s.stopId))
        return {
          id: r.id,
          kind: r.kind,
          serviceType: r.serviceType,
          serviceTime: r.serviceTime,
          interval: r.interval,
          stops: r.stops.map((s, i) => ({
            stop: s.stop,
            seq: s.seq,
            pass: pass[i],
            times: s.times,
            ext: (s.ext ?? {}) as Record<string, unknown>,
          })),
          track: trackOf(
            r,
            r.stops.map((s) => [s.stop.lng, s.stop.lat]),
          ),
        }
      })
    return {
      id: l.id,
      rev: l.rev,
      name: l.name,
      number: l.number,
      nameEn: l.nameEn,
      mode: l.mode,
      status: l.status,
      ticketType: l.ticketType,
      fare: l.fare,
      company: ref(l.company),
      fareSystem: ref(l.fareSystem),
      ext: (l.ext ?? {}) as Record<string, unknown>,
      routes,
      snapshotCount,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    }
  }

  private toListItem(l: ListRow): LineListItem {
    return {
      id: l.id,
      name: l.name,
      number: l.number,
      nameEn: l.nameEn,
      mode: l.mode,
      status: l.status,
      company: ref(l.company),
      ticketType: l.ticketType,
      fareSystem: ref(l.fareSystem),
      fare: l.fare,
      routes: [...l.routes]
        .sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          count: r.stops.length,
          origin: r.stops[0]?.stop.name ?? '',
          terminal: r.stops.at(-1)?.stop.name ?? '',
          path: r.stops.map((s) => [s.stop.lng, s.stop.lat] as [number, number]),
        })),
      ext: (l.ext ?? {}) as Record<string, unknown>,
      updatedAt: l.updatedAt.toISOString(),
    }
  }

  /**
   * 列表：默认按自动排序规则（需求 5.5.6）。数据库排序规则表达不了这条规则，
   * 先取出筛选后的 ID 与线路名在内存里排序，再取当前页的完整数据（默认决定 4）
   */
  async list(q: LineListQuery): Promise<Page<LineListItem>> {
    const where: Prisma.LineWhereInput = {
      id: q.check ? { in: [...(await this.checks.lineIds(q.check))] } : undefined,
      mode: q.mode,
      companyId: q.companyId,
      status: q.status,
      routes: q.stopId ? { some: { stops: { some: { stopId: q.stopId } } } } : undefined,
      OR: q.q
        ? [
            { name: { contains: q.q, mode: 'insensitive' } },
            { number: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
          ]
        : undefined,
    }
    const skip = (q.page - 1) * q.size
    if (q.sort === 'auto') {
      const all = await this.prisma.line.findMany({ where, select: { id: true, name: true } })
      all.sort((a, b) => compareLineName(a.name, b.name) || (a.id < b.id ? -1 : 1))
      const ids = all.slice(skip, skip + q.size).map((x) => x.id)
      const rows = await this.prisma.line.findMany({ where: { id: { in: ids } }, include: LIST_INCLUDE })
      const byId = new Map(rows.map((r) => [r.id, r]))
      return { items: ids.map((id) => this.toListItem(byId.get(id)!)), total: all.length, page: q.page, size: q.size }
    }
    const orderBy: Prisma.LineOrderByWithRelationInput[] =
      q.sort === 'name'
        ? [{ name: 'asc' }, { id: 'asc' }]
        : [{ updatedAt: q.sort === 'updatedAt' ? 'asc' : 'desc' }, { id: 'asc' }]
    const [total, rows] = await Promise.all([
      this.prisma.line.count({ where }),
      this.prisma.line.findMany({ where, orderBy, skip, take: q.size, include: LIST_INCLUDE }),
    ])
    return { items: rows.map((r) => this.toListItem(r)), total, page: q.page, size: q.size }
  }

  /** 线路选择器的轻量选项（M6 计划 3.4）：按自动排序，只带名称与状态；给了 ids 就只取这些线路 */
  async options(q: LineOptionsQuery): Promise<LineOptions> {
    const where: Prisma.LineWhereInput = q.ids
      ? { id: { in: q.ids } }
      : {
          OR: q.q
            ? [{ name: { contains: q.q, mode: 'insensitive' } }, { number: { contains: q.q, mode: 'insensitive' } }]
            : undefined,
        }
    const all = await this.prisma.line.findMany({ where, select: { id: true, name: true, status: true } })
    all.sort((a, b) => compareLineName(a.name, b.name) || (a.id < b.id ? -1 : 1))
    return { items: q.ids ? all : all.slice(0, q.size), total: all.length }
  }

  /** 线路详情条形图：该走向每一站可换乘的其他线路 */
  async transfers(id: string, routeId: string): Promise<TransferStop[]> {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, lineId: id },
      select: { stops: { select: { stopId: true } } },
    })
    if (!route) throw notFound('走向')
    const stopIds = [...new Set(route.stops.map((s) => s.stopId))]
    const rows = await this.prisma.routeStop.findMany({
      where: { stopId: { in: stopIds }, route: { lineId: { not: id } } },
      select: { stopId: true, route: { select: { line: { select: { id: true, name: true, status: true } } } } },
    })
    const byStop = new Map<string, Map<string, TransferStop['lines'][number]>>()
    for (const r of rows) {
      const m = byStop.get(r.stopId) ?? new Map()
      m.set(r.route.line.id, {
        id: r.route.line.id,
        name: r.route.line.name,
        suspended: r.route.line.status === 'suspended',
      })
      byStop.set(r.stopId, m)
    }
    return stopIds.map((stopId) => ({
      stopId,
      lines: [...(byStop.get(stopId)?.values() ?? [])].sort((a, b) => compareLineName(a.name, b.name)),
    }))
  }

  async checkName(name: string, excludeId?: string): Promise<LineNameCheck> {
    const l = await this.prisma.line.findFirst({
      where: { name: name.trim(), NOT: excludeId ? { id: excludeId } : undefined },
      select: { id: true, name: true, number: true },
    })
    return { exists: Boolean(l), line: l }
  }

  async checkNumber(number: string, excludeId?: string): Promise<LineNameCheck> {
    const l = await this.prisma.line.findFirst({
      where: { number: number.trim(), NOT: excludeId ? { id: excludeId } : undefined },
      select: { id: true, name: true, number: true },
    })
    return { exists: Boolean(l), line: l }
  }

  /* ---------------- 校验与快照 ---------------- */

  async extDefs(db: Tx): Promise<LineExtDefs> {
    const defs = await db.extField.findMany({ where: { owner: { in: ['line', 'routeStop'] } } })
    return { line: defs.filter((d) => d.owner === 'line'), routeStop: defs.filter((d) => d.owner === 'routeStop') }
  }

  /** 快照内容：扩展字段带上当时的字段名与类型（含已停用字段） */
  content(detail: LineDetail, defs: LineExtDefs) {
    return lineSnapshot(
      {
        ...detail,
        routes: detail.routes.map((r) => ({
          kind: r.kind,
          serviceType: r.serviceType,
          serviceTime: r.serviceTime,
          interval: r.interval,
          stops: r.stops.map((s) => ({ stop: s.stop, times: s.times, ext: s.ext })),
        })),
      },
      defs.line,
      defs.routeStop,
    )
  }

  /**
   * 校验引用与扩展字段。existingStopExt：旧路径站按"走向|站点#第几次途经"的扩展字段取值，
   * 路径站整体重建时用来保留已停用字段的值
   */
  async validate(
    db: Tx,
    input: LineInput,
    existingExt: Record<string, unknown>,
    existingStopExt: Map<string, Record<string, unknown>>,
    exceptId?: string,
  ) {
    const dupName = await db.line.findFirst({
      where: { name: input.name, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dupName) throw duplicate(`线路名「${input.name}」已存在`, { line: { id: dupName.id } })
    const dupNumber = await db.line.findFirst({
      where: { number: input.number, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dupNumber)
      throw duplicate(`管理编号「${input.number}」已被「${dupNumber.name}」使用`, { line: { id: dupNumber.id } })
    if (input.companyId && !(await db.busCompany.findUnique({ where: { id: input.companyId } })))
      throw invalid('公交公司不存在')
    if (input.fareSystemId) {
      const d = await db.dictItem.findUnique({ where: { id: input.fareSystemId } })
      if (d?.category !== 'fareSystem') throw invalid('票制不存在')
    }
    const stopIds = [...new Set(input.routes.flatMap((r) => r.stops.map((s) => s.stopId)))]
    if ((await db.stop.count({ where: { id: { in: stopIds } } })) !== stopIds.length)
      throw invalid('站序里有站点不存在')
    const defs = await this.extDefs(db)
    const ext = validateExt(defs.line, input.ext, existingExt)
    const routes = input.routes.map((r, i) => {
      const pass = passIndices(r.stops.map((s) => s.stopId))
      return {
        ...r,
        stops: r.stops.map((s, j) =>
          validateExt(
            defs.routeStop,
            s.ext,
            existingStopExt.get(`${r.kind}|${s.stopId}#${pass[j]}`) ?? {},
            `routes.${i}.stops.${j}.ext`,
            `${ROUTE_KIND_LABEL[r.kind]}第 ${j + 1} 站：`,
          ),
        ),
      }
    })
    return { ext, routeStopExt: routes.map((r) => r.stops), defs }
  }

  private lineData(input: LineInput, ext: Record<string, unknown>) {
    return {
      name: input.name,
      number: input.number,
      nameEn: input.nameEn,
      mode: input.mode,
      companyId: input.companyId,
      ticketType: input.ticketType,
      fareSystemId: input.fareSystemId,
      fare: input.fare,
      ext: ext as Prisma.InputJsonValue,
    }
  }

  /** 写一个走向的路径站：整体替换（ID 不对外承诺） */
  private async writeStops(
    tx: Tx,
    routeId: string,
    stops: LineInput['routes'][number]['stops'],
    ext: Record<string, unknown>[],
  ) {
    await tx.routeStop.deleteMany({ where: { routeId } })
    await tx.routeStop.createMany({
      data: stops.map((s, i) => ({
        routeId,
        stopId: s.stopId,
        seq: i + 1,
        times: s.times,
        ext: ext[i] as Prisma.InputJsonValue,
      })),
    })
  }

  private routeData(r: LineInput['routes'][number]) {
    return { serviceType: r.serviceType, serviceTime: r.serviceTime, interval: r.interval }
  }

  /* ---------------- 写入 ---------------- */

  async create(input: LineInput): Promise<SaveResult<LineDetail>> {
    return this.prisma.$transaction(async (tx) => {
      const { ext, routeStopExt, defs } = await this.validate(tx, input, {}, new Map())
      const line = await tx.line.create({ data: this.lineData(input, ext) })
      for (const [i, r] of input.routes.entries()) {
        const route = await tx.route.create({ data: { lineId: line.id, kind: r.kind, ...this.routeData(r) } })
        await this.writeStops(tx, route.id, r.stops, routeStopExt[i])
      }
      const detail = await this.detail(tx, line.id)
      await this.snapshots.record(tx, {
        type: 'line',
        id: line.id,
        name: detail.name,
        action: 'create',
        content: this.content(detail, defs),
      })
      return { changed: true, item: { ...detail, snapshotCount: 1 } }
    })
  }

  /**
   * 整个聚合一次保存：按 rev 条件更新；改模式时走向按位置原地改名，多余的走向删除并调用 M3 接口；
   * 路径站整体重建；内容与最后一份快照相同则回滚，返回 changed=false
   */
  async update(id: string, input: LineUpdateInput): Promise<SaveResult<LineDetail>> {
    try {
      return await this.prisma.$transaction((tx) => this.updateIn(tx, id, input))
    } catch (e) {
      if (e instanceof NoChange) return { changed: false, item: await this.get(id) }
      throw e
    }
  }

  /** 在给定事务里保存一条线路（成组修改共用）；note 不为空时代替快照说明"修改：字段名"；内容没变抛 NoChange */
  async updateIn(tx: Tx, id: string, input: LineUpdateInput, note?: string): Promise<SaveResult<LineDetail>> {
    const cur = await tx.line.findUnique({ where: { id }, include: DETAIL_INCLUDE })
    if (!cur) throw notFound('线路')
    if (cur.rev !== input.rev) throw this.conflict(await this.detail(tx, id))
    const before = this.toDetail(cur, 0)
    const existingStopExt = this.stopExtIndex(before, input.mode)
    const { ext, routeStopExt, defs } = await this.validate(tx, input, before.ext, existingStopExt, id)
    const n = await tx.line.updateMany({
      where: { id, rev: input.rev },
      data: { ...this.lineData(input, ext), rev: { increment: 1 } },
    })
    if (n.count === 0) throw this.conflict(await this.detail(tx, id))
    await this.applyRoutes(tx, before, input, routeStopExt)
    const detail = await this.detail(tx, id)
    const content = this.content(detail, defs)
    const r = await this.snapshots.record(tx, {
      type: 'line',
      id,
      name: detail.name,
      action: 'update',
      content,
      note,
      noteFrom: note ? undefined : (prev) => `修改：${changedLabels(prev, content, LINE_DIFF_SPEC).join('、')}`,
    })
    if (!r.written) throw new NoChange()
    return { changed: true, item: { ...detail, snapshotCount: detail.snapshotCount + 1 } }
  }

  /** 旧路径站的扩展字段：键按改模式后的走向名，便于保留停用字段的值 */
  stopExtIndex(before: LineDetail, newMode: LineInput['mode']) {
    const map = new Map<string, Record<string, unknown>>()
    const mapping = mapRoutesOnModeChange(
      before.routes.map((r) => r.kind),
      before.mode,
      newMode,
    )
    for (const r of before.routes) {
      const to = mapping.find((m) => m.from === r.kind)?.to
      if (!to) continue
      for (const s of r.stops) map.set(`${to}|${s.stop.id}#${s.pass}`, s.ext)
    }
    return map
  }

  /**
   * 写走向：改模式时按位置对应（第 i 个旧走向原地改名为第 i 个新走向），多余的删除，缺少的新建。
   * onlyKinds：只写这些走向（导入时文件里没出现的走向不变）
   */
  async applyRoutes(
    tx: Tx,
    before: LineDetail,
    input: Pick<LineInput, 'mode' | 'name' | 'routes'>,
    routeStopExt: Record<string, unknown>[][],
    onlyKinds?: RouteKind[],
  ) {
    const mapping = mapRoutesOnModeChange(
      before.routes.map((r) => r.kind),
      before.mode,
      input.mode,
    )
    const removed = mapping.filter((m) => m.from && !m.to).map((m) => before.routes.find((r) => r.kind === m.from)!)
    if (removed.length) {
      const routeIds = removed.map((r) => r.id)
      await this.hook.onRoutesRemoved(tx, {
        routeIds,
        note: `修改线路 ${input.name} 的模式，删除走向 ${removed.map((r) => ROUTE_KIND_LABEL[r.kind]).join('、')}，连带移除编排`,
      })
      await tx.route.deleteMany({ where: { id: { in: routeIds } } })
    }
    for (const m of mapping) {
      if (!m.to) continue
      const i = input.routes.findIndex((r) => r.kind === m.to)
      const r = input.routes[i]
      const old = m.from ? before.routes.find((x) => x.kind === m.from) : undefined
      if (old) {
        // 改名在前：模式之间的走向名互不重叠，不会撞上（线路，走向）唯一约束
        if (old.kind !== m.to) await tx.route.update({ where: { id: old.id }, data: { kind: m.to } })
        if (!r || (onlyKinds && !onlyKinds.includes(m.to))) continue
        await tx.route.update({ where: { id: old.id }, data: this.routeData(r) })
        await this.writeStops(tx, old.id, r.stops, routeStopExt[i])
      } else if (r) {
        const route = await tx.route.create({ data: { lineId: before.id, kind: m.to, ...this.routeData(r) } })
        await this.writeStops(tx, route.id, r.stops, routeStopExt[i])
      }
    }
    return removed
  }

  /* ---------------- 成组修改：站点加入线路、替换站点（M5 计划 3.2，BR-22） ---------------- */

  /** 当前详情还原成保存用的输入（不改的部分原样带回） */
  private inputOf(d: LineDetail): LineUpdateInput {
    return {
      rev: d.rev,
      name: d.name,
      number: d.number,
      nameEn: d.nameEn,
      mode: d.mode,
      companyId: d.company?.id ?? null,
      ticketType: d.ticketType,
      fareSystemId: d.fareSystem?.id ?? null,
      fare: d.fare,
      ext: d.ext,
      routes: d.routes.map((r) => ({
        kind: r.kind,
        serviceType: r.serviceType,
        serviceTime: r.serviceTime,
        interval: r.interval,
        stops: r.stops.map((s) => ({ stopId: s.stop.id, times: s.times, ext: s.ext })),
      })),
    }
  }

  /** 站点被路径站引用的每一处，带前后站 */
  async references(stopId: string): Promise<StopReference[]> {
    if (!(await this.prisma.stop.findUnique({ where: { id: stopId }, select: { id: true } }))) throw notFound('站点')
    const rows = await this.prisma.routeStop.findMany({
      where: { stopId },
      select: {
        seq: true,
        route: {
          select: {
            kind: true,
            line: { select: { id: true, name: true, rev: true, status: true } },
            stops: { orderBy: { seq: 'asc' }, select: { seq: true, stop: { select: STOP_SELECT } } },
          },
        },
      },
    })
    return rows
      .map(({ seq, route }) => {
        const index = route.stops.findIndex((s) => s.seq === seq)
        return {
          lineId: route.line.id,
          lineName: route.line.name,
          lineSuspended: route.line.status === 'suspended',
          rev: route.line.rev,
          routeKind: route.kind,
          index,
          prev: route.stops[index - 1]?.stop ?? null,
          next: route.stops[index + 1]?.stop ?? null,
        }
      })
      .sort(
        (a, b) =>
          compareLineName(a.lineName, b.lineName) ||
          a.lineId.localeCompare(b.lineId) ||
          kindOrder(a.routeKind) - kindOrder(b.routeKind) ||
          a.index - b.index,
      )
  }

  /**
   * 成组修改的公共部分：一个事务里读出各线路当前内容，rev 对不上就整组拒绝（409）；
   * edit 改写输入，返回 false 表示该线路与打开时不一致（也按冲突处理）；每条线路各存一份"修改"快照
   */
  private async group(
    items: { lineId: string; rev: number }[],
    note: string,
    edit: (input: LineUpdateInput, line: LineDetail) => boolean,
  ): Promise<GroupLineResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const ids = [...new Set(items.map((i) => i.lineId))]
        const lines = new Map((await this.details(tx, ids)).map((d) => [d.id, d]))
        const conflict = (stale: string[]) =>
          new AppError(
            409,
            ERROR_CODES.conflict,
            `这些线路刚刚在别处修改：${stale.map((id) => lines.get(id)?.name ?? '（已删除）').join('、')}，请刷新后重试`,
            { lines: stale },
          )
        const stale = ids.filter((id) => {
          const d = lines.get(id)
          return !d || items.some((i) => i.lineId === id && i.rev !== d.rev)
        })
        if (stale.length) throw conflict(stale)
        const inputs = new Map<string, LineUpdateInput>()
        for (const id of ids) {
          const input = this.inputOf(lines.get(id)!)
          if (edit(input, lines.get(id)!)) inputs.set(id, input)
          else stale.push(id)
        }
        if (stale.length) throw conflict(stale)
        const out: GroupLineResult['lines'] = []
        for (const [id, input] of inputs) {
          try {
            await this.updateIn(tx, id, input, note)
            out.push({ id, name: input.name, changed: true })
          } catch (e) {
            if (!(e instanceof NoChange)) throw e
            throw invalid(`${input.name} 的站序没有变化`)
          }
        }
        return { lines: out }
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
  }

  /** 站点加入线路（需求 5.3.4）：插入位置按每个走向给定；同一走向多处插入从后往前插，避免下标错位 */
  async joinStop(stopId: string, input: StopJoinInput): Promise<GroupLineResult> {
    const stopIds = [...new Set([stopId, ...input.items.flatMap((i) => i.inserts.map((x) => x.stopId))])]
    const stops = await this.prisma.stop.findMany({ where: { id: { in: stopIds } }, select: STOP_SELECT })
    if (stops.length !== stopIds.length) throw notFound('站点')
    const labels = stopIds.map((id) => stopLabel(stops.find((s) => s.id === id)!))
    return this.group(input.items, `站点 ${labels.join('、')} 加入站序`, (line, d) => {
      const item = input.items.find((i) => i.lineId === d.id)!
      for (const ins of [...item.inserts].sort((a, b) => b.at - a.at)) {
        const route = line.routes.find((r) => r.kind === ins.kind)
        if (!route) throw invalid(`${d.name}没有${ROUTE_KIND_LABEL[ins.kind]}`)
        if (ins.at > route.stops.length) return false
        route.stops.splice(ins.at, 0, { stopId: ins.stopId, times: [], ext: {} })
      }
      return true
    })
  }

  /** 在线路中替换站点（需求 5.3.4）：到站时刻与路径站扩展字段保留；替换后与相邻站相同的拒绝 */
  async replaceStop(stopId: string, input: StopReplaceInput): Promise<GroupLineResult> {
    if (input.targetId === stopId) throw invalid('不能替换成同一个站点')
    const [from, to] = await Promise.all(
      [stopId, input.targetId].map((id) => this.prisma.stop.findUnique({ where: { id }, select: STOP_SELECT })),
    )
    if (!from || !to) throw notFound('站点')
    return this.group(input.refs, `站点 ${stopLabel(from)} 替换为 ${stopLabel(to)}`, (line, d) => {
      const refs = input.refs.filter((r) => r.lineId === d.id)
      for (const ref of refs) {
        const s = line.routes.find((r) => r.kind === ref.kind)?.stops[ref.index]
        if (s?.stopId !== stopId) return false
        s.stopId = input.targetId
      }
      for (const ref of refs) {
        const stops = line.routes.find((r) => r.kind === ref.kind)!.stops
        if (stops[ref.index - 1]?.stopId === input.targetId || stops[ref.index + 1]?.stopId === input.targetId)
          throw invalid(`${d.name} ${ROUTE_KIND_LABEL[ref.kind]}第 ${ref.index + 1} 站：替换后会和相邻的站相同`)
      }
      return true
    })
  }

  /* ---------------- 沿线编排进度（需求 5.4.6，M5 计划 3.4） ---------------- */

  async arrangement(id: string): Promise<LineArrangement> {
    const line = await this.prisma.line.findUnique({
      where: { id },
      select: { status: true, routes: { select: { id: true, kind: true } } },
    })
    if (!line) throw notFound('线路')
    const routes = [...line.routes].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))
    const totals = { placed: 0, hidden: 0, waiting: 0, invalidStops: 0 }
    if (line.status === 'suspended')
      return {
        suspended: true,
        routes: routes.map((r) => ({ routeId: r.id, kind: r.kind, stops: [] })),
        invalid: [],
        totals,
      }
    // 本线路各走向的途经：（走向，站点）分区按站序编号
    const passes = Prisma.sql`
      SELECT rs."routeId", rs."stopId", rs.seq,
             row_number() OVER (PARTITION BY rs."routeId", rs."stopId" ORDER BY rs.seq) AS pass
      FROM "RouteStop" rs JOIN "Route" r ON r.id = rs."routeId"
      WHERE r."lineId" = ${id}::uuid`
    const [rows, invalidRows] = await Promise.all([
      this.prisma.$queryRaw<{ routeId: string; stopId: string; pass: number; status: ArrangeStatus }[]>`
        WITH p AS (${passes})
        SELECT p."routeId"::text AS "routeId", p."stopId"::text AS "stopId", p.pass::int AS pass,
               CASE WHEN bool_or(sc.placement IN ('board', 'slot')) THEN 'placed'
                    WHEN bool_or(sc.placement = 'hidden') THEN 'hidden'
                    ELSE 'waiting' END AS status
        FROM p
        LEFT JOIN "SignSet" ss ON ss."stopId" = p."stopId"
        LEFT JOIN "Schedule" sc ON sc."signSetId" = ss.id AND sc."routeId" = p."routeId" AND sc.pass = p.pass
        GROUP BY p."routeId", p."stopId", p.pass, p.seq
        ORDER BY p."routeId", p.seq`,
      this.prisma.$queryRaw<{ id: string; name: string; direction: string; count: number }[]>`
        WITH p AS (${passes})
        SELECT st.id::text AS id, st.name, st.direction, count(*)::int AS count
        FROM "Schedule" sc
        JOIN "Route" r ON r.id = sc."routeId" AND r."lineId" = ${id}::uuid
        JOIN "SignSet" ss ON ss.id = sc."signSetId"
        JOIN "Stop" st ON st.id = ss."stopId"
        WHERE NOT EXISTS (
          SELECT 1 FROM p WHERE p."routeId" = sc."routeId" AND p."stopId" = ss."stopId" AND p.pass = sc.pass)
        GROUP BY st.id, st.name, st.direction
        ORDER BY st.name, st.direction`,
    ])
    for (const r of rows) totals[r.status]++
    totals.invalidStops = invalidRows.length
    return {
      suspended: false,
      routes: routes.map((r) => ({
        routeId: r.id,
        kind: r.kind,
        stops: rows.filter((x) => x.routeId === r.id).map(({ stopId, pass, status }) => ({ stopId, pass, status })),
      })),
      invalid: invalidRows,
      totals,
    }
  }

  private conflict(latest: LineDetail) {
    return new AppError(409, ERROR_CODES.conflict, '这条线路已在别处修改，没有覆盖', { latest })
  }

  /** 停运与恢复：带 rev，即时生效；只给线路自身存一份"修改"快照（默认决定 3） */
  async setStatus(id: string, rev: number, status: 'running' | 'suspended'): Promise<SaveResult<LineDetail>> {
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.line.findUnique({ where: { id }, select: { rev: true, status: true } })
      if (!cur) throw notFound('线路')
      if (cur.rev !== rev) throw this.conflict(await this.detail(tx, id))
      if (cur.status === status) return { changed: false, item: await this.detail(tx, id) }
      await tx.line.update({ where: { id }, data: { status, rev: { increment: 1 } } })
      const detail = await this.detail(tx, id)
      await this.snapshots.record(tx, {
        type: 'line',
        id,
        name: detail.name,
        action: 'update',
        note: status === 'suspended' ? '停运' : '恢复运营',
        content: this.content(detail, await this.extDefs(tx)),
      })
      return { changed: true, item: { ...detail, snapshotCount: detail.snapshotCount + 1 } }
    })
  }

  async deleteCheck(id: string): Promise<LineDeleteCheck> {
    const l = await this.prisma.line.findUnique({
      where: { id },
      select: { routes: { select: { id: true, stops: { select: { stopId: true } } } } },
    })
    if (!l) throw notFound('线路')
    return {
      routes: l.routes.length,
      stops: new Set(l.routes.flatMap((r) => r.stops.map((s) => s.stopId))).size,
      affectedSignSets: await this.hook.countAffected(l.routes.map((r) => r.id)),
    }
  }

  /**
   * 停运、恢复、删除、改模式的确认弹窗（默认决定 14）：经过的站点数、受影响的站牌集数与编排数。
   * kinds：只统计将删除的走向（改模式，AC-16）
   */
  async impact(id: string, kinds?: RouteKind[]): Promise<LineImpact> {
    const l = await this.prisma.line.findUnique({
      where: { id },
      select: { routes: { select: { id: true, kind: true, stops: { select: { stopId: true } } } } },
    })
    if (!l) throw notFound('线路')
    const routes = kinds ? l.routes.filter((r) => kinds.includes(r.kind)) : l.routes
    const a = await this.hook.affected(routes.map((r) => r.id))
    return { stops: new Set(routes.flatMap((r) => r.stops.map((s) => s.stopId))).size, ...a }
  }

  /** 删除线路：连同全部走向与站序；调用 M3 接口处理编排；线路自身存一份"删除"快照 */
  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const detail = await this.detail(tx, id)
      await this.hook.onRoutesRemoved(tx, {
        routeIds: detail.routes.map((r) => r.id),
        note: `删除线路 ${detail.name}，连带移除编排`,
      })
      await this.snapshots.record(tx, {
        type: 'line',
        id,
        name: detail.name,
        action: 'delete',
        content: this.content(detail, await this.extDefs(tx)),
      })
      await tx.line.delete({ where: { id } })
    })
  }
}
