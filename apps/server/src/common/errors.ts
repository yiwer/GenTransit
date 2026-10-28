import { HttpException } from '@nestjs/common'
import { ERROR_CODES, type Referrer } from '@gentransit/shared'

/** 业务错误：响应体统一为 { code, message, details } */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status)
  }
}

export const notFound = (what = '对象') => new AppError(404, ERROR_CODES.notFound, `${what}不存在`)

export const duplicate = (message: string, details?: unknown) =>
  new AppError(409, ERROR_CODES.duplicate, message, details)

/** 被引用时不能删除（BR-12）：列出引用方 */
export const inUse = (what: string, referrers: Referrer[], total = referrers.length) =>
  new AppError(409, ERROR_CODES.inUse, `「${what}」仍被引用，不能删除`, { referrers, total })

export const invalid = (message: string, details?: unknown) =>
  new AppError(400, ERROR_CODES.validation, message, details)
