import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  STOP_NORMALIZE,
  compareText,
  type DeletedItem,
  type NormalizeOptions,
  type ObjectType,
  type Page,
  type SnapshotAction,
  type SnapshotItem,
} from '@gentransit/shared'
import type { Prisma } from '../generated/prisma/client'
import { PrismaService, type Tx } from '../prisma/prisma.service'

const NORMALIZE: Record<ObjectType, NormalizeOptions> = {
  stop: STOP_NORMALIZE,
  line: {},
  signSet: {},
}

/** 只有"修改"类动作做有效修改判定；新增、删除总是记录 */
const CHECKED: SnapshotAction[] = ['update', 'importUpdate', 'cascadeUpdate']

export interface RecordInput {
  type: ObjectType
  id: string
  name: string
  action: SnapshotAction
  content: unknown
  note?: string
  /** 由上一份快照内容生成说明（例如"修改：备注、座椅数"） */
  noteFrom?: (prev: unknown) => string
}

/** 比较哈希：规范化内容的 SHA-256 */
export function compareHash(type: ObjectType, content: unknown) {
  return createHash('sha256').update(compareText(content, NORMALIZE[type])).digest('hex')
}

@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  private last(tx: Tx, type: ObjectType, id: string) {
    return tx.snapshot.findFirst({
      where: { objectType: type, objectId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { compareHash: true, content: true },
    })
  }

  /**
   * 与业务写入在同一个事务里记录快照。
   * 修改类动作：新哈希等于该对象最后一份快照的哈希时不写入，返回 written=false（调用方据此回滚业务写入）。
   */
  async record(tx: Tx, input: RecordInput): Promise<{ written: boolean }> {
    const hash = compareHash(input.type, input.content)
    const prev = await this.last(tx, input.type, input.id)
    if (CHECKED.includes(input.action) && prev?.compareHash === hash) return { written: false }
    await tx.snapshot.create({
      data: {
        objectType: input.type,
        objectId: input.id,
        objectName: input.name,
        action: input.action,
        note: input.note ?? (input.noteFrom && prev ? input.noteFrom(prev.content) : ''),
        content: input.content as Prisma.InputJsonValue,
        compareHash: hash,
      },
    })
    return { written: true }
  }

  async count(type: ObjectType, id: string) {
    return this.prisma.snapshot.count({ where: { objectType: type, objectId: id } })
  }

  /** 修改历史时间线（倒序，含完整内容，前端按相邻两份计算差异） */
  async timeline(type: ObjectType, id: string): Promise<SnapshotItem[]> {
    const rows = await this.prisma.snapshot.findMany({
      where: { objectType: type, objectId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    return rows.map((r) => ({
      id: r.id,
      objectType: r.objectType,
      objectId: r.objectId,
      objectName: r.objectName,
      action: r.action,
      note: r.note,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /** "已删除"视图（F-COM-09）：直接查动作为"删除"的快照 */
  async deleted(type: ObjectType, page: number, size: number): Promise<Page<DeletedItem>> {
    const where = { objectType: type, action: 'delete' as const }
    const [total, rows] = await Promise.all([
      this.prisma.snapshot.count({ where }),
      this.prisma.snapshot.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * size,
        take: size,
        select: { objectId: true, objectName: true, createdAt: true },
      }),
    ])
    const counts = await this.prisma.snapshot.groupBy({
      by: ['objectId'],
      where: { objectType: type, objectId: { in: rows.map((r) => r.objectId) } },
      _count: { _all: true },
    })
    const countOf = new Map(counts.map((c) => [c.objectId, c._count._all]))
    return {
      items: rows.map((r) => ({
        objectId: r.objectId,
        objectName: r.objectName,
        deletedAt: r.createdAt.toISOString(),
        snapshotCount: countOf.get(r.objectId) ?? 0,
      })),
      total,
      page,
      size,
    }
  }
}
