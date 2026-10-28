import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common'
import { companyInput, type BusCompany, type CompanyInput } from '@gentransit/shared'
import { duplicate, inUse, notFound } from '../common/errors'
import { companyReferrers } from '../common/referrers'
import { ZodPipe } from '../common/zod.pipe'
import { PrismaService } from '../prisma/prisma.service'
import { UploadService } from '../uploads/upload.service'

const INCLUDE = { logo: true, _count: { select: { lines: true } } } as const

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadService,
  ) {}

  private toDto(r: {
    id: string
    name: string
    nameEn: string
    shortName: string
    hotline: string
    logo: Parameters<UploadService['toDto']>[0] | null
    _count: { lines: number }
  }): BusCompany {
    return {
      id: r.id,
      name: r.name,
      nameEn: r.nameEn,
      shortName: r.shortName,
      hotline: r.hotline,
      logo: r.logo ? this.uploads.toDto(r.logo) : null,
      lineCount: r._count.lines,
    }
  }

  async list(): Promise<BusCompany[]> {
    const rows = await this.prisma.busCompany.findMany({ orderBy: { name: 'asc' }, include: INCLUDE })
    return rows.map((r) => this.toDto(r))
  }

  private async check(input: CompanyInput, exceptId?: string) {
    const dup = await this.prisma.busCompany.findFirst({
      where: { name: input.name, NOT: exceptId ? { id: exceptId } : undefined },
    })
    if (dup) throw duplicate(`公交公司「${input.name}」已存在`, { id: dup.id })
    if (input.logoId && !(await this.prisma.upload.findUnique({ where: { id: input.logoId } })))
      throw notFound('logo 文件')
  }

  async create(input: CompanyInput): Promise<BusCompany> {
    await this.check(input)
    return this.toDto(await this.prisma.busCompany.create({ data: input, include: INCLUDE }))
  }

  async update(id: string, input: CompanyInput): Promise<BusCompany> {
    if (!(await this.prisma.busCompany.findUnique({ where: { id } }))) throw notFound('公交公司')
    await this.check(input, id)
    return this.toDto(await this.prisma.busCompany.update({ where: { id }, data: input, include: INCLUDE }))
  }

  async remove(id: string) {
    const cur = await this.prisma.busCompany.findUnique({ where: { id } })
    if (!cur) throw notFound('公交公司')
    const refs = await companyReferrers(this.prisma, id)
    if (refs.total > 0) throw inUse(cur.name, refs.referrers, refs.total)
    await this.prisma.busCompany.delete({ where: { id } })
  }
}

@Controller('api/companies')
export class CompanyController {
  constructor(private readonly svc: CompanyService) {}

  @Get()
  list() {
    return this.svc.list()
  }

  @Post()
  create(@Body(new ZodPipe(companyInput)) body: CompanyInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(companyInput)) body: CompanyInput) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
