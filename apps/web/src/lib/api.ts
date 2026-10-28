// 请求封装：统一错误格式、写请求的 CSRF 请求头、401 跳登录
import { CSRF_HEADER, ERROR_CODES, type ApiErrorBody, type Upload } from '@gentransit/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export const isApiError = (e: unknown, code?: string): e is ApiError =>
  e instanceof ApiError && (!code || e.code === code)

/** 保存冲突（AC-10）：对象在打开之后已被别处保存 */
export const isConflict = (e: unknown): e is ApiError & { details: { latest: unknown } } =>
  isApiError(e, ERROR_CODES.conflict)

export const UNAUTHORIZED_EVENT = 'gt:unauthorized'

type Query = Record<string, string | number | boolean | null | undefined>

export function withQuery(path: string, query?: Query) {
  if (!query) return path
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `${path}?${s}` : path
}

async function parse<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>
    if (res.status === 401 && !path.startsWith('/api/auth/login')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, body.code ?? 'HTTP_ERROR', body.message ?? `请求失败（${res.status}）`, body.details)
  }
  return data as T
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers[CSRF_HEADER] = '1'
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const url = withQuery(path, init.query)
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  return parse<T>(res, url)
}

export const get = <T>(path: string, query?: Query) => api<T>(path, { query })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} })
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export async function uploadFile(file: File): Promise<Upload> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1' },
    credentials: 'same-origin',
    body: fd,
  })
  return parse<Upload>(res, '/api/uploads')
}

/** 导入：上传文件生成预览（multipart） */
export async function uploadImport<T>(kind: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  const res = await fetch(`/api/import/${kind}`, {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1' },
    credentials: 'same-origin',
    body: fd,
  })
  return parse<T>(res, `/api/import/${kind}`)
}
