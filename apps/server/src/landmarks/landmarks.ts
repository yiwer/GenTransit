import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common'
import {
  landmarkCategoryInput,
  landmarkInput,
  roundCoord,
  type Landmark,
  type LandmarkCandidate,
  type LandmarkCategory,
  type LandmarkCategoryInput,
  type LandmarkInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { duplicate, inUse, notFound } from '../common/errors'
import { landmarkCategoryReferrers, landmarkReferrers } from '../common/referrers'
import { ZodPipe } from '../common/zod.pipe'
import { tombstone } from '../common/tombstone'
import { PrismaService, type Tx } from '../prisma/prisma.service'

const LM_INCLUDE = {
  category: { select: { id: true, name: true, enabled: true, icon: true } },
  points: { orderBy: { sort: 'asc' as const }, select: { id: true, lng: true, lat: true, radius: true } },
  _count: { select: { stops: true } },
}

@Injectable()
export class LandmarkService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------- 类别 ---------- */

  async categories(): Promise<LandmarkCategory[]> {
    const rows = await this.prisma.landmarkCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { landmarks: true } } },
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      defaultRadius: r.defaultRadius,
      enabled: r.enabled,
      landmarkCount: r._count.landmarks,
    }))
  }

  private async uniqueCategory(name: string, exceptId?: string) {
    if (await this.prisma.landmarkCategory.findFirst({ where: { name, NOT: exceptId ? { id: exceptId } : undefined } }))
      throw duplicate(`地标类别「${name}」已存在`)
  }

  async createCategory(input: LandmarkCategoryInput) {
    await this.uniqueCategory(input.name)
    const r = await this.prisma.landmarkCategory.create({ data: input })
    return { ...r, landmarkCount: 0 }
  }

  async updateCategory(id: string, input: LandmarkCategoryInput) {
    if (!(await this.prisma.landmarkCategory.findUnique({ where: { id } }))) throw notFound('地标类别')
    await this.uniqueCategory(input.name, id)
    await this.prisma.landmarkCategory.update({ where: { id }, data: input })
    return (await this.categories()).find((c) => c.id === id)!
  }

  async removeCategory(id: string) {
    const cur = await this.prisma.landmarkCategory.findUnique({ where: { id } })
    if (!cur) throw notFound('地标类别')
    const refs = await landmarkCategoryReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.$transaction([
      this.prisma.landmarkCategory.delete({ where: { id } }),
      tombstone(this.prisma, 'landmarkCategory', id, cur.name),
    ])
  }

  /* ---------- 地标 ---------- */

  private toDto(r: {
    id: string
    name: string
    nameEn: string
    category: Landmark['category']
    points: Landmark['points']
    _count: { stops: number }
  }): Landmark {
    return {
      id: r.id,
      name: r.name,
      nameEn: r.nameEn,
      category: r.category,
      points: r.points,
      stopCount: r._count.stops,
    }
  }

  async list(q: { q?: string; categoryId?: string }): Promise<Landmark[]> {
    const rows = await this.prisma.landmark.findMany({
      where: {
        categoryId: q.categoryId,
        OR: q.q
          ? [{ name: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }]
          : undefined,
      },
      orderBy: { name: 'asc' },
      include: LM_INCLUDE,
    })
    return rows.map((r) => this.toDto(r))
  }

  private async checkCategory(db: Tx, categoryId: string) {
    if (!(await db.landmarkCategory.findUnique({ where: { id: categoryId } }))) throw notFound('地标类别')
  }

  private points(input: LandmarkInput) {
    return input.points.map((p, i) => ({ lng: roundCoord(p.lng), lat: roundCoord(p.lat), radius: p.radius, sort: i }))
  }

  async create(input: LandmarkInput): Promise<Landmark> {
    await this.checkCategory(this.prisma, input.categoryId)
    const r = await this.prisma.landmark.create({
      data: {
        name: input.name,
        nameEn: input.nameEn,
        categoryId: input.categoryId,
        points: { create: this.points(input) },
      },
      include: LM_INCLUDE,
    })
    return this.toDto(r)
  }

  async update(id: string, input: LandmarkInput): Promise<Landmark> {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.landmark.findUnique({ where: { id } }))) throw notFound('地标')
      await this.checkCategory(tx, input.categoryId)
      await tx.landmarkPoint.deleteMany({ where: { landmarkId: id } })
      const r = await tx.landmark.update({
        where: { id },
        data: {
          name: input.name,
          nameEn: input.nameEn,
          categoryId: input.categoryId,
          points: { create: this.points(input) },
        },
        include: LM_INCLUDE,
      })
      return this.toDto(r)
    })
  }

  async remove(id: string) {
    const cur = await this.prisma.landmark.findUnique({ where: { id } })
    if (!cur) throw notFound('地标')
    const refs = await landmarkReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.$transaction([
      this.prisma.landmark.delete({ where: { id } }),
      tombstone(this.prisma, 'landmark', id, cur.name),
    ])
  }

  /**
   * 绑定候选：站点坐标落在地标任一位置点的辐射半径内；停用类别的地标不参与。
   * SQL 里用 haversine 计算球面距离（不引入 PostGIS），先用经纬度方框粗筛
   */
  async candidates(lng: number, lat: number): Promise<LandmarkCandidate[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; category: string; distance: number }[]>`
      SELECT l.id, l.name, c.name AS category, MIN(d.dist) AS distance
      FROM "LandmarkPoint" p
      JOIN "Landmark" l ON l.id = p."landmarkId"
      JOIN "LandmarkCategory" c ON c.id = l."categoryId"
      CROSS JOIN LATERAL (
        SELECT 2 * 6371008.8 * asin(sqrt(
          power(sin(radians(p.lat - ${lat}) / 2), 2) +
          cos(radians(${lat})) * cos(radians(p.lat)) * power(sin(radians(p.lng - ${lng}) / 2), 2)
        )) AS dist
      ) d
      WHERE c.enabled
        AND p.lat BETWEEN ${lat} - p.radius / 111000.0 AND ${lat} + p.radius / 111000.0
        AND d.dist <= p.radius
      GROUP BY l.id, l.name, c.name
      ORDER BY distance, l.name`
    return rows.map((r) => ({ ...r, distance: Math.round(Number(r.distance)) }))
  }
}

const listQuery = z.object({ q: z.string().trim().max(100).optional(), categoryId: z.uuid().optional() })
const pointQuery = z.object({ lng: z.coerce.number().min(-180).max(180), lat: z.coerce.number().min(-90).max(90) })

@Controller('api/landmark-categories')
export class LandmarkCategoryController {
  constructor(private readonly svc: LandmarkService) {}

  @Get()
  list() {
    return this.svc.categories()
  }

  @Post()
  create(@Body(new ZodPipe(landmarkCategoryInput)) body: LandmarkCategoryInput) {
    return this.svc.createCategory(body)
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(landmarkCategoryInput)) body: LandmarkCategoryInput,
  ) {
    return this.svc.updateCategory(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeCategory(id)
  }
}

@Controller('api/landmarks')
export class LandmarkController {
  constructor(private readonly svc: LandmarkService) {}

  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(q)
  }

  @Get('candidates')
  candidates(@Query(new ZodPipe(pointQuery)) q: z.infer<typeof pointQuery>) {
    return this.svc.candidates(q.lng, q.lat)
  }

  @Post()
  create(@Body(new ZodPipe(landmarkInput)) body: LandmarkInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(landmarkInput)) body: LandmarkInput) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
