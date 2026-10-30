import { Injectable } from '@nestjs/common'
import {
  DIRECTIONS,
  ERROR_CODES,
  STOP_BATCH_MAX,
  STOP_DIFF_SPEC,
  changedLabels,
  checkExtValue,
  distanceM,
  compareLineName,
  isDirection,
  roundCoord,
  stopLabel,
  stopSnapshot,
  type DeleteCheck,
  type DictCategory,
  type ExtType,
  type Page,
  type Ref,
  type OppositeMap,
  type SaveResult,
  type StopBatchInput,
  type StopBatchPreview,
  type StopBatchResult,
  type StopDetail,
  type StopInput,
  type StopListItem,
  type StopListQuery,
  type StopMatchResult,
  type StopNameCheck,
  type StopRef,
  type StopUpdateInput,
} from '@gentransit/shared'
import { AppError, duplicate, inUse, invalid, notFound } from '../common/errors'
import { validateExt } from '../common/ext'
import { oppositesOf } from '../common/opposites'
import { stopReferrers } from '../common/referrers'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SettingsService } from '../settings/settings.service'
import { SignSetService } from '../sign-sets/sign-set.service'
import { SnapshotService } from '../snapshots/snapshot.service'
import { UploadService } from '../uploads/upload.service'
import { stopCheckWhere } from './stop-checks'

const REF = { select: { id: true, name: true } } as const

export const STOP_DETAIL_INCLUDE = {
  city: REF,
  district: REF,
  street: REF,
  road: REF,
  platformType: REF,
  safety: REF,
  shelterType: REF,
  maintainer: REF,
  landmarks: { include: { landmark: { select: { id: true, name: true, category: { select: { name: true } } } } } },
  photos: { orderBy: { sort: 'asc' as const }, include: { upload: true } },
  signSet: { select: { id: true } },
} satisfies Prisma.StopInclude

const LIST_INCLUDE = {
  city: REF,
  district: REF,
  street: REF,
  road: REF,
  maintainer: REF,
  landmarks: { include: { landmark: REF } },
  routeStops: { select: { route: { select: { line: { select: { id: true, name: true, status: true } } } } } },
} satisfies Prisma.StopInclude

type DetailRow = Prisma.StopGetPayload<{ include: typeof STOP_DETAIL_INCLUDE }>
type ListRow = Prisma.StopGetPayload<{ include: typeof LIST_INCLUDE }>

const ref = (r: Ref | null): Ref | null => (r ? { id: r.id, name: r.name } : null)

/** "保存后内容与最后一份快照相同"：回滚业务写入 */
class NoChange extends Error {}

const STOP_REF = { id: true, name: true, direction: true, lng: true, lat: true } as const

/** 批量修改能改的列（M5 计划 2.7）：补丁键 → 列名与显示名 */
const BATCH_COLUMNS = {
  roadId: '路段',
  maintainerId: '维护公司',
  berths: '泊位数',
  platformTypeId: '站台类型',
  safetyId: '安全设施',
  waiting: '候车设施',
  shelterTypeId: '候车亭类型',
  bigLightbox: '大灯箱数',
  smallLightbox: '小灯箱数',
  seats: '座椅数',
} as const
type BatchColumn = keyof typeof BATCH_COLUMNS
const BATCH_SELECT = {
  id: true,
  name: true,
  direction: true,
  cityId: true,
  districtId: true,
  streetId: true,
  ext: true,
  ...Object.fromEntries(Object.keys(BATCH_COLUMNS).map((k) => [k, true])),
} as Record<string, true>
type BatchRow = Record<BatchColumn | 'cityId' | 'districtId' | 'streetId', string | number | null> & {
  id: string
  name: string
  direction: string
  ext: unknown
}
interface BatchChange {
  id: string
  name: string
  direction: string
  fields: string[]
  data: Prisma.StopUncheckedUpdateInput
}

@Injectable()
export class StopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotService,
    private readonly settings: SettingsService,
    private readonly uploads: UploadService,
    private readonly signSets: SignSetService,
  ) {}

  /* ---------------- 读取 ---------------- */

  get(id: string) {
    return this.detail(this.prisma, id)
  }

  async detail(db: Tx, id: string): Promise<StopDetail> {
    const s = await db.stop.findUnique({ where: { id }, include: STOP_DETAIL_INCLUDE })
    if (!s) throw notFound('站点')
    const routes = await db.route.findMany({
      where: { stops: { some: { stopId: id } } },
      include: {
        line: { select: { id: true, name: true, status: true } },
        stops: { orderBy: { seq: 'asc' }, select: { stop: { select: { name: true, lng: true, lat: true } } } },
      },
    })
    const snapshotCount = await db.snapshot.count({ where: { objectType: 'stop', objectId: id } })
    return this.toDetail(s, routes, snapshotCount, await this.signSets.brief(db, s.signSet?.id))
  }

  toDetail(
    s: DetailRow,
    routes: {
      id: string
      kind: StopDetail['routes'][number]['routeKind']
      line: { id: string; name: string; status: string }
      stops: { stop: { name: string; lng: number; lat: number } }[]
    }[],
    snapshotCount: number,
    signSet: StopDetail['signSet'] = { id: s.signSet?.id ?? '', shelves: 0, boards: 0, waiting: 0, invalid: 0 },
  ): StopDetail {
    return {
      id: s.id,
      rev: s.rev,
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
      landmarks: s.landmarks
        .map((l) => ({ id: l.landmark.id, name: l.landmark.name, category: l.landmark.category.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN-u-co-pinyin')),
      photos: s.photos.map((p) => this.uploads.toDto(p.upload)),
      ext: (s.ext ?? {}) as Record<string, unknown>,
      routes: routes
        .map((r) => ({
          lineId: r.line.id,
          lineName: r.line.name,
          routeId: r.id,
          routeKind: r.kind,
          suspended: r.line.status === 'suspended',
          terminal: r.stops.at(-1)?.stop.name ?? '',
          path: r.stops.map((x) => [x.stop.lng, x.stop.lat] as [number, number]),
        }))
        .sort((a, b) => compareLineName(a.lineName, b.lineName) || a.routeKind.localeCompare(b.routeKind)),
      signSet,
      snapshotCount,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }
  }

  private toListItem(s: ListRow): StopListItem {
    const lines = new Map<string, { id: string; name: string; suspended: boolean }>()
    for (const { route } of s.routeStops)
      lines.set(route.line.id, {
        id: route.line.id,
        name: route.line.name,
        suspended: route.line.status === 'suspended',
      })
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
      maintainer: ref(s.maintainer),
      remark: s.remark,
      landmarks: s.landmarks.map((l) => ref(l.landmark)!),
      lines: [...lines.values()].sort((a, b) => compareLineName(a.name, b.name)),
      ext: (s.ext ?? {}) as Record<string, unknown>,
      updatedAt: s.updatedAt.toISOString(),
    }
  }

  /** 列表：筛选、分页、排序（站名按拼音序，列排序规则 zh-x-icu） */
  async list(q: StopListQuery): Promise<Page<StopListItem>> {
    const { where, orderBy } = this.query(q)
    if (q.near) {
      // 按距离排序（M5 加站辅助）：数据库排不了，取出筛选后的坐标在内存里排，再取当前页的完整数据
      const [lng, lat] = q.near
      const all = (await this.prisma.stop.findMany({ where, select: { id: true, lng: true, lat: true } }))
        .map((s) => ({ id: s.id, d: distanceM({ lng, lat }, s) }))
        .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1))
      const page = all.slice((q.page - 1) * q.size, q.page * q.size)
      const rows = await this.prisma.stop.findMany({
        where: { id: { in: page.map((x) => x.id) } },
        include: LIST_INCLUDE,
      })
      const byId = new Map(rows.map((r) => [r.id, r]))
      return {
        items: page.map((x) => ({ ...this.toListItem(byId.get(x.id)!), distance: Math.round(x.d) })),
        total: all.length,
        page: q.page,
        size: q.size,
      }
    }
    const [total, rows] = await Promise.all([
      this.prisma.stop.count({ where }),
      this.prisma.stop.findMany({ where, orderBy, skip: (q.page - 1) * q.size, take: q.size, include: LIST_INCLUDE }),
    ])
    return { items: rows.map((r) => this.toListItem(r)), total, page: q.page, size: q.size }
  }

  /** 列表与导出共用的筛选与排序 */
  query(q: Omit<StopListQuery, 'page' | 'size'>) {
    const where: Prisma.StopWhereInput = {
      direction: q.dir || undefined,
      cityId: q.cityId,
      districtId: q.districtId,
      streetId: q.streetId,
      roadId: q.roadId,
      maintainerId: q.maintainerId,
      routeStops: q.lineIds?.length ? { some: { route: { lineId: { in: q.lineIds } } } } : undefined,
      OR: q.q
        ? [
            { name: { contains: q.q, mode: 'insensitive' } },
            { nameEn: { contains: q.q, mode: 'insensitive' } },
            { road: { name: { contains: q.q, mode: 'insensitive' } } },
          ]
        : undefined,
      AND: q.check ? [stopCheckWhere(q.check)] : undefined,
    }
    const orderBy: Prisma.StopOrderByWithRelationInput[] =
      q.sort === 'updatedAt' || q.sort === '-updatedAt'
        ? [{ updatedAt: q.sort === 'updatedAt' ? 'asc' : 'desc' }, { id: 'asc' }]
        : [{ name: q.sort === '-name' ? 'desc' : 'asc' }, { direction: 'asc' }, { id: 'asc' }]
    return { where, orderBy }
  }

  /** 站名联想：去重后的站名 */
  async suggest(q: string): Promise<string[]> {
    if (!q) return []
    const rows = await this.prisma.stop.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      distinct: ['name'],
      select: { name: true },
      orderBy: { name: 'asc' },
      take: 10,
    })
    return rows.map((r) => r.name)
  }

  /** 站名 + 方位批量匹配：供线路表单"粘贴两列文本"使用 */
  async match(rows: { name: string; direction: string }[]): Promise<StopMatchResult[]> {
    const pairs = rows.filter((r) => r.name && r.direction)
    const found = pairs.length
      ? await this.prisma.stop.findMany({
          where: { OR: pairs.map((r) => ({ name: r.name, direction: r.direction })) },
          select: { id: true, name: true, direction: true, lng: true, lat: true },
        })
      : []
    const byKey = new Map(found.map((s) => [`${s.name}\u0000${s.direction}`, s]))
    return rows.map((r, index) => ({ index, ...r, stop: byKey.get(`${r.name}\u0000${r.direction}`) ?? null }))
  }

  /** 站名 + 方位重复的即时检查 */
  async checkName(name: string, direction: string, excludeId?: string): Promise<StopNameCheck> {
    const s = await this.prisma.stop.findFirst({
      where: { name: name.trim(), direction: direction.trim(), NOT: excludeId ? { id: excludeId } : undefined },
      select: { id: true, name: true, direction: true },
    })
    return { exists: Boolean(s), stop: s }
  }

  /* ---------------- 辅助（M5） ---------------- */

  /** 对向站点（BR-19） */
  async opposites(ids: string[]): Promise<OppositeMap> {
    const { orientationMode } = await this.settings.get(this.prisma)
    const found = await oppositesOf(this.prisma, orientationMode, ids)
    return Object.fromEntries(ids.map((id) => [id, found.get(id) ?? null]))
  }

  /** 视野里的站点（地图点选加站）：离视野中心最近的 limit 个 */
  async inView([w, s, e, n]: [number, number, number, number], limit = 300): Promise<StopRef[]> {
    const rows = await this.prisma.stop.findMany({
      where: { lng: { gte: w, lte: e }, lat: { gte: s, lte: n } },
      select: STOP_REF,
    })
    const c = { lng: (w + e) / 2, lat: (s + n) / 2 }
    return rows
      .map((r) => ({ r, d: distanceM(c, r) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => x.r)
  }

  /** 全部站点的经纬度范围（地图初始视野，F-COM-18）；没有站点时为 null */
  async extent(): Promise<{ west: number; south: number; east: number; north: number } | null> {
    const a = await this.prisma.stop.aggregate({ _min: { lng: true, lat: true }, _max: { lng: true, lat: true } })
    if (a._min.lng === null) return null
    return { west: a._min.lng, south: a._min.lat!, east: a._max.lng!, north: a._max.lat! }
  }

  /* ---------------- 批量修改（需求 5.3.2、M5 计划 3.3） ---------------- */

  async batchPreview(input: StopBatchInput): Promise<StopBatchPreview> {
    const { selected, changes } = await this.batchPlan(this.prisma, input)
    return {
      selected,
      changing: changes.length,
      sample: changes.slice(0, 10).map(({ id, name, direction, fields }) => ({ id, name, direction, fields })),
    }
  }

  /** 按字段覆盖，不检查打开时间（BR-22 的例外）；只写真的会变的站点，每站一份"修改"快照 */
  async batch(input: StopBatchInput): Promise<StopBatchResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const { selected, changes } = await this.batchPlan(tx, input)
        const defs = await tx.extField.findMany({ where: { owner: 'stop' } })
        // 先成批读出这些站点的完整行、补丁引用的名称，改动在内存里套上：每站只剩一次更新和快照的一读一写。
        // 快照不含派生信息（经过线路、站牌集计数），不读它们
        const ids = changes.map((c) => c.id)
        const rows = new Map<string, DetailRow>()
        for (let i = 0; i < ids.length; i += 500)
          for (const r of await tx.stop.findMany({
            where: { id: { in: ids.slice(i, i + 500) } },
            include: STOP_DETAIL_INCLUDE,
          }))
            rows.set(r.id, r)
        const refIds = [
          ...new Set(
            changes.flatMap((c) =>
              Object.entries(c.data).flatMap(([k, v]) => (k.endsWith('Id') && typeof v === 'string' ? [v] : [])),
            ),
          ),
        ]
        const refs = [
          ...(await tx.dictItem.findMany({ where: { id: { in: refIds } }, select: { id: true, name: true } })),
          ...(await tx.region.findMany({ where: { id: { in: refIds } }, select: { id: true, name: true } })),
        ]
        const nameOf = new Map(refs.map((r) => [r.id, r.name]))
        let changed = 0
        for (const c of changes) {
          await tx.stop.update({ where: { id: c.id }, data: { ...c.data, rev: { increment: 1 } } })
          const row: Record<string, unknown> = { ...rows.get(c.id)! }
          for (const [k, v] of Object.entries(c.data)) {
            row[k] = v
            // roadId → road 等引用列：换成带名称的引用
            if (k.endsWith('Id')) row[k.slice(0, -2)] = v ? { id: v, name: nameOf.get(v as string) ?? '' } : null
          }
          const detail = this.toDetail(row as DetailRow, [], 0)
          const content = this.content(detail, defs)
          const r = await this.snapshots.record(tx, {
            type: 'stop',
            id: c.id,
            name: stopLabel(detail),
            action: 'update',
            content,
            noteFrom: (prev) => `批量修改：${changedLabels(prev, content, STOP_DIFF_SPEC).join('、')}`,
          })
          if (r.written) changed++
        }
        return { selected, changed }
      },
      { timeout: 5 * 60 * 1000, maxWait: 30 * 1000 },
    )
  }

  /** 解析范围、校验补丁里的引用，算出每个站点真正会变的字段 */
  private async batchPlan(db: Tx, { scope, patch }: StopBatchInput) {
    const ids =
      'ids' in scope
        ? [...new Set(scope.ids)]
        : (
            await db.stop.findMany({
              where: this.query(scope.filter).where,
              select: { id: true },
              take: STOP_BATCH_MAX + 1,
            })
          ).map((s) => s.id)
    if (ids.length > STOP_BATCH_MAX) throw invalid(`一次最多批量修改 ${STOP_BATCH_MAX} 个站点，请缩小筛选范围`)

    // 平铺补丁：列名 → 新值（键不出现 = 不改）
    const cols: Partial<Record<BatchColumn | 'cityId' | 'districtId' | 'streetId', string | number | null>> = {}
    if (patch.region !== undefined) {
      cols.cityId = patch.region?.cityId ?? null
      cols.districtId = patch.region?.districtId ?? null
      cols.streetId = patch.region?.streetId ?? null
    }
    if (patch.roadId !== undefined) cols.roadId = patch.roadId
    if (patch.maintainerId !== undefined) cols.maintainerId = patch.maintainerId
    for (const [k, v] of Object.entries(patch.facilities ?? {})) if (v !== undefined) cols[k as BatchColumn] = v
    await this.checkRefs(db, {
      cityId: (cols.cityId as string | null) ?? null,
      districtId: (cols.districtId as string | null) ?? null,
      streetId: (cols.streetId as string | null) ?? null,
      roadId: (cols.roadId as string | null) ?? null,
      maintainerId: (cols.maintainerId as string | null) ?? null,
      platformTypeId: (cols.platformTypeId as string | null) ?? null,
      safetyId: (cols.safetyId as string | null) ?? null,
      shelterTypeId: (cols.shelterTypeId as string | null) ?? null,
    })
    const defs = (await db.extField.findMany({ where: { owner: 'stop' } })).filter((d) => d.enabled)
    const extPatch = patch.ext ?? {}
    for (const [k, v] of Object.entries(extPatch)) {
      const d = defs.find((x) => x.key === k)
      if (!d) throw invalid(`扩展字段「${k}」不存在或已停用`)
      const r = checkExtValue(d, v)
      if (!r.ok) throw invalid(r.error)
      extPatch[k] = r.value
    }
    const extName = new Map(defs.map((d) => [d.key, d.name]))

    const changes: BatchChange[] = []
    for (let i = 0; i < ids.length; i += 500) {
      const rows = (await db.stop.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: BATCH_SELECT,
        orderBy: [{ name: 'asc' }, { direction: 'asc' }],
      })) as unknown as BatchRow[]
      for (const row of rows) {
        const data: Prisma.StopUncheckedUpdateInput = {}
        const fields: string[] = []
        if (
          patch.region !== undefined &&
          (['cityId', 'districtId', 'streetId'] as const).some((k) => row[k] !== cols[k])
        ) {
          Object.assign(data, { cityId: cols.cityId, districtId: cols.districtId, streetId: cols.streetId })
          fields.push('市 / 区 / 街道')
        }
        for (const k of Object.keys(BATCH_COLUMNS) as BatchColumn[])
          if (k in cols && row[k] !== cols[k]) {
            ;(data as Record<string, unknown>)[k] = cols[k]
            fields.push(BATCH_COLUMNS[k])
          }
        const ext = { ...((row.ext ?? {}) as Record<string, unknown>) }
        let extChanged = false
        for (const [k, v] of Object.entries(extPatch)) {
          if (JSON.stringify(ext[k] ?? null) === JSON.stringify(v ?? null)) continue
          if (v === null) delete ext[k]
          else ext[k] = v
          extChanged = true
          fields.push(extName.get(k) ?? k)
        }
        if (extChanged) data.ext = ext as Prisma.InputJsonValue
        if (fields.length) changes.push({ id: row.id, name: row.name, direction: row.direction, fields, data })
      }
    }
    return { selected: ids.length, changes }
  }

  /* ---------------- 校验 ---------------- */

  private async validate(db: Tx, input: StopInput, existingExt: Record<string, unknown>) {
    const settings = await this.settings.get(db)
    if (settings.orientationMode === 'orientation' && !isDirection(input.direction))
      throw invalid(`方位只能是${DIRECTIONS.join('、')}之一`, {
        issues: [{ path: 'direction', message: '方位不合法' }],
      })
    await this.checkRefs(db, input)

    const landmarkIds = [...new Set(input.landmarkIds)]
    if (landmarkIds.length > settings.landmarkLimit) throw invalid(`地标最多绑定 ${settings.landmarkLimit} 个`)
    if ((await db.landmark.count({ where: { id: { in: landmarkIds } } })) !== landmarkIds.length)
      throw invalid('地标不存在')

    const photoIds = [...new Set(input.photoIds)]
    if ((await db.upload.count({ where: { id: { in: photoIds } } })) !== photoIds.length) throw invalid('照片不存在')

    // 扩展字段按定义校验；停用字段的已有值保留，不接受新值
    const defs = await db.extField.findMany({ where: { owner: 'stop' } })
    const ext = validateExt(defs, input.ext, existingExt)
    return { landmarkIds, photoIds, ext, defs }
  }

  /** 字典项与行政区划引用：类别正确、三级区划层级一致 */
  private async checkRefs(
    db: Tx,
    input: Pick<
      StopInput,
      'roadId' | 'platformTypeId' | 'safetyId' | 'shelterTypeId' | 'maintainerId' | 'cityId' | 'districtId' | 'streetId'
    >,
  ) {
    const dicts: [string | null, DictCategory, string][] = [
      [input.roadId, 'road', '路段'],
      [input.platformTypeId, 'platformType', '站台类型'],
      [input.safetyId, 'safety', '安全设施'],
      [input.shelterTypeId, 'shelterType', '候车亭类型'],
      [input.maintainerId, 'maintainer', '维护公司'],
    ]
    const dictIds = dicts.flatMap(([id]) => (id ? [id] : []))
    const found = new Map(
      (await db.dictItem.findMany({ where: { id: { in: dictIds } }, select: { id: true, category: true } })).map(
        (d) => [d.id, d.category],
      ),
    )
    for (const [id, cat, label] of dicts) if (id && found.get(id) !== cat) throw invalid(`${label}不存在`)

    const regionIds = [input.cityId, input.districtId, input.streetId].filter((x): x is string => Boolean(x))
    const regions = new Map((await db.region.findMany({ where: { id: { in: regionIds } } })).map((r) => [r.id, r]))
    const level = (id: string | null, lv: string, label: string, parent: string | null) => {
      if (!id) return
      const r = regions.get(id)
      if (!r || r.level !== lv) throw invalid(`${label}不存在`)
      if (parent && r.parentId !== parent) throw invalid(`${label}不属于所选的上级区划`)
    }
    level(input.cityId, 'city', '市', null)
    level(input.districtId, 'district', '区', input.cityId)
    level(input.streetId, 'street', '街道', input.districtId)
  }

  private async assertUniqueName(db: Tx, name: string, direction: string, exceptId?: string) {
    const dup = await db.stop.findFirst({
      where: { name, direction, NOT: exceptId ? { id: exceptId } : undefined },
      select: { id: true, name: true, direction: true },
    })
    if (dup) throw duplicate(`已存在「${stopLabel(dup)}」，站名 + 方位不能重复`, { stop: dup })
  }

  private data(input: StopInput, ext: Record<string, unknown>) {
    return {
      name: input.name,
      direction: input.direction,
      nameEn: input.nameEn,
      lng: roundCoord(input.lng),
      lat: roundCoord(input.lat),
      cityId: input.cityId,
      districtId: input.districtId,
      streetId: input.streetId,
      roadId: input.roadId,
      qrUrl: input.qrUrl,
      berths: input.berths,
      platformTypeId: input.platformTypeId,
      safetyId: input.safetyId,
      waiting: input.waiting,
      shelterTypeId: input.shelterTypeId,
      bigLightbox: input.bigLightbox,
      smallLightbox: input.smallLightbox,
      seats: input.seats,
      maintainerId: input.maintainerId,
      remark: input.remark,
      ext: ext as Prisma.InputJsonValue,
    }
  }

  private async writeChildren(tx: Tx, stopId: string, landmarkIds: string[], photoIds: string[]) {
    await tx.stopLandmark.deleteMany({ where: { stopId } })
    await tx.stopPhoto.deleteMany({ where: { stopId } })
    if (landmarkIds.length)
      await tx.stopLandmark.createMany({ data: landmarkIds.map((landmarkId) => ({ stopId, landmarkId })) })
    if (photoIds.length)
      await tx.stopPhoto.createMany({ data: photoIds.map((uploadId, sort) => ({ stopId, uploadId, sort })) })
  }

  /** 快照内容：扩展字段带上当时的字段名与类型（含已停用字段） */
  private content(detail: StopDetail, defs: { key: string; name: string; type: ExtType }[]) {
    return stopSnapshot(detail, defs)
  }

  /* ---------------- 写入 ---------------- */

  /** 新建站点：同时建空站牌集；站点与站牌集各存一份"新增"快照（AC-01） */
  async create(input: StopInput): Promise<SaveResult<StopDetail>> {
    return this.prisma.$transaction(async (tx) => {
      const { landmarkIds, photoIds, ext, defs } = await this.validate(tx, input, {})
      await this.assertUniqueName(tx, input.name, input.direction)
      const stop = await tx.stop.create({ data: { ...this.data(input, ext), signSet: { create: {} } } })
      await this.writeChildren(tx, stop.id, landmarkIds, photoIds)
      const detail = await this.detail(tx, stop.id)
      const name = stopLabel(detail)
      await this.snapshots.record(tx, {
        type: 'stop',
        id: stop.id,
        name,
        action: 'create',
        content: this.content(detail, defs),
      })
      await this.snapshots.record(tx, {
        type: 'signSet',
        id: detail.signSet.id,
        name,
        action: 'create',
        content: (await this.signSets.contents(tx, [detail.signSet.id])).get(detail.signSet.id),
      })
      return { changed: true, item: { ...detail, snapshotCount: 1 } }
    })
  }

  /**
   * 保存：UPDATE … WHERE id = ? AND rev = ?，影响 0 行返回 409 并带最新内容（AC-10、BR-18）；
   * 保存后内容与最后一份快照相同则回滚，不写快照也不更新业务行，返回 changed=false
   */
  async update(id: string, input: StopUpdateInput): Promise<SaveResult<StopDetail>> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cur = await tx.stop.findUnique({ where: { id }, select: { rev: true, ext: true } })
        if (!cur) throw notFound('站点')
        if (cur.rev !== input.rev) throw this.conflict(await this.detail(tx, id))
        const { landmarkIds, photoIds, ext, defs } = await this.validate(
          tx,
          input,
          (cur.ext ?? {}) as Record<string, unknown>,
        )
        await this.assertUniqueName(tx, input.name, input.direction, id)
        const n = await tx.stop.updateMany({
          where: { id, rev: input.rev },
          data: { ...this.data(input, ext), rev: { increment: 1 } },
        })
        if (n.count === 0) throw this.conflict(await this.detail(tx, id))
        await this.writeChildren(tx, id, landmarkIds, photoIds)
        const detail = await this.detail(tx, id)
        const content = this.content(detail, defs)
        const r = await this.snapshots.record(tx, {
          type: 'stop',
          id,
          name: stopLabel(detail),
          action: 'update',
          content,
          noteFrom: (prev) => `修改：${changedLabels(prev, content, STOP_DIFF_SPEC).join('、')}`,
        })
        if (!r.written) throw new NoChange()
        return { changed: true, item: { ...detail, snapshotCount: detail.snapshotCount + 1 } }
      })
    } catch (e) {
      if (e instanceof NoChange) return { changed: false, item: await this.detail(this.prisma, id) }
      throw e
    }
  }

  private conflict(latest: StopDetail) {
    return new AppError(409, ERROR_CODES.conflict, '这个站点已在别处修改，没有覆盖', { latest })
  }

  async deleteCheck(id: string): Promise<DeleteCheck> {
    if (!(await this.prisma.stop.findUnique({ where: { id }, select: { id: true } }))) throw notFound('站点')
    const refs = await stopReferrers(this.prisma, id)
    return { canDelete: refs.total === 0, referrers: refs.referrers }
  }

  /** 删除站点：仍被路径站引用时拒绝并列出线路与走向（AC-09）；连带删除站牌集，两者各存一份"删除"快照（站牌集为完整内容） */
  async remove(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const detail = await this.detail(tx, id)
      const refs = await stopReferrers(tx, id)
      if (refs.total > 0) throw inUse(stopLabel(detail), refs.referrers, refs.total)
      const defs = await tx.extField.findMany({ where: { owner: 'stop' } })
      const name = stopLabel(detail)
      await this.snapshots.record(tx, { type: 'stop', id, name, action: 'delete', content: this.content(detail, defs) })
      if (detail.signSet.id)
        await this.snapshots.record(tx, {
          type: 'signSet',
          id: detail.signSet.id,
          name,
          action: 'delete',
          content: (await this.signSets.contents(tx, [detail.signSet.id])).get(detail.signSet.id),
        })
      await tx.stop.delete({ where: { id } })
    })
  }
}
