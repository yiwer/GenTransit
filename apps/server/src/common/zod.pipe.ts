import { PipeTransform } from '@nestjs/common'
import { ERROR_CODES } from '@gentransit/shared'
import type { z } from 'zod'
import { AppError } from './errors'

/** 用 packages/shared 里的 zod 模式校验请求体或查询参数 */
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value)
    if (r.success) return r.data
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    const first = issues[0]
    throw new AppError(
      400,
      ERROR_CODES.validation,
      first ? `${first.path ? `${first.path}：` : ''}${first.message}` : '提交的内容不合法',
      {
        issues,
      },
    )
  }
}
