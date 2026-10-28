import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { CSRF_HEADER, ERROR_CODES } from '@gentransit/shared'
import type { Request } from 'express'
import { ALLOW_MULTIPART } from './decorators'
import { AppError } from './errors'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF 防护（SameSite=Lax 之外再加一道）：写请求必须带自定义请求头 X-GT-Request: 1；
 * 有请求体时必须是 JSON（上传接口允许 multipart）。跨站表单无法设置自定义请求头。
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>()
    if (SAFE.has(req.method)) return true
    if (req.headers[CSRF_HEADER] !== '1') throw new AppError(403, ERROR_CODES.csrf, '缺少请求头 X-GT-Request')
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined
    if (!hasBody) return true
    const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (type === 'application/json') return true
    const multipart = this.reflector.getAllAndOverride<boolean>(ALLOW_MULTIPART, [ctx.getHandler(), ctx.getClass()])
    if (multipart && type === 'multipart/form-data') return true
    throw new AppError(403, ERROR_CODES.csrf, '写请求的内容类型必须是 application/json')
  }
}
