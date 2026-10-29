import { Injectable } from '@nestjs/common'
import type { SystemTotals } from '@gentransit/shared'
import { PrismaService } from '../prisma/prisma.service'

/** 工作台的总数：三张表各数一次，都走主键索引 */
@Injectable()
export class TotalsService {
  constructor(private readonly prisma: PrismaService) {}

  async totals(): Promise<SystemTotals> {
    const [stops, lines, boards] = await Promise.all([
      this.prisma.stop.count(),
      this.prisma.line.count(),
      this.prisma.board.count(),
    ])
    return { stops, lines, boards }
  }
}
