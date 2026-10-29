import { Injectable } from '@nestjs/common'
import type { RouteRemovalHook } from '../lines/route-removal.hook'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SnapshotService } from '../snapshots/snapshot.service'
import { SignSetService } from './sign-set.service'

/**
 * RouteRemovalHook 的 M3 实现（M3 计划 3.5 节）：删除这些走向上的编排，给受影响站牌集的 rev 加一
 * （已打开的编辑器保存时会收到冲突提示），并各存一份"连带修改"快照（BR-10）。
 * 停运、恢复不经过这里：编排保留，状态实时变为失效或恢复（BR-09）
 */
@Injectable()
export class SignSetRouteRemovalHook implements RouteRemovalHook {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signSets: SignSetService,
    private readonly snapshots: SnapshotService,
  ) {}

  async onRoutesRemoved(tx: Tx, { routeIds, note }: { routeIds: string[]; note: string }) {
    if (!routeIds.length) return
    const affected = await tx.schedule.findMany({
      where: { routeId: { in: routeIds } },
      distinct: ['signSetId'],
      select: { signSetId: true },
    })
    if (!affected.length) return
    await tx.schedule.deleteMany({ where: { routeId: { in: routeIds } } })
    const ids = affected.map((a) => a.signSetId)
    await tx.signSet.updateMany({ where: { id: { in: ids } }, data: { rev: { increment: 1 } } })
    const contents = await this.signSets.contents(tx, ids)
    for (const [id, content] of contents)
      await this.snapshots.record(tx, {
        type: 'signSet',
        id,
        name: content.stop.name,
        action: 'cascadeUpdate',
        note,
        content,
      })
  }

  async countAffected(routeIds: string[]) {
    return (await this.affected(routeIds)).signSets
  }

  async affected(routeIds: string[]) {
    if (!routeIds.length) return { signSets: 0, schedules: 0 }
    const [sets, schedules] = await Promise.all([
      this.prisma.schedule.findMany({
        where: { routeId: { in: routeIds } },
        distinct: ['signSetId'],
        select: { signSetId: true },
      }),
      this.prisma.schedule.count({ where: { routeId: { in: routeIds } } }),
    ])
    return { signSets: sets.length, schedules }
  }
}
