// 站架类型（M7 计划 3.4 节）：结构形式 + 参数；被站架或站架模板引用时不能删除（BR-12）。
// 改名称、形式、参数只影响展示，不给引用方站牌集生成快照（BR-23）
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common'
import { parseShelfSpec, shelfTypeInput, type ShelfTypeInput, type ShelfTypeItem } from '@gentransit/shared'
import { duplicate, inUse, notFound } from '../common/errors'
import { shelfTypeReferrers } from '../common/referrers'
import { tombstone } from '../common/tombstone'
import { ZodPipe } from '../common/zod.pipe'
import type { Prisma, ShelfType } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'

const COUNT = { _count: { select: { shelves: true, templates: true } } } as const
type Row = ShelfType & { _count?: { shelves: number; templates: number } }

const toDto = (r: Row): ShelfTypeItem => {
  const spec = parseShelfSpec(r.form, r.params)
  return {
    id: r.id,
    name: r.name,
    form: spec.form,
    params: spec.params,
    desc: r.desc,
    needsReview: r.needsReview,
    shelfCount: r._count?.shelves ?? 0,
    templateCount: r._count?.templates ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }
}

const dataOf = (input: ShelfTypeInput) => ({
  name: input.name,
  desc: input.desc,
  form: input.form,
  params: input.params as unknown as Prisma.InputJsonValue,
})

@Injectable()
export class ShelfTypeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 全部站架类型（数量小），按名称拼音序 */
  async list(): Promise<ShelfTypeItem[]> {
    const rows = await this.prisma.shelfType.findMany({ orderBy: { name: 'asc' }, include: COUNT })
    return rows.map(toDto)
  }

  private async assertUnique(name: string, exceptId?: string) {
    const dup = await this.prisma.shelfType.findFirst({ where: { name, NOT: exceptId ? { id: exceptId } : undefined } })
    if (dup) throw duplicate(`站架类型「${name}」已存在`, { id: dup.id })
  }

  async create(input: ShelfTypeInput): Promise<ShelfTypeItem> {
    await this.assertUnique(input.name)
    return toDto(await this.prisma.shelfType.create({ data: dataOf(input), include: COUNT }))
  }

  /** 保存一次即清除"待核对" */
  async update(id: string, input: ShelfTypeInput): Promise<ShelfTypeItem> {
    if (!(await this.prisma.shelfType.findUnique({ where: { id } }))) throw notFound('站架类型')
    await this.assertUnique(input.name, id)
    return toDto(
      await this.prisma.shelfType.update({
        where: { id },
        data: { ...dataOf(input), needsReview: false },
        include: COUNT,
      }),
    )
  }

  async remove(id: string) {
    const cur = await this.prisma.shelfType.findUnique({ where: { id } })
    if (!cur) throw notFound('站架类型')
    const refs = await shelfTypeReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.$transaction([
      this.prisma.shelfType.delete({ where: { id } }),
      tombstone(this.prisma, 'shelfType', id, cur.name),
    ])
  }
}

@Controller('api/shelf-types')
export class ShelfTypeController {
  constructor(private readonly svc: ShelfTypeService) {}

  @Get()
  list() {
    return this.svc.list()
  }

  @Post()
  create(@Body(new ZodPipe(shelfTypeInput)) body: ShelfTypeInput) {
    return this.svc.create(body)
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shelfTypeInput)) body: ShelfTypeInput) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
