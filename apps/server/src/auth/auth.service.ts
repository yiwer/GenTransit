import { createHmac, randomBytes } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { hash, verify } from '@node-rs/argon2'
import { ERROR_CODES } from '@gentransit/shared'
import { AppError } from '../common/errors'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'

export const SESSION_COOKIE = 'gt_sid'
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000
const MAX_FAILURES = 5
const LOCK_MS = 15 * 60 * 1000
/** 会话最后访问时间的刷新间隔（滑动过期），避免每个请求都写库 */
const TOUCH_INTERVAL_MS = 60 * 1000

export interface ValidSession {
  id: string
  accountId: string
  username: string
  /** 本次请求刷新了过期时间，需要重发 Cookie */
  refreshed: boolean
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth')

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** 令牌只在 Cookie 里，库里存 HMAC 哈希 */
  hashToken(token: string) {
    return createHmac('sha256', this.env.SESSION_SECRET).update(token).digest('hex')
  }

  /** 首次启动：库里还没有账号时用 GT_ADMIN_USERNAME / GT_ADMIN_PASSWORD 创建；之后这两个变量不再生效 */
  async ensureInitialAccount() {
    if ((await this.prisma.account.count()) > 0) return
    const { GT_ADMIN_USERNAME: username, GT_ADMIN_PASSWORD: password } = this.env
    if (!username || !password) {
      throw new Error('数据库里还没有账号：请设置 GT_ADMIN_USERNAME 与 GT_ADMIN_PASSWORD 后重新启动')
    }
    await this.prisma.account.create({ data: { username, passwordHash: await hash(password) } })
    this.logger.log(`已创建初始账号 ${username}`)
  }

  async login(username: string, password: string) {
    const acc = await this.prisma.account.findFirst()
    if (!acc) throw new AppError(401, ERROR_CODES.authInvalid, '用户名或密码错误')
    const now = new Date()
    if (acc.lockedUntil && acc.lockedUntil > now) throw this.locked(acc.lockedUntil)

    const ok = acc.username === username && (await verify(acc.passwordHash, password))
    if (!ok) {
      // 锁定期已过的旧计数不再累计
      const failed = (acc.lockedUntil ? 0 : acc.failedCount) + 1
      const lock = failed >= MAX_FAILURES
      await this.prisma.account.update({
        where: { id: acc.id },
        data: {
          failedCount: lock ? MAX_FAILURES : failed,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MS) : null,
        },
      })
      const left = MAX_FAILURES - failed
      throw new AppError(
        401,
        ERROR_CODES.authInvalid,
        lock
          ? `用户名或密码错误。已连续失败 ${MAX_FAILURES} 次，15 分钟内不能登录`
          : `用户名或密码错误，还可以再试 ${left} 次`,
        { remaining: Math.max(0, left) },
      )
    }

    await this.prisma.account.update({ where: { id: acc.id }, data: { failedCount: 0, lockedUntil: null } })
    const token = randomBytes(32).toString('base64url')
    await this.prisma.session.create({
      data: {
        accountId: acc.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        lastSeenAt: now,
      },
    })
    return { token, username: acc.username }
  }

  private locked(until: Date) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000))
    return new AppError(429, ERROR_CODES.authLocked, `连续登录失败次数过多，请 ${minutes} 分钟后再试`, {
      lockedUntil: until.toISOString(),
    })
  }

  /** 校验会话并滑动续期 */
  async validate(token: string | undefined): Promise<ValidSession | null> {
    if (!token) return null
    const s = await this.prisma.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { account: { select: { username: true } } },
    })
    const now = Date.now()
    if (!s) return null
    if (s.expiresAt.getTime() <= now) {
      await this.prisma.session.delete({ where: { id: s.id } }).catch(() => undefined)
      return null
    }
    let refreshed = false
    if (now - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: s.id },
        data: { lastSeenAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) },
      })
      refreshed = true
    }
    return { id: s.id, accountId: s.accountId, username: s.account.username, refreshed }
  }

  async logout(sessionId: string) {
    await this.prisma.session.deleteMany({ where: { id: sessionId } })
  }

  /** 修改密码：需原密码；成功后注销其他会话 */
  async changePassword(session: { id: string; accountId: string }, oldPassword: string, newPassword: string) {
    const acc = await this.prisma.account.findUniqueOrThrow({ where: { id: session.accountId } })
    if (!(await verify(acc.passwordHash, oldPassword))) {
      throw new AppError(400, ERROR_CODES.validation, '原密码不正确', {
        issues: [{ path: 'oldPassword', message: '原密码不正确' }],
      })
    }
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: acc.id }, data: { passwordHash: await hash(newPassword) } }),
      this.prisma.session.deleteMany({ where: { accountId: acc.id, id: { not: session.id } } }),
    ])
  }
}
