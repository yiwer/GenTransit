import path from 'node:path'
import { z } from 'zod'

/** 空字符串视为未设置 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined))

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z
    .string({ error: '缺少 DATABASE_URL（PostgreSQL 连接串）' })
    .min(1, '缺少 DATABASE_URL（PostgreSQL 连接串）'),
  SESSION_SECRET: z
    .string({ error: '缺少 SESSION_SECRET（会话密钥，至少 32 个字符）' })
    .min(32, 'SESSION_SECRET 至少 32 个字符'),
  GT_ADMIN_USERNAME: optional,
  GT_ADMIN_PASSWORD: optional,
  AMAP_JSAPI_KEY: optional,
  AMAP_JSAPI_SECURITY_CODE: optional,
  AMAP_WEB_SERVICE_KEY: optional,
  /** 高德 Web 服务 Key：服务端按站序计算走向轨迹（驾车路线规划）用，不下发浏览器 */
  AMAP_API_KEY: optional,
  UPLOAD_DIR: optional,
  /** 前端构建产物目录；设置后由 Nest 托管静态资源（生产与端到端测试） */
  WEB_DIST: optional,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** 信任哪些代理的 X-Forwarded-*（Express trust proxy 写法，逗号分隔）；HTTPS 下 Cookie 据此加 Secure */
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v?.trim() || 'loopback'),
  /** 备份目录（设置"备份"页签读取 status.json 与各份 manifest.json）；不设时显示"未配置" */
  BACKUP_DIR: optional,
  BACKUP_RETENTION_DAYS: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? undefined : v),
    z.coerce.number().int().min(1).max(3650).default(30),
  ),
  /** 应用版本，镜像构建时写入；OpenAPI 文档与备份清单用 */
  APP_VERSION: optional,
  /** 只在 NODE_ENV=test 时生效：高德上游统一换成这个地址（AC-18 端到端测试的假上游），生产环境忽略 */
  AMAP_UPSTREAM_OVERRIDE: optional,
})

export type Env = z.infer<typeof envSchema> & { uploadDir: string }

export const ENV = Symbol('ENV')

export class EnvError extends Error {}

/** 读取并校验环境变量；缺必填项时抛出带中文说明的错误 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = envSchema.safeParse(source)
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '环境变量'}：${i.message}`)
    throw new EnvError(`环境变量不完整或不合法：\n${lines.join('\n')}`)
  }
  return { ...r.data, uploadDir: path.resolve(r.data.UPLOAD_DIR ?? path.resolve(__dirname, '../../uploads')) }
}

/** 读取仓库根目录的 .env（已存在的环境变量优先） */
export function loadDotEnv() {
  try {
    process.loadEnvFile(path.resolve(__dirname, '../../../../.env'))
  } catch {
    // 没有 .env 时只用系统环境变量
  }
}
