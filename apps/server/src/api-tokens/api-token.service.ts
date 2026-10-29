import { createHash, randomBytes } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { API_TOKEN_PREFIX, API_TOKEN_RE, type ApiTokenCreated, type ApiTokenItem } from '@gentransit/shared'
import { duplicate, notFound } from '../common/errors'
import { PrismaService } from '../prisma/prisma.service'

/** 最后使用时间每分钟最多写一次（沿用会话的做法） */
const TOUCH_INTERVAL_MS = 60_000

/** Token 熵足够（256 位），直接存 SHA-256，不加盐、不用会话密钥（默认决定 1） */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** 只认 Authorization: Bearer；不支持放在查询参数里，免得进入访问日志 */
export function bearerOf(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '')
  return m && API_TOKEN_RE.test(m[1]) ? m[1] : null
}

const toItem = (r: { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null }) => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
})

@Injectable()
export class ApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ApiTokenItem[]> {
    const rows = await this.prisma.apiToken.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    return rows.map(toItem)
  }

  /** 新建：明文只在返回里出现这一次 */
  async create(name: string): Promise<ApiTokenCreated> {
    if (await this.prisma.apiToken.findUnique({ where: { name } })) throw duplicate(`已有名为「${name}」的 Token`)
    const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    const row = await this.prisma.apiToken.create({
      data: { name, prefix: token.slice(0, 10), tokenHash: hashToken(token) },
    })
    return { ...toItem(row), token }
  }

  /** 吊销即删除记录，下一次请求就返回 401（默认决定 2） */
  async remove(id: string) {
    const n = await this.prisma.apiToken.deleteMany({ where: { id } })
    if (n.count === 0) throw notFound('API Token')
  }

  /** 校验请求头里的 Token，返回 Token ID；不加缓存 */
  async validate(authorization: string | undefined): Promise<string | null> {
    const token = bearerOf(authorization)
    if (!token) return null
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, lastUsedAt: true },
    })
    if (!row) return null
    const now = Date.now()
    if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
      await this.prisma.apiToken.updateMany({
        where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now - TOUCH_INTERVAL_MS) } }] },
        data: { lastUsedAt: new Date(now) },
      })
    return row.id
  }
}
