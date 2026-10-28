import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ERROR_CODES } from '@gentransit/shared'
import type { Response } from 'express'
import { IS_PUBLIC, type AuthedRequest } from '../common/decorators'
import { AppError } from '../common/errors'
import { AuthService, SESSION_COOKIE } from './auth.service'
import { setSessionCookie } from './cookie'

/** 全局登录守卫：白名单只有 @Public() 的接口（登录、健康检查）；前端静态资源不经过 Nest 路由 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE]
    const s = await this.auth.validate(token)
    if (!s) throw new AppError(401, ERROR_CODES.unauthorized, '请先登录')
    req.session = { id: s.id, accountId: s.accountId, username: s.username }
    if (s.refreshed && token) setSessionCookie(req, ctx.switchToHttp().getResponse<Response>(), token)
    return true
  }
}
