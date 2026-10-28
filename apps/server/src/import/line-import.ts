// 线路导入导出（需求 5.10.3、5.11；M2 计划 3.4、3.5）：三个 sheet——线路、走向、路径站。
// 按管理编号分组；任一行失败则整条线路失败并列出全部原因与未匹配站点（BR-17）；文件中出现的走向站序整体替换
import {
  LINE_DIFF_SPEC,
  LINE_MODE_LABEL,
  LINE_STATUS_LABEL,
  MODE_ROUTE_KINDS,
  ROUTE_KIND_LABEL,
  SERVICE_TYPE_LABEL,
  TICKET_TYPE_LABEL,
  changedLabels,
  diffSnapshots,
  formatExtValue,
  lineSnapshot,
  mapRoutesOnModeChange,
  parseTimes,
  passIndices,
  stopLabel,
  type ImportPreview,
  type LineDetail,
  type LineMode,
  type LineStatus,
  type RouteKind,
  type ServiceType,
  type TicketType,
} from '@gentransit/shared'
import type { Prisma } from '../generated/prisma/client'
import type { LineService } from '../lines/line.service'
import type { Tx } from '../prisma/prisma.service'
import type { SnapshotService } from '../snapshots/snapshot.service'
import type { ColumnSpec, Sheet, SheetSpec } from './excel'
import { parseExtCell, type Analysis, type ExtDefRow, type FailedRow } from './stop-import'

export const LINE_SHEETS = { line: '线路', route: '走向', stop: '路径站' } as const

const reverse = <T extends string>(m: Record<T, string>) =>
  new Map(Object.entries(m).map(([k, v]) => [v as string, k as T]))
const MODE_BY = reverse(LINE_MODE_LABEL)
const STATUS_BY = reverse(LINE_STATUS_LABEL)
const TICKET_BY = reverse(TICKET_TYPE_LABEL)
const SERVICE_BY = reverse(SERVICE_TYPE_LABEL)
const KIND_BY = reverse(ROUTE_KIND_LABEL)

export function lineSheetColumns(
  lineExt: ExtDefRow[],
  rsExt: ExtDefRow[],
): Record<keyof typeof LINE_SHEETS, ColumnSpec[]> {
  return {
    line: [
      { header: '管理编号*', width: 12 },
      { header: '线路名*', width: 12 },
      { header: '英文名', width: 16 },
      { header: '模式*', width: 8 },
      { header: '公交公司', width: 18 },
      { header: '售票类型', width: 10 },
      { header: '票制', width: 10 },
      { header: '票价', width: 10 },
      { header: '状态', width: 8 },
      ...lineExt.filter((d) => d.enabled).map((d) => ({ header: d.name, width: 14 })),
    ],
    route: [
      { header: '管理编号*', width: 12 },
      { header: '走向*', width: 8 },
      { header: '服务类型', width: 10 },
      { header: '服务时间', width: 20 },
      { header: '发车间隔', width: 14 },
    ],
    stop: [
      { header: '管理编号*', width: 12 },
      { header: '走向*', width: 8 },
      { header: '序号*', width: 6, numFmt: '0' },
      { header: '站名*', width: 16 },
      { header: '方位*', width: 8 },
      { header: '到站时刻', width: 40 },
      ...rsExt.filter((d) => d.enabled).map((d) => ({ header: d.name, width: 14 })),
    ],
  }
}

export const LINE_NOTES = [
  '三个 sheet 按管理编号对应：库里有这个管理编号则修改，没有则新增。导入不会删除线路。',
  '线路：模式填 单向、双边、单环、双环；状态填 运营、停运（不填为运营）；售票类型填 有人售票、无人售票。公交公司、票制填库里已有的名称。',
  '走向：双边填 上行、下行；双环填 内环、外环；单向线填 单向；单环线填 环线。服务类型填 定时班车、发车间隔。',
  '路径站：文件中出现的走向，站序整体替换为文件内容；没出现的走向不变。序号从 1 起连续。',
  '路径站按"站名 + 方位"匹配站点；任一站点匹配不上，整条线路导入失败，不会自动新建站点。',
  '到站时刻：HH:mm，多个时刻用逗号、顿号或空格分隔，按先后排列。',
  '修改已有线路时，空单元格表示该项不改。改了模式时，新模式下不存在的走向会被删除（预览里列出）。',
]

/* ---------------- 上下文 ---------------- */

interface StopRefFull {
  id: string
  name: string
  direction: string
  lng: number
  lat: number
}

export interface LineCtx {
  existing: Map<string, LineDetail>
  /** 全部线路的线路名 → 管理编号，用于线路名唯一检查 */
  nameToNumber: Map<string, string>
  stops: Map<string, StopRefFull>
  companies: Map<string, { id: string; name: string }>
  fareSystems: Map<string, { id: string; name: string }>
  lineExt: ExtDefRow[]
  rsExt: ExtDefRow[]
}

const sk = (name: string, direction: string) => `${name}\u0000${direction}`

export async function loadLineCtx(db: Tx, numbers: string[], lines: LineService): Promise<LineCtx> {
  const [all, stops, companies, fares, ext] = await Promise.all([
    db.line.findMany({ select: { id: true, name: true, number: true } }),
    db.stop.findMany({ select: { id: true, name: true, direction: true, lng: true, lat: true } }),
    db.busCompany.findMany({ select: { id: true, name: true } }),
    db.dictItem.findMany({ where: { category: 'fareSystem' }, select: { id: true, name: true } }),
    db.extField.findMany({
      where: { owner: { in: ['line', 'routeStop'] } },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  const wanted = new Set(numbers)
  const ids = all.filter((x) => wanted.has(x.number)).map((x) => x.id)
  const existing = new Map((await lines.details(db, ids)).map((l) => [l.number, l]))
  return {
    existing,
    nameToNumber: new Map(all.map((l) => [l.name, l.number])),
    stops: new Map(stops.map((s) => [sk(s.name, s.direction), s])),
    companies: new Map(companies.map((c) => [c.name, c])),
    fareSystems: new Map(fares.map((f) => [f.name, f])),
    lineExt: ext.filter((d) => d.owner === 'line'),
    rsExt: ext.filter((d) => d.owner === 'routeStop'),
  }
}

/** 表格里出现的管理编号（先读这些线路的详情） */
export const numbersIn = (sheets: Sheet[]) =>
  [
    ...new Set(
      Object.values(LINE_SHEETS).flatMap(
        (n) => sheets.find((s) => s.name === n)?.rows.map((r) => r.get('管理编号')) ?? [],
      ),
    ),
  ].filter(Boolean)

/* ---------------- 分析 ---------------- */

interface PlanRoute {
  kind: RouteKind
  serviceType: ServiceType | null
  serviceTime: string
  interval: string
  stops: { stopId: string; times: string[]; ext: Record<string, unknown> }[]
}

export interface LinePlanItem {
  number: string
  id: string | null
  /** 分析时的版本：别处保存过则计划哈希变化，确认被拒 */
  rev: number | null
  line: {
    name: string
    number: string
    nameEn: string
    mode: LineMode
    status: LineStatus
    companyId: string | null
    ticketType: TicketType | null
    fareSystemId: string | null
    fare: string
    ext: Record<string, unknown>
  }
  /** 文件里出现的走向：服务信息与站序整体替换 */
  routes: PlanRoute[]
  removed: RouteKind[]
  labels: string[]
}

export interface LinePlan {
  items: LinePlanItem[]
}

type Row = Sheet['rows'][number]

export function analyzeLines(sheets: Sheet[], ctx: LineCtx): Analysis<LinePlan> {
  const sheet = (n: string) => sheets.find((s) => s.name === n)
  const lineSheet = sheet(LINE_SHEETS.line)
  const routeSheet = sheet(LINE_SHEETS.route)
  const stopSheet = sheet(LINE_SHEETS.stop)
  const preview: ImportPreview = {
    kind: 'line',
    rows: (lineSheet?.rows.length ?? 0) + (routeSheet?.rows.length ?? 0) + (stopSheet?.rows.length ?? 0),
    created: [],
    updated: [],
    unchanged: 0,
    failures: [],
    newRefs: [],
    removedRoutes: [],
  }
  const plan: LinePlan = { items: [] }
  const failedRows: FailedRow[] = []
  const headers = Object.fromEntries(
    [lineSheet, routeSheet, stopSheet].filter(Boolean).map((s) => [s!.name, s!.headers]),
  )

  // 按管理编号分组，保持首次出现的顺序
  const groups = new Map<string, { line: Row[]; route: Row[]; stop: Row[] }>()
  const orphans: { sheet: string; row: Row }[] = []
  const add = (s: Sheet | undefined, part: 'line' | 'route' | 'stop') =>
    s?.rows.forEach((r) => {
      const n = r.get('管理编号')
      if (!n) return orphans.push({ sheet: s.name, row: r })
      const g = groups.get(n) ?? { line: [], route: [], stop: [] }
      g[part].push(r)
      groups.set(n, g)
    })
  add(lineSheet, 'line')
  add(routeSheet, 'route')
  add(stopSheet, 'stop')
  for (const o of orphans) {
    preview.failures.push({ sheet: o.sheet, rows: [o.row.row], key: `第 ${o.row.row} 行`, reasons: ['缺少管理编号'] })
    failedRows.push({ sheet: o.sheet, row: o.row.row, values: o.row.values, reason: '缺少管理编号' })
  }

  const namesInFile = new Map<string, string>()
  for (const [number, g] of groups) {
    const reasons: string[] = []
    const unmatched: string[] = []
    const existing = ctx.existing.get(number)
    if (number.length > 50) reasons.push('管理编号不能超过 50 字')
    if (g.line.length > 1)
      reasons.push(`线路 sheet 里有 ${g.line.length} 行这个管理编号（第 ${g.line.map((r) => r.row).join('、')} 行）`)
    const lr = g.line[0]
    if (!lr && !existing) reasons.push('线路 sheet 里没有这个管理编号，库里也没有这条线路')
    const cell = (h: string) => lr?.get(h) ?? ''

    // 线路属性：修改时空单元格表示不改
    const name = cell('线路名') || existing?.name || ''
    if (!name) reasons.push('缺少线路名')
    else if (name.length > 100) reasons.push('线路名不能超过 100 字')
    const other = ctx.nameToNumber.get(name)
    if (name && other && other !== number) reasons.push(`线路名「${name}」已被管理编号 ${other} 使用`)
    if (name && namesInFile.has(name) && namesInFile.get(name) !== number)
      reasons.push(`线路名「${name}」在文件里与管理编号 ${namesInFile.get(name)} 重复`)
    if (name) namesInFile.set(name, number)
    const pick = <T>(h: string, map: Map<string, T>, label: string, fallback: T): T => {
      const v = cell(h)
      if (!v) return fallback
      const hit = map.get(v)
      if (hit === undefined) reasons.push(`${label}「${v}」不合法`)
      return hit ?? fallback
    }
    const mode = pick('模式', MODE_BY, '模式', existing?.mode ?? (null as unknown as LineMode))
    if (!mode) reasons.push('缺少模式')
    const status = pick('状态', STATUS_BY, '状态', existing?.status ?? 'running')
    const ticketType = pick('售票类型', TICKET_BY, '售票类型', existing?.ticketType ?? null)
    const companyName = cell('公交公司')
    const company = companyName ? ctx.companies.get(companyName) : existing?.company
    if (companyName && !company) reasons.push(`公交公司「${companyName}」不存在`)
    const fareName = cell('票制')
    const fareSystem = fareName ? ctx.fareSystems.get(fareName) : existing?.fareSystem
    if (fareName && !fareSystem) reasons.push(`票制「${fareName}」不存在`)
    const nameEn = cell('英文名') || existing?.nameEn || ''
    const fare = cell('票价') || existing?.fare || ''
    if (fare.length > 50) reasons.push('票价不能超过 50 字')
    const ext = { ...(existing?.ext ?? {}) }
    for (const d of ctx.lineExt.filter((x) => x.enabled)) {
      const t = cell(d.name)
      if (!t) continue
      const r = parseExtCell(d, t)
      if (!r.ok) reasons.push(r.error)
      else if (r.value !== null) ext[d.key] = r.value
    }

    const kinds = mode ? MODE_ROUTE_KINDS[mode] : []
    const mapping =
      existing && mode
        ? mapRoutesOnModeChange(
            existing.routes.map((r) => r.kind),
            existing.mode,
            mode,
          )
        : []
    const oldRouteOf = (k: RouteKind) => {
      const from = mapping.find((m) => m.to === k)?.from
      return from ? existing!.routes.find((r) => r.kind === from) : undefined
    }

    // 走向与路径站
    const byKind = new Map<RouteKind, { route?: Row; stops: Row[] }>()
    const kindOf = (r: Row, sheetName: string) => {
      const label = r.get('走向')
      const k = KIND_BY.get(label)
      if (!label) reasons.push(`${sheetName}第 ${r.row} 行缺少走向`)
      else if (!k) reasons.push(`${sheetName}第 ${r.row} 行的走向「${label}」不合法`)
      else if (mode && !kinds.includes(k))
        reasons.push(
          `走向「${label}」与模式「${LINE_MODE_LABEL[mode]}」不符（应为 ${kinds.map((x) => ROUTE_KIND_LABEL[x]).join('、')}）`,
        )
      else return k
      return null
    }
    for (const r of g.route) {
      const k = kindOf(r, '走向 sheet ')
      if (!k) continue
      const e = byKind.get(k) ?? { stops: [] }
      if (e.route) reasons.push(`走向 sheet 里「${ROUTE_KIND_LABEL[k]}」出现了多次`)
      e.route = r
      byKind.set(k, e)
    }
    for (const r of g.stop) {
      const k = kindOf(r, '路径站 sheet ')
      if (!k) continue
      const e = byKind.get(k) ?? { stops: [] }
      e.stops.push(r)
      byKind.set(k, e)
    }

    const routes: PlanRoute[] = []
    for (const [k, e] of byKind) {
      const old = oldRouteOf(k)
      const rr = e.route
      const st = rr?.get('服务类型') ?? ''
      const serviceType = st ? (SERVICE_BY.get(st) ?? null) : (old?.serviceType ?? null)
      if (st && !SERVICE_BY.get(st)) reasons.push(`服务类型「${st}」不合法`)
      const serviceTime = rr?.get('服务时间') || old?.serviceTime || ''
      const interval = rr?.get('发车间隔') || old?.interval || ''
      if (serviceTime.length > 1000) reasons.push('服务时间不能超过 1000 字')
      if (interval.length > 500) reasons.push('发车间隔不能超过 500 字')
      let stops: PlanRoute['stops']
      if (e.stops.length) {
        const sorted = [...e.stops].sort((a, b) => Number(a.get('序号')) - Number(b.get('序号')))
        const seqs = sorted.map((r) => Number(r.get('序号')))
        if (seqs.some((x, i) => !Number.isInteger(x) || x !== i + 1))
          reasons.push(`${ROUTE_KIND_LABEL[k]}的序号应从 1 起连续且不重复`)
        if (sorted.length < 2) reasons.push(`${ROUTE_KIND_LABEL[k]}至少要有 2 个站`)
        const oldExt = old ? stopExtOf(old) : new Map<string, Record<string, unknown>>()
        const pass = passIndices(sorted.map((r) => sk(r.get('站名'), r.get('方位'))))
        stops = []
        sorted.forEach((r, i) => {
          const sname = r.get('站名')
          const sdir = r.get('方位')
          const hit = ctx.stops.get(sk(sname, sdir))
          if (!sname || !sdir) reasons.push(`路径站第 ${r.row} 行缺少站名或方位`)
          else if (!hit) {
            const label = stopLabel({ name: sname, direction: sdir })
            if (!unmatched.includes(label)) unmatched.push(label)
          }
          const t = parseTimes(r.get('到站时刻'))
          if (!t.ok) reasons.push(`路径站第 ${r.row} 行：${t.error}`)
          // 已停用的路径站扩展字段：保留原值（按站点 + 第几次途经对应）
          const rsExt: Record<string, unknown> = hit ? { ...(oldExt.get(`${hit.id}#${pass[i]}`) ?? {}) } : {}
          for (const d of ctx.rsExt.filter((x) => x.enabled)) {
            delete rsExt[d.key]
            const v = r.get(d.name)
            if (!v) continue
            const x = parseExtCell(d, v)
            if (!x.ok) reasons.push(`路径站第 ${r.row} 行：${x.error}`)
            else if (x.value !== null) rsExt[d.key] = x.value
          }
          if (hit) stops.push({ stopId: hit.id, times: t.ok ? t.times : [], ext: rsExt })
        })
      } else if (old) {
        stops = old.stops.map((s) => ({ stopId: s.stop.id, times: s.times, ext: s.ext }))
      } else {
        reasons.push(`${ROUTE_KIND_LABEL[k]}没有路径站`)
        stops = []
      }
      routes.push({ kind: k, serviceType, serviceTime, interval, stops })
    }
    // 新模式下的每个走向：文件里没有就沿用按位置对应的旧走向；两者都没有则失败
    for (const k of kinds)
      if (!byKind.has(k) && !oldRouteOf(k)) reasons.push(`缺少走向「${ROUTE_KIND_LABEL[k]}」的路径站`)
    const removed = mapping.filter((m) => m.from && !m.to).map((m) => m.from!)

    const allRows = [
      ...g.line.map((r) => [LINE_SHEETS.line, r] as const),
      ...g.route.map((r) => [LINE_SHEETS.route, r] as const),
      ...g.stop.map((r) => [LINE_SHEETS.stop, r] as const),
    ]
    if (unmatched.length) reasons.push(`有 ${unmatched.length} 个站点匹配不上`)
    if (reasons.length) {
      preview.failures.push({
        sheet: LINE_SHEETS.line,
        rows: allRows.map(([, r]) => r.row),
        key: number,
        reasons,
        unmatchedStops: unmatched.length ? unmatched : undefined,
      })
      for (const [s, r] of allRows)
        failedRows.push({ sheet: s, row: r.row, values: r.values, reason: reasons.join('；') })
      continue
    }

    const item: LinePlanItem = {
      number,
      id: existing?.id ?? null,
      rev: existing?.rev ?? null,
      line: {
        name,
        number,
        nameEn,
        mode,
        status,
        companyId: company?.id ?? null,
        ticketType,
        fareSystemId: fareSystem?.id ?? null,
        fare,
        ext,
      },
      routes,
      removed,
      labels: [],
    }
    // 比较：用快照的规范化与差异判断是否有变化（站点改名、重建路径站都不算）
    const target = snapshotOf(item, existing, ctx)
    if (existing) {
      const before = lineSnapshot(sourceOf(existing), ctx.lineExt, ctx.rsExt)
      const diff = diffSnapshots(before, target, LINE_DIFF_SPEC)
      if (!diff.length) {
        preview.unchanged++
        continue
      }
      item.labels = changedLabels(before, target, LINE_DIFF_SPEC)
      preview.updated.push({ key: number, name, diff })
      if (removed.length)
        preview.removedRoutes.push({ key: number, name, routes: removed.map((k) => ROUTE_KIND_LABEL[k]) })
    } else preview.created.push({ key: number, name })
    plan.items.push(item)
  }
  return { preview, plan, failedRows, headers }
}

function stopExtOf(route: LineDetail['routes'][number]) {
  return new Map(route.stops.map((s) => [`${s.stop.id}#${s.pass}`, s.ext]))
}

function sourceOf(l: LineDetail) {
  return {
    ...l,
    routes: l.routes.map((r) => ({ ...r, stops: r.stops.map((s) => ({ stop: s.stop, times: s.times, ext: s.ext })) })),
  }
}

/** 导入后的线路快照（用于和库里比较；走向没出现在文件里时沿用旧走向） */
function snapshotOf(item: LinePlanItem, existing: LineDetail | undefined, ctx: LineCtx) {
  const byId = new Map([...ctx.stops.values()].map((s) => [s.id, s]))
  const mapping = existing
    ? mapRoutesOnModeChange(
        existing.routes.map((r) => r.kind),
        existing.mode,
        item.line.mode,
      )
    : []
  const routes = MODE_ROUTE_KINDS[item.line.mode].map((k) => {
    const r = item.routes.find((x) => x.kind === k)
    if (r) return { ...r, stops: r.stops.map((s) => ({ stop: byId.get(s.stopId)!, times: s.times, ext: s.ext })) }
    const from = mapping.find((m) => m.to === k)?.from
    const old = existing!.routes.find((x) => x.kind === from)!
    return { ...old, kind: k, stops: old.stops.map((s) => ({ stop: s.stop, times: s.times, ext: s.ext })) }
  })
  const company = [...ctx.companies.values()].find((c) => c.id === item.line.companyId) ?? null
  const fareSystem = [...ctx.fareSystems.values()].find((c) => c.id === item.line.fareSystemId) ?? null
  return lineSnapshot({ ...item.line, company, fareSystem, routes }, ctx.lineExt, ctx.rsExt)
}

/* ---------------- 写入 ---------------- */

export async function applyLines(tx: Tx, plan: LinePlan, lines: LineService, snapshots: SnapshotService) {
  let created = 0
  let updated = 0
  for (const item of plan.items) {
    const defs = await lines.extDefs(tx)
    const data = {
      name: item.line.name,
      number: item.line.number,
      nameEn: item.line.nameEn,
      mode: item.line.mode,
      status: item.line.status,
      companyId: item.line.companyId,
      ticketType: item.line.ticketType,
      fareSystemId: item.line.fareSystemId,
      fare: item.line.fare,
      ext: item.line.ext as Prisma.InputJsonValue,
    }
    let id = item.id
    if (!id) {
      id = (await tx.line.create({ data })).id
      for (const r of item.routes) {
        const route = await tx.route.create({
          data: {
            lineId: id,
            kind: r.kind,
            serviceType: r.serviceType,
            serviceTime: r.serviceTime,
            interval: r.interval,
          },
        })
        await tx.routeStop.createMany({
          data: r.stops.map((s, i) => ({
            routeId: route.id,
            stopId: s.stopId,
            seq: i + 1,
            times: s.times,
            ext: s.ext as Prisma.InputJsonValue,
          })),
        })
      }
      created++
    } else {
      const before = await lines.detail(tx, id)
      await tx.line.update({ where: { id }, data: { ...data, rev: { increment: 1 } } })
      await lines.applyRoutes(
        tx,
        before,
        { mode: item.line.mode, name: item.line.name, routes: item.routes },
        item.routes.map((r) => r.stops.map((s) => s.ext)),
      )
      updated++
    }
    const detail = await lines.detail(tx, id)
    await snapshots.record(tx, {
      type: 'line',
      id,
      name: detail.name,
      action: item.id ? 'importUpdate' : 'importCreate',
      note: item.id ? `导入修改：${item.labels.join('、')}` : '',
      content: lines.content(detail, defs),
    })
  }
  return { created, updated }
}

/* ---------------- 导出 ---------------- */

const extCell = (d: ExtDefRow, v: unknown) =>
  v === null || v === undefined ? null : d.type === 'number' ? Number(v) : formatExtValue(v)

export function lineSheetSpecs(details: LineDetail[], lineExt: ExtDefRow[], rsExt: ExtDefRow[]): SheetSpec[] {
  const cols = lineSheetColumns(lineExt, rsExt)
  const le = lineExt.filter((d) => d.enabled)
  const re = rsExt.filter((d) => d.enabled)
  return [
    {
      name: LINE_SHEETS.line,
      columns: cols.line,
      rows: details.map((l) => [
        l.number,
        l.name,
        l.nameEn,
        LINE_MODE_LABEL[l.mode],
        l.company?.name ?? null,
        l.ticketType ? TICKET_TYPE_LABEL[l.ticketType] : null,
        l.fareSystem?.name ?? null,
        l.fare,
        LINE_STATUS_LABEL[l.status],
        ...le.map((d) => extCell(d, l.ext[d.key])),
      ]),
    },
    {
      name: LINE_SHEETS.route,
      columns: cols.route,
      rows: details.flatMap((l) =>
        l.routes.map((r) => [
          l.number,
          ROUTE_KIND_LABEL[r.kind],
          r.serviceType ? SERVICE_TYPE_LABEL[r.serviceType] : null,
          r.serviceTime,
          r.interval,
        ]),
      ),
    },
    {
      name: LINE_SHEETS.stop,
      columns: cols.stop,
      rows: details.flatMap((l) =>
        l.routes.flatMap((r) =>
          r.stops.map((s, i) => [
            l.number,
            ROUTE_KIND_LABEL[r.kind],
            i + 1,
            s.stop.name,
            s.stop.direction,
            s.times.join(','),
            ...re.map((d) => extCell(d, s.ext[d.key])),
          ]),
        ),
      ),
    },
  ]
}
