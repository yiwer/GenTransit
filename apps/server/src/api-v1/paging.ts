import { z } from 'zod'
import type { V1ListQuery, V1Page } from '@gentransit/shared'
import { invalid } from '../common/errors'
import type { PrismaService, Tx } from '../prisma/prisma.service'

/**
 * 只读 API 的游标分页与水位（M4 计划 3.3 节）。
 * 排序固定按（changedAt，id）升序；游标是 base64url 的 { 水位, 最后一项的 changedAt, 最后一项的 id }
 */

const cursorSchema = z.object({ w: z.number().int(), t: z.number().int(), id: z.uuid() })
export type Cursor = z.infer<typeof cursorSchema>

export const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url')

export function decodeCursor(s: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(s, 'base64url').toString('utf8')))
  } catch {
    throw invalid('cursor：游标不合法，请从第一页重新开始')
  }
}

/** 时钟误差容忍：水位再往前 5 秒 */
const SKEW_MS = 5000

/**
 * 本轮水位 = min(当前时间, 进行中的写事务最早开始时间) − 5 秒。
 * 导入等长事务里对象的修改时间早于提交时间，只取当前时间会让下一轮漏掉它们。
 * 要作为事务里的第一条查询执行，和本页数据处在同一个快照
 */
export async function watermark(db: Tx): Promise<Date> {
  const [row] = await db.$queryRaw<{ ms: number }[]>`
    SELECT (extract(epoch FROM least(now(), coalesce(min(xact_start), now()))) * 1000)::float8 AS ms
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND backend_type = 'client backend'
      AND backend_xid IS NOT NULL
      AND pid <> pg_backend_pid()`
  return new Date(Math.floor(row.ms) - SKEW_MS)
}

/** 本页的筛选条件：updatedSince 之后、游标之后 */
export interface Keyset {
  since?: Date
  after?: { t: Date; id: string }
}

/** Prisma 的 where：（时间列，ID 列）按键集翻页 */
export function keysetWhere<F extends string, I extends string = 'id'>(field: F, k: Keyset, idField = 'id' as I) {
  const and: Record<string, unknown>[] = []
  if (k.since) and.push({ [field]: { gt: k.since } })
  if (k.after) and.push({ OR: [{ [field]: { gt: k.after.t } }, { [field]: k.after.t, [idField]: { gt: k.after.id } }] })
  return { AND: and }
}

export const keysetOrder = <F extends string, I extends string = 'id'>(field: F, idField = 'id' as I) => [
  { [field]: 'asc' as const },
  { [idField]: 'asc' as const },
]

/**
 * 读一页：同一个只读的 REPEATABLE READ 事务里读出，保证结构与状态一致。
 * load 返回最多 take 条（take = limit + 1，多出的一条只用来判断是否还有下一页）
 */
export async function readPage<R, T>(
  prisma: PrismaService,
  q: V1ListQuery,
  load: (tx: Tx, k: Keyset, take: number) => Promise<R[]>,
  keyOf: (r: R) => { t: Date; id: string },
  map: (tx: Tx, rows: R[]) => Promise<T[]> | T[],
): Promise<V1Page<T>> {
  const c = q.cursor ? decodeCursor(q.cursor) : null
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      const w = c ? new Date(c.w) : await watermark(tx)
      const rows = await load(
        tx,
        {
          since: q.updatedSince ? new Date(q.updatedSince) : undefined,
          after: c ? { t: new Date(c.t), id: c.id } : undefined,
        },
        q.limit + 1,
      )
      const page = rows.slice(0, q.limit)
      const items = await map(tx, page)
      const last = page.at(-1)
      const key = last && keyOf(last)
      return {
        items,
        nextCursor:
          rows.length > q.limit && key ? encodeCursor({ w: w.getTime(), t: key.t.getTime(), id: key.id }) : null,
        nextUpdatedSince: w.toISOString(),
      }
    },
    { isolationLevel: 'RepeatableRead', timeout: 60_000, maxWait: 10_000 },
  )
}

/** 单个对象也在只读事务里读 */
export function readOne<T>(prisma: PrismaService, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      return fn(tx)
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000, maxWait: 10_000 },
  )
}
