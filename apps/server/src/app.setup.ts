import fs from 'node:fs'
import path from 'node:path'
import type { NestExpressApplication } from '@nestjs/platform-express'
import compression from 'compression'
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
  // 压缩传输（M6 计划 3.1）：放在静态资源与接口之前，两者都压缩；超过 1 KB 才压，
  // 图片、视频、woff2、xlsx 等本身已压缩的类型由中间件按 Content-Type 跳过
  app.use(compression({ threshold: 1024 }))
  app.use(cookieParser())
  app.useBodyParser('json', { limit: '2mb' })
  app.enableShutdownHooks()

  // 托管前端构建产物：/api 与 /_AMapService 之外的 GET 请求都回到 index.html（SPA 路由）
  const dist = env.WEB_DIST && path.resolve(env.WEB_DIST)
  if (dist && fs.existsSync(path.join(dist, 'index.html'))) {
    const assets = path.join(dist, 'assets') + path.sep
    app.useStaticAssets(dist, {
      index: false,
      // /assets/ 下的文件名带内容哈希，内容变了地址就变：缓存一年；其他文件（如 favicon.svg）一天（M6 计划 3.2）。
      // 这里先设了 Cache-Control，静态中间件就不再按 maxAge 写
      setHeaders: (res: Response, file: string) => {
        if (file.startsWith(assets)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        else if (path.basename(file) === 'index.html') res.setHeader('Cache-Control', 'no-cache')
        else res.setHeader('Cache-Control', 'public, max-age=86400')
      },
    })
    const indexHtml = path.join(dist, 'index.html')
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/_AMapService')) return next()
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(indexHtml)
    })
  }
}
