import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

export const IS_PUBLIC = 'gt:public'
/** 不需要登录会话的接口（登录、健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC, true)

export const TOKEN_AUTH = 'gt:token'
/** 只读 API：只认 Authorization: Bearer 的 API Token，不认登录 Cookie（M4 计划 2.3 节） */
export const TokenAuth = () => SetMetadata(TOKEN_AUTH, true)

export const ALLOW_MULTIPART = 'gt:multipart'
/** 允许 multipart/form-data 请求体（上传） */
export const AllowMultipart = () => SetMetadata(ALLOW_MULTIPART, true)

export interface SessionInfo {
  id: string
  accountId: string
  username: string
}

export type AuthedRequest = Request & { session?: SessionInfo; apiTokenId?: string }

/** 当前登录会话 */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().session
})
