import { Injectable } from '@nestjs/common'
import {
  TOMBSTONE_TYPES,
  type DeletedType,
  type V1BusCompany,
  type V1Deleted,
  type V1DictItem,
  type V1ExtField,
  type V1Landmark,
  type V1LandmarkCategory,
  type V1ListQuery,
  type V1Page,
  type V1Region,
  type V1ShelfTemplate,
  type V1Line,
  type V1SignSet,
  type V1Stop,
  type DictCategory,
  type TemplateBoard,
} from '@gentransit/shared'
import { notFound } from '../common/errors'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { SignSetService } from '../sign-sets/sign-set.service'
import {
  LINE_V1_INCLUDE,
  STOP_V1_INCLUDE,
  enabledExtKeys,
  fileOf,
  lineOf,
  signSetOf,
  stopOf,
  type SignSetBundle,
} from './mappers'
import { keysetOrder, keysetWhere, readOne, readPage, type Keyset } from './paging'

const REF = { select: { id: true, name: true } } as const
const iso = (d: Date) => d.toISOString()
const byUpdated = (r: { id: string; updatedAt: Date }) => ({ t: r.updatedAt, id: r.id })

/** 站点、线路、站牌集的删除记在快照里；其余类型记在墓碑表 */
const SNAPSHOT_TYPES = ['stop', 'line', 'signSet'] as const

/**
 * 只读 API 的读取（M4 计划第 3 节）：列表按（changedAt，id）游标分页，一页在同一个只读事务里批量读出
 */
@Injectable()
export class ApiV1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signSets: SignSetService,
  ) {}

  /* ---------------- 站点 ---------------- */

  stops(q: V1ListQuery): Promise<V1Page<V1Stop>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) =>
        tx.stop.findMany({
          where: keysetWhere('updatedAt', k),
          orderBy: keysetOrder('updatedAt'),
          take,
          include: STOP_V1_INCLUDE,
        }),
      byUpdated,
      async (tx, rows) => {
        const ext = await enabledExtKeys(tx)
        return rows.map((r) => stopOf(r, ext))
      },
    )
  }

  stop(id: string): Promise<V1Stop> {
    return readOne(this.prisma, async (tx) => {
      const r = await tx.stop.findUnique({ where: { id }, include: STOP_V1_INCLUDE })
      if (!r) throw notFound('站点')
      return stopOf(r, await enabledExtKeys(tx))
    })
  }

  /* ---------------- 线路 ---------------- */

  lines(q: V1ListQuery): Promise<V1Page<V1Line>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) =>
        tx.line.findMany({
          where: keysetWhere('updatedAt', k),
          orderBy: keysetOrder('updatedAt'),
          take,
          include: LINE_V1_INCLUDE,
        }),
      byUpdated,
      async (tx, rows) => {
        const ext = await enabledExtKeys(tx)
        return rows.map((r) => lineOf(r, ext))
      },
    )
  }

  line(id: string): Promise<V1Line> {
    return readOne(this.prisma, async (tx) => {
      const r = await tx.line.findUnique({ where: { id }, include: LINE_V1_INCLUDE })
      if (!r) throw notFound('线路')
      return lineOf(r, await enabledExtKeys(tx))
    })
  }

  /* ---------------- 站牌集 ---------------- */

  signSetPage(q: V1ListQuery): Promise<V1Page<V1SignSet>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take): Promise<SignSetBundle[]> =>
        this.signSets.bundles(tx, {
          where: keysetWhere('changedAt', k) as Prisma.SignSetWhereInput,
          orderBy: keysetOrder('changedAt'),
          take,
        }),
      (b) => ({ t: b.changedAt, id: b.id }),
      (_tx, rows) => rows.map(signSetOf),
    )
  }

  signSetOfStop(stopId: string): Promise<V1SignSet> {
    return readOne(this.prisma, async (tx) => {
      const [b] = await this.signSets.bundles(tx, { where: { stopId } })
      if (!b) throw notFound('站点')
      return signSetOf(b)
    })
  }

  /* ---------------- 地标与参考数据 ---------------- */

  landmarks(q: V1ListQuery): Promise<V1Page<V1Landmark>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.landmark.findMany({ ...this.keyset(k), take, include: LANDMARK_INCLUDE }),
      byUpdated,
      (_tx, rows) => rows.map(landmarkOf),
    )
  }

  landmark(id: string): Promise<V1Landmark> {
    return readOne(this.prisma, async (tx) => {
      const r = await tx.landmark.findUnique({ where: { id }, include: LANDMARK_INCLUDE })
      if (!r) throw notFound('地标')
      return landmarkOf(r)
    })
  }

  landmarkCategories(q: V1ListQuery): Promise<V1Page<V1LandmarkCategory>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.landmarkCategory.findMany({ ...this.keyset(k), take }),
      byUpdated,
      (_tx, rows) => rows.map(categoryOf),
    )
  }

  landmarkCategory(id: string): Promise<V1LandmarkCategory> {
    return readOne(this.prisma, async (tx) => {
      const r = await tx.landmarkCategory.findUnique({ where: { id } })
      if (!r) throw notFound('地标类别')
      return categoryOf(r)
    })
  }

  dictItems(q: V1ListQuery & { category?: DictCategory }): Promise<V1Page<V1DictItem>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) =>
        tx.dictItem.findMany({
          where: { AND: [keysetWhere('updatedAt', k), q.category ? { category: q.category } : {}] },
          orderBy: keysetOrder('updatedAt'),
          take,
        }),
      byUpdated,
      (_tx, rows) =>
        rows.map((r) => ({
          id: r.id,
          category: r.category,
          name: r.name,
          createdAt: iso(r.createdAt),
          changedAt: iso(r.updatedAt),
        })),
    )
  }

  regions(q: V1ListQuery): Promise<V1Page<V1Region>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.region.findMany({ ...this.keyset(k), take }),
      byUpdated,
      (_tx, rows) =>
        rows.map((r) => ({
          id: r.id,
          level: r.level,
          name: r.name,
          parentId: r.parentId,
          createdAt: iso(r.createdAt),
          changedAt: iso(r.updatedAt),
        })),
    )
  }

  busCompanies(q: V1ListQuery): Promise<V1Page<V1BusCompany>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.busCompany.findMany({ ...this.keyset(k), take }),
      byUpdated,
      (_tx, rows) =>
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          nameEn: r.nameEn,
          shortName: r.shortName,
          logo: r.logoId ? fileOf(r.logoId) : null,
          hotline: r.hotline,
          createdAt: iso(r.createdAt),
          changedAt: iso(r.updatedAt),
        })),
    )
  }

  shelfTemplates(q: V1ListQuery): Promise<V1Page<V1ShelfTemplate>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.shelfTemplate.findMany({ ...this.keyset(k), take, include: { type: REF } }),
      byUpdated,
      (_tx, rows) =>
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          type: { id: r.type.id, name: r.type.name },
          desc: r.desc,
          noPhysical: r.noPhysical,
          image: r.imageId ? fileOf(r.imageId) : null,
          boards: ((r.boards ?? []) as unknown as TemplateBoard[]).map((b) => ({
            face: b.face,
            kind: b.kind,
            width: b.width,
            height: b.height,
            remark: b.remark ?? '',
            slots: (b.slots ?? []).map((s) => ({
              no: s.no,
              kind: s.kind,
              note: s.note ?? '',
              width: s.width,
              height: s.height,
            })),
          })),
          createdAt: iso(r.createdAt),
          changedAt: iso(r.updatedAt),
        })),
    )
  }

  extFields(q: V1ListQuery): Promise<V1Page<V1ExtField>> {
    return readPage(
      this.prisma,
      q,
      (tx, k, take) => tx.extField.findMany({ ...this.keyset(k), take }),
      byUpdated,
      (_tx, rows) =>
        rows.map((r) => ({
          id: r.id,
          owner: r.owner,
          key: r.key,
          name: r.name,
          type: r.type,
          options: [...r.options],
          description: r.description,
          section: r.section,
          enabled: r.enabled,
          sort: r.sort,
          createdAt: iso(r.createdAt),
          changedAt: iso(r.updatedAt),
        })),
    )
  }

  /* ---------------- 已删除对象（3.6 节） ---------------- */

  /** 快照里的删除记录与墓碑按（删除时间，对象 ID）归并后取一页 */
  deleted(q: V1ListQuery & { type?: DeletedType }): Promise<V1Page<V1Deleted>> {
    const snapTypes = SNAPSHOT_TYPES.filter((t) => !q.type || q.type === t)
    const tombTypes = TOMBSTONE_TYPES.filter((t) => !q.type || q.type === t)
    return readPage(
      this.prisma,
      q,
      async (tx, k, take) => {
        const [snaps, tombs] = await Promise.all([
          snapTypes.length
            ? tx.snapshot.findMany({
                where: {
                  AND: [
                    { action: 'delete', objectType: { in: [...snapTypes] } },
                    keysetWhere('createdAt', k, 'objectId'),
                  ],
                },
                orderBy: keysetOrder('createdAt', 'objectId'),
                take,
                select: { objectType: true, objectId: true, objectName: true, createdAt: true },
              })
            : [],
          tombTypes.length
            ? tx.tombstone.findMany({
                where: { AND: [{ type: { in: [...tombTypes] } }, keysetWhere('deletedAt', k, 'objectId')] },
                orderBy: keysetOrder('deletedAt', 'objectId'),
                take,
              })
            : [],
        ])
        const all: V1DeletedRow[] = [
          ...snaps.map((s) => ({ type: s.objectType, id: s.objectId, name: s.objectName, at: s.createdAt })),
          ...tombs.map((t) => ({ type: t.type, id: t.objectId, name: t.name, at: t.deletedAt })),
        ]
        return all
          .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .slice(0, take)
      },
      (r) => ({ t: r.at, id: r.id }),
      (_tx, rows) => rows.map((r) => ({ type: r.type, id: r.id, name: r.name, deletedAt: iso(r.at) })),
    )
  }

  private keyset(k: Keyset) {
    return { where: keysetWhere('updatedAt', k), orderBy: keysetOrder('updatedAt') }
  }
}

interface V1DeletedRow {
  type: DeletedType
  id: string
  name: string
  at: Date
}

const LANDMARK_INCLUDE = {
  category: REF,
  points: { orderBy: { sort: 'asc' as const }, select: { lng: true, lat: true, radius: true } },
} satisfies Prisma.LandmarkInclude

function landmarkOf(r: Prisma.LandmarkGetPayload<{ include: typeof LANDMARK_INCLUDE }>): V1Landmark {
  return {
    id: r.id,
    name: r.name,
    nameEn: r.nameEn,
    category: { id: r.category.id, name: r.category.name },
    points: r.points.map((p) => ({ lng: p.lng, lat: p.lat, radius: p.radius })),
    createdAt: iso(r.createdAt),
    changedAt: iso(r.updatedAt),
  }
}

function categoryOf(r: {
  id: string
  name: string
  icon: string
  defaultRadius: number
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}): V1LandmarkCategory {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    defaultRadius: r.defaultRadius,
    enabled: r.enabled,
    createdAt: iso(r.createdAt),
    changedAt: iso(r.updatedAt),
  }
}
