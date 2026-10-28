import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common'
import { ERROR_CODES, type ApiErrorBody } from '@gentransit/shared'
import type { Response } from 'express'
import { Prisma } from '../generated/prisma/client'

const STATUS_CODE: Record<number, [string, string]> = {
  400: [ERROR_CODES.validation, '请求不合法'],
  401: [ERROR_CODES.unauthorized, '请先登录'],
  403: [ERROR_CODES.csrf, '请求被拒绝'],
  404: [ERROR_CODES.notFound, '接口不存在'],
  413: [ERROR_CODES.uploadRejected, '文件不能超过 10 MB'],
}

/** 把所有异常整理成 { code, message, details } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error')

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()
    const [status, body] = this.toBody(exception)
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception))
    if (!res.headersSent) res.status(status).json(body)
  }

  private toBody(e: unknown): [number, ApiErrorBody] {
    if (e instanceof HttpException) {
      const status = e.getStatus()
      const r = e.getResponse()
      if (typeof r === 'object' && r && 'code' in r && 'message' in r) return [status, r as ApiErrorBody]
      const [code, message] = STATUS_CODE[status] ?? [ERROR_CODES.internal, e.message]
      return [status, { code, message }]
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return [409, { code: ERROR_CODES.duplicate, message: '名称或编号重复', details: e.meta }]
      if (e.code === 'P2003') return [409, { code: ERROR_CODES.inUse, message: '仍被引用，不能删除', details: e.meta }]
      if (e.code === 'P2025') return [404, { code: ERROR_CODES.notFound, message: '对象不存在' }]
    }
    return [500, { code: ERROR_CODES.internal, message: '服务器内部错误' }]
  }
}
