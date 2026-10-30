// 编辑器队列（需求 5.5.3，M5 计划 3.5）：进入编辑器时定下的站点顺序
import { Injectable } from '@nestjs/common'
import { QUEUE_MAX, type SignSetQueue, type SignSetQueueQuery } from '@gentransit/shared'
import { invalid } from '../common/errors'
import { PrismaService } from '../prisma/prisma.service'
import { SignSetService } from '../sign-sets/sign-set.service'
import { LineService } from './line.service'

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signSets: SignSetService,
    private readonly lines: LineService,
  ) {}

  async queue(q: SignSetQueueQuery): Promise<SignSetQueue> {
    if (q.from === 'line') {
      if (!q.lineId) throw invalid('缺少线路')
      // 先按站序处理各走向的待编排站，再处理留有失效编排的站；站点去重
      const a = await this.lines.arrangement(q.lineId)
      const ids = [
        ...a.routes.flatMap((r) => r.stops.filter((s) => s.status === 'waiting').map((s) => s.stopId)),
        ...a.invalid.map((s) => s.id),
      ]
      const all = [...new Set(ids)]
      return { stopIds: all.slice(0, QUEUE_MAX), total: all.length }
    }
    // 工作台：待处理最多的在前；列表：与列表相同的筛选和排序
    const { from: _from, lineId: _lineId, ...filter } = q
    const r = await this.signSets.ids(q.from === 'home' ? { ...filter, pending: true, sort: '-pending' } : filter)
    const setIds = r.items.slice(0, QUEUE_MAX).map((x) => x.id)
    const rows = await this.prisma.signSet.findMany({
      where: { id: { in: setIds } },
      select: { id: true, stopId: true },
    })
    const stopOf = new Map(rows.map((x) => [x.id, x.stopId]))
    return { stopIds: setIds.map((id) => stopOf.get(id)!).filter(Boolean), total: r.total }
  }
}
