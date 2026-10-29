import { Injectable } from '@nestjs/common'
import { touchedStops, type ObjectType, type SnapshotAction } from '@gentransit/shared'
import type { Tx } from '../prisma/prisma.service'

/**
 * 站牌集的"有变化"时间（M4 计划 3.5 节），在写入快照的同一事务里更新：
 * 1. 站牌集自身有快照写入（编辑器保存、连带修改）；
 * 2. 线路有快照写入且编排投影变了：只更新途经集合变了的站点；停运、恢复时更新前后出现过的全部站点。
 * 原生 SQL 写时间用 now() AT TIME ZONE 'UTC'（3.4 节）；不碰 rev 与 updatedAt，不影响已打开的编辑器
 */
@Injectable()
export class ChangeClock {
  async afterRecord(
    tx: Tx,
    input: { type: ObjectType; id: string; action: SnapshotAction; content: unknown },
    prev: unknown,
  ) {
    if (input.type === 'signSet' && input.action !== 'delete')
      await tx.$executeRaw`UPDATE "SignSet" SET "changedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${input.id}::uuid`
    if (input.type === 'line') {
      const stops = touchedStops(prev ?? null, input.action === 'delete' ? null : input.content)
      if (stops.length)
        await tx.$executeRaw`UPDATE "SignSet" SET "changedAt" = now() AT TIME ZONE 'UTC' WHERE "stopId" = ANY(${stops}::uuid[])`
    }
  }
}
