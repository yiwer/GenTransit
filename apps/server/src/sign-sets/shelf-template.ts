// 站架模板（需求 5.7，M3 计划 4.5）：基础数据里的一个页签；结构整块存 JSONB，随时可删除（BR-14）
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { shelfTemplateInput, type ShelfTemplate, type ShelfTemplateInput, type TemplateBoard } from '@gentransit/shared'
import { duplicate, invalid, notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { tombstone } from '../common/tombstone'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { UploadService } from '../uploads/upload.service'

const INCLUDE = { type: { select: { id: true, name: true } }, image: true } as const
type Row = Prisma.ShelfTemplateGetPayload<{ include: typeof INCLUDE }>

@Injectable()
export class ShelfTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadService,
  ) {}

  private toDto(r: Row): ShelfTemplate {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      desc: r.desc,
      noPhysical: r.noPhysical,
      image: r.image ? this.uploads.toDto(r.image) : null,
      boards: r.boards as unknown as TemplateBoard[],
      updatedAt: r.updatedAt.toISOString(),
    }
  }

  /** 按站架类型、名称（拼音序）排列；前端按站架类型分组 */
  async list(): Promise<ShelfTemplate[]> {
    const rows = await this.prisma.shelfTemplate.findMany({
      orderBy: [{ type: { name: 'asc' } }, { name: 'asc' }],
      include: INCLUDE,
    })
    return rows.map((r) => this.toDto(r))
  }

  private async check(input: ShelfTemplateInput, exceptId?: string) {
    const type = await this.prisma.dictItem.findUnique({ where: { id: input.typeId } })
    if (type?.category !== 'shelfType') throw invalid('站架类型不存在')
    if (input.imageId && !(await this.prisma.upload.findUnique({ where: { id: input.imageId } })))
      throw invalid('示意图不存在')
    const dup = await this.prisma.shelfTemplate.findFirst({
      where: { typeId: input.typeId, name: input.name, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dup) throw duplicate(`${type.name}已有名为「${input.name}」的模板`, { id: dup.id })
  }

  private data(input: ShelfTemplateInput) {
    return {
      name: input.name,
      typeId: input.typeId,
      desc: input.desc,
      noPhysical: input.noPhysical,
      imageId: input.imageId,
      boards: input.boards as unknown as Prisma.InputJsonValue,
    }
  }

  async create(input: ShelfTemplateInput): Promise<ShelfTemplate> {
    await this.check(input)
    return this.toDto(await this.prisma.shelfTemplate.create({ data: this.data(input), include: INCLUDE }))
  }

  async update(id: string, input: ShelfTemplateInput): Promise<ShelfTemplate> {
    if (!(await this.prisma.shelfTemplate.findUnique({ where: { id } }))) throw notFound('站架模板')
    await this.check(input, id)
    return this.toDto(
      await this.prisma.shelfTemplate.update({ where: { id }, data: this.data(input), include: INCLUDE }),
    )
  }

  /** 随时可删：已生成的站架不受影响 */
  async remove(id: string) {
    const cur = await this.prisma.shelfTemplate.findUnique({ where: { id } })
    if (!cur) throw notFound('站架模板')
    await this.prisma.$transaction([
      this.prisma.shelfTemplate.delete({ where: { id } }),
      tombstone(this.prisma, 'shelfTemplate', id, cur.name),
    ])
  }
}

@Controller('api/shelf-templates')
export class ShelfTemplateController {
  constructor(private readonly svc: ShelfTemplateService) {}

  @Get()
  list() {
    return this.svc.list()
  }

  @Post()
  create(@Body(new ZodPipe(shelfTemplateInput)) body: ShelfTemplateInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(shelfTemplateInput)) body: ShelfTemplateInput) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
