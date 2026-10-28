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
  DICT_CATEGORIES,
  DICT_CATEGORY_LABEL,
  dictCreateInput,
  renameInput,
  type DictCreateInput,
  type DictItem,
  type RenameInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { duplicate, inUse, notFound } from '../common/errors'
import { dictReferrers } from '../common/referrers'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'

const COUNT = {
  roadStops: true,
  platformTypeStops: true,
  safetyStops: true,
  shelterTypeStops: true,
  maintainerStops: true,
  fareSystemLines: true,
} as const

type Row = { id: string; category: DictItem['category']; name: string; _count?: Record<keyof typeof COUNT, number> }

const toDto = (r: Row): DictItem => ({
  id: r.id,
  category: r.category,
  name: r.name,
  refCount: r._count ? Object.values(r._count).reduce((a, b) => a + b, 0) : 0,
})

@Injectable()
export class DictService {
  constructor(private readonly prisma: PrismaService) {}

  /** 同类内按名称拼音序（列排序规则 zh-x-icu） */
  async list(category?: DictItem['category']): Promise<DictItem[]> {
    const rows = await this.prisma.dictItem.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: COUNT } },
    })
    return rows.map(toDto)
  }

  private async assertUnique(category: DictItem['category'], name: string, exceptId?: string) {
    const dup = await this.prisma.dictItem.findFirst({
      where: { category, name, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dup) throw duplicate(`${DICT_CATEGORY_LABEL[category]}「${name}」已存在`, { id: dup.id })
  }

  async create(input: DictCreateInput): Promise<DictItem> {
    await this.assertUnique(input.category, input.name)
    return toDto(await this.prisma.dictItem.create({ data: input }))
  }

  /** 改名：所有引用处显示新名称（引用按 ID），不给引用方生成快照 */
  async rename(id: string, input: RenameInput): Promise<DictItem> {
    const cur = await this.prisma.dictItem.findUnique({ where: { id } })
    if (!cur) throw notFound('字典项')
    await this.assertUnique(cur.category, input.name, id)
    const r = await this.prisma.dictItem.update({
      where: { id },
      data: { name: input.name },
      include: { _count: { select: COUNT } },
    })
    return toDto(r)
  }

  async remove(id: string) {
    const cur = await this.prisma.dictItem.findUnique({ where: { id } })
    if (!cur) throw notFound('字典项')
    const refs = await dictReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.dictItem.delete({ where: { id } })
  }
}

const listQuery = z.object({ category: z.enum(DICT_CATEGORIES).optional() })

@Controller('api/dicts')
export class DictController {
  constructor(private readonly svc: DictService) {}

  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(q.category)
  }

  @Post()
  create(@Body(new ZodPipe(dictCreateInput)) body: DictCreateInput) {
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
