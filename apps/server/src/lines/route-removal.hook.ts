import type { Tx } from '../prisma/prisma.service'

/**
 * 走向被删除（删除线路、修改模式删除走向）时的连带处理（M2 计划 3.3，M3 计划 3.5）。
 * 在删除走向的同一事务里调用：删除这些走向的编排，并给受影响的站牌集各存一份"连带修改"快照（BR-10）。
 * 实现见 SignSetRouteRemovalHook
 */
export interface RouteRemovalHook {
  onRoutesRemoved(tx: Tx, input: { routeIds: string[]; note: string }): Promise<void>
  /** 受影响的站牌集数，用于删除检查 */
  countAffected(routeIds: string[]): Promise<number>
  /** 受影响的站牌集数与编排数，用于停运、恢复、删除、改模式的确认弹窗 */
  affected(routeIds: string[]): Promise<{ signSets: number; schedules: number }>
}

export const ROUTE_REMOVAL_HOOK = Symbol('ROUTE_REMOVAL_HOOK')
