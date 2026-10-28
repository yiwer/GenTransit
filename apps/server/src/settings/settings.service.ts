import { Injectable } from '@nestjs/common'
import {
  DIRECTIONS,
  ERROR_CODES,
  stopLabel,
  type ExtFieldCreateInput,
  type ExtFieldDef,
  type ExtFieldUpdateInput,
  type ExtOwner,
  type LandmarkSettingsInput,
  type OrientationMode,
  type Settings,
} from '@gentransit/shared'
import { AppError, duplicate, invalid, notFound } from '../common/errors'
import { PrismaService, type Tx } from '../prisma/prisma.service'

const EXT_TABLE: Record<ExtOwner, string> = { stop: 'Stop', line: 'Line', routeStop: 'RouteStop' }

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(db: Tx = this.prisma): Promise<Settings> {
    const s = await db.setting.findUniqueOrThrow({ where: { id: 1 } })
    return { orientationMode: s.orientationMode, landmarkLimit: s.landmarkLimit, autoMatch: s.autoMatch }
  }

  /**
   * 方位模式切换（BR-13）：方位 → 编码随时可切，原值作为文本保留；
   * 编码 → 方位仅当全部站点的值都属于六个方位时允许，否则列出不符合的站点（AC-14）
   */
  async setOrientation(mode: OrientationMode): Promise<Settings> {
    if (mode === 'orientation') {
      const where = { direction: { notIn: [...DIRECTIONS] } }
      const [bad, total] = await Promise.all([
        this.prisma.stop.findMany({
          where,
          select: { id: true, name: true, direction: true },
          orderBy: [{ name: 'asc' }, { direction: 'asc' }],
          take: 100,
        }),
        this.prisma.stop.count({ where }),
      ])
      if (total > 0) {
        throw new AppError(
          409,
          ERROR_CODES.orientationIncompatible,
          `有 ${total} 个站点的编码不是东、南、西、北、无、场站之一，不能切回方位模式`,
          { stops: bad.map((s) => ({ ...s, label: stopLabel(s) })), total },
        )
      }
    }
    await this.prisma.setting.update({ where: { id: 1 }, data: { orientationMode: mode } })
    return this.get()
  }

  async setLandmarks(input: LandmarkSettingsInput): Promise<Settings> {
    await this.prisma.setting.update({ where: { id: 1 }, data: input })
    return this.get()
  }

  /* ---------- 扩展字段 ---------- */

  /** 某个键在归属对象里是否已有取值（有值后类型锁定） */
  async hasValues(owner: ExtOwner, key: string, db: Tx = this.prisma): Promise<boolean> {
    const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM "${EXT_TABLE[owner]}" WHERE (ext ->> $1) IS NOT NULL) AS "exists"`,
      key,
    )
    return rows[0]?.exists ?? false
  }

  private async toDto(
    r: Omit<ExtFieldDef, 'hasValues'> & { createdAt?: Date; updatedAt?: Date },
  ): Promise<ExtFieldDef> {
    return {
      id: r.id,
      owner: r.owner,
      key: r.key,
      name: r.name,
      type: r.type,
      options: r.options,
      description: r.description,
      section: r.section,
      enabled: r.enabled,
      sort: r.sort,
      hasValues: await this.hasValues(r.owner, r.key),
    }
  }

  async listExt(owner?: ExtOwner): Promise<ExtFieldDef[]> {
    const rows = await this.prisma.extField.findMany({
      where: owner ? { owner } : undefined,
      orderBy: [{ owner: 'asc' }, { sort: 'asc' }, { createdAt: 'asc' }],
    })
    return Promise.all(rows.map((r) => this.toDto(r)))
  }

  /** 站点字段才有显示分区，默认放在"其他" */
  private section(owner: ExtOwner, section: ExtFieldCreateInput['section']) {
    return owner === 'stop' ? (section ?? 'other') : null
  }

  async createExt(input: ExtFieldCreateInput): Promise<ExtFieldDef> {
    if (await this.prisma.extField.findFirst({ where: { owner: input.owner, key: input.key } }))
      throw duplicate(`键「${input.key}」已存在`)
    if (await this.prisma.extField.findFirst({ where: { owner: input.owner, name: input.name } }))
      throw duplicate(`字段名「${input.name}」已存在`)
    const max = await this.prisma.extField.aggregate({ where: { owner: input.owner }, _max: { sort: true } })
    const r = await this.prisma.extField.create({
      data: {
        ...input,
        options: input.type === 'select' ? input.options : [],
        section: this.section(input.owner, input.section),
        sort: (max._max.sort ?? -1) + 1,
      },
    })
    return this.toDto(r)
  }

  /** 键不可改；字段已有值后类型不可改；只能停用，不能删除 */
  async updateExt(id: string, input: ExtFieldUpdateInput): Promise<ExtFieldDef> {
    const cur = await this.prisma.extField.findUnique({ where: { id } })
    if (!cur) throw notFound('扩展字段')
    if (await this.prisma.extField.findFirst({ where: { owner: cur.owner, name: input.name, NOT: { id } } }))
      throw duplicate(`字段名「${input.name}」已存在`)
    if (input.type !== cur.type && (await this.hasValues(cur.owner, cur.key)))
      throw new AppError(409, ERROR_CODES.extTypeLocked, `「${cur.name}」已有取值，类型不能再修改`)
    const r = await this.prisma.extField.update({
      where: { id },
      data: {
        ...input,
        options: input.type === 'select' ? input.options : [],
        section: this.section(cur.owner, input.section),
      },
    })
    return this.toDto(r)
  }

  async reorderExt(ids: string[]): Promise<ExtFieldDef[]> {
    const rows = await this.prisma.extField.findMany({ where: { id: { in: ids } }, select: { id: true, owner: true } })
    if (rows.length !== ids.length || new Set(rows.map((r) => r.owner)).size !== 1) throw invalid('排序列表不合法')
    await this.prisma.$transaction(
      ids.map((id, i) => this.prisma.extField.update({ where: { id }, data: { sort: i } })),
    )
    return this.listExt(rows[0].owner)
  }
}
