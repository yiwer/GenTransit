import type { TombstoneType } from '../generated/prisma/client'
import type { PrismaService, Tx } from '../prisma/prisma.service'

/**
 * 没有快照的对象（地标、地标类别、字典项、行政区划、公交公司、站架模板）删除时，
 * 在同一事务里记一条墓碑，供只读 API 的"已删除对象"使用（M4 计划 3.6 节）
 */
export const tombstone = (db: PrismaService | Tx, type: TombstoneType, objectId: string, name: string) =>
  db.tombstone.create({ data: { type, objectId, name } })
