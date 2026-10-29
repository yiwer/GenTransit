import fs from 'node:fs'
import path from 'node:path'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'
import { Logger } from 'nestjs-pino'
import type { Env } from './config/env'

/** main.ts 与集成测试共用的应用配置 */
export function configureApp(app: NestExpressApplication, env: Env) {
  app.useLogger(app.get(Logger))
  app.disable('x-powered-by')
  // 部署在反向代理之后时，用 X-Forwarded-Proto 判断 HTTPS（决定 Cookie 是否加 Secure）。
  // 容器里宿主机的反向代理来自 Docker 网桥地址，compose 默认信任 loopback,uniquelocal
  app.set('trust proxy', env.TRUST_PROXY)
  app.use(cookieParser())
  app.useBodyParser('json', { limit: '2mb' })
  app.enableShutdownHooks()

  // 托管前端构建产物：/api 与 /_AMapService 之外的 GET 请求都回到 index.html（SPA 路由）
  const dist = env.WEB_DIST && path.resolve(env.WEB_DIST)
  if (dist && fs.existsSync(path.join(dist, 'index.html'))) {
    app.useStaticAssets(dist, { index: false, maxAge: '7d', immutable: true })
    const indexHtml = path.join(dist, 'index.html')
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/_AMapService')) return next()
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(indexHtml)
    })
  }
}
