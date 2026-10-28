import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import {
  REGION_LEVEL_LABEL,
  regionCreateInput,
  renameInput,
  type Region,
  type RegionCreateInput,
  type RenameInput,
} from '@gentransit/shared'
import { duplicate, inUse, invalid, notFound } from '../common/errors'
import { regionReferrers } from '../common/referrers'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'

const COUNT = { cityStops: true, districtStops: true, streetStops: true, children: true } as const
const PARENT_LEVEL = { district: 'city', street: 'district' } as const

type Row = {
  id: string
  level: Region['level']
  parentId: string | null
  name: string
  _count?: Record<keyof typeof COUNT, number>
}
const toDto = (r: Row): Region => ({
  id: r.id,
  level: r.level,
  parentId: r.parentId,
  name: r.name,
  refCount: r._count ? Object.values(r._count).reduce((a, b) => a + b, 0) : 0,
})

@Injectable()
export class RegionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 全部区划（数量小），前端组装三级树 */
  async list(): Promise<Region[]> {
    const rows = await this.prisma.region.findMany({
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      include: { _count: { select: COUNT } },
    })
    return rows.map(toDto)
  }

  /** 名称在上级内唯一；市没有上级，单独检查 */
  private async assertUnique(parentId: string | null, name: string, exceptId?: string) {
    const dup = await this.prisma.region.findFirst({
      where: { parentId, name, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dup) throw duplicate(`同一上级下已有「${name}」`, { id: dup.id })
  }

  async create(input: RegionCreateInput): Promise<Region> {
    if (input.level !== 'city') {
      const parent = await this.prisma.region.findUnique({ where: { id: input.parentId! } })
      if (!parent) throw notFound('上级区划')
      if (parent.level !== PARENT_LEVEL[input.level])
        throw invalid(`${REGION_LEVEL_LABEL[input.level]}的上级必须是${REGION_LEVEL_LABEL[PARENT_LEVEL[input.level]]}`)
    }
    await this.assertUnique(input.parentId, input.name)
    return toDto(await this.prisma.region.create({ data: input }))
  }

  async rename(id: string, input: RenameInput): Promise<Region> {
    const cur = await this.prisma.region.findUnique({ where: { id } })
    if (!cur) throw notFound('区划')
    await this.assertUnique(cur.parentId, input.name, id)
    return toDto(
      await this.prisma.region.update({
        where: { id },
        data: { name: input.name },
        include: { _count: { select: COUNT } },
      }),
    )
  }

  async remove(id: string) {
    const cur = await this.prisma.region.findUnique({ where: { id } })
    if (!cur) throw notFound('区划')
    const refs = await regionReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.region.delete({ where: { id } })
  }
}

@Controller('api/regions')
export class RegionController {
  constructor(private readonly svc: RegionService) {}

  @Get()
  list() {
    return this.svc.list()
  }

  @Post()
  create(@Body(new ZodPipe(regionCreateInput)) body: RegionCreateInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  rename(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(renameInput)) body: RenameInput) {
    return this.svc.rename(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
