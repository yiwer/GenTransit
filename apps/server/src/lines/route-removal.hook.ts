import { Injectable } from '@nestjs/common'
import type { Tx } from '../prisma/prisma.service'

/**
 * 走向被删除（删除线路、修改模式删除走向）时的连带处理，预留给 M3（M2 计划 3.3）。
 * 在删除走向的同一事务里调用。M3 的实现：删除这些走向的编排，并给受影响的站牌集
 * 各存一份"连带修改"快照（BR-10）。
 */
export interface RouteRemovalHook {
  onRoutesRemoved(tx: Tx, input: { routeIds: string[]; note: string }): Promise<void>
  /** 受影响的站牌集数，用于删除与改模式的确认弹窗 */
  countAffected(routeIds: string[]): Promise<number>
}

export const ROUTE_REMOVAL_HOOK = Symbol('ROUTE_REMOVAL_HOOK')

/** M2 还没有编排表：空操作 */
@Injectable()
export class NoopRouteRemovalHook implements RouteRemovalHook {
  async onRoutesRemoved(): Promise<void> {}

  async countAffected(): Promise<number> {
    return 0
  }
}
