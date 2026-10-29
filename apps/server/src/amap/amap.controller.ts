import { All, Controller, Get, Inject, Query, Req, Res } from '@nestjs/common'
import type { AppConfig } from '@gentransit/shared'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { ENV, type Env } from '../config/env'
import { AMAP_UPSTREAMS, RegeoService, scrub, upstreamOf, type AmapUpstreams } from './regeo.service'

const regeoQuery = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
})

const HOP_HEADERS = new Set(['content-type', 'cache-control', 'expires', 'last-modified', 'etag'])
/** 文本类响应要清洗密钥；瓦片等二进制原样转发 */
const TEXT_TYPE = /^(text\/|application\/(json|javascript|x-javascript|xml)|[^;]*\+(json|xml))/i

@Controller()
export class AmapController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AMAP_UPSTREAMS) private readonly up: AmapUpstreams,
    private readonly regeo: RegeoService,
  ) {}

  /** 前端启动时取 JS Key；安全密钥与 Web 服务 Key 永远不下发 */
  @Get('api/config')
  config(): AppConfig {
    const key = this.env.AMAP_JSAPI_KEY
    const code = this.env.AMAP_JSAPI_SECURITY_CODE
    return {
      amapKey: key && code ? key : null,
      amapProxy: Boolean(code),
      regeo: Boolean(this.env.AMAP_WEB_SERVICE_KEY),
    }
  }

  @Get('api/geo/regeo')
  reverse(@Query(new ZodPipe(regeoQuery)) q: z.infer<typeof regeoQuery>) {
    return this.regeo.reverse(q.lng, q.lat)
  }

  /**
   * JS API 安全密钥代理：转发时附加 jscode，浏览器拿不到安全密钥。
   * 要求登录会话（全局守卫），避免被当作公开代理。
   */
  @All('_AMapService/*path')
  async proxy(@Req() req: Request, @Res() res: Response) {
    const code = this.env.AMAP_JSAPI_SECURITY_CODE
    if (!code) {
      res.status(503).json({ code: 'AMAP_UNAVAILABLE', message: '服务端没有配置高德安全密钥' })
      return
    }
    const rest = req.originalUrl.slice('/_AMapService'.length) || '/'
    const url = `${upstreamOf(rest, this.up)}${rest}${rest.includes('?') ? '&' : '?'}jscode=${encodeURIComponent(code)}`
    try {
      const upstream = await fetch(url, {
        method: req.method,
        headers: { accept: req.headers.accept ?? '*/*', 'user-agent': req.headers['user-agent'] ?? 'GenTransit' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        redirect: 'follow',
      })
      res.status(upstream.status)
      upstream.headers.forEach((v, k) => HOP_HEADERS.has(k) && res.setHeader(k, v))
      const body = Buffer.from(await upstream.arrayBuffer())
      if (TEXT_TYPE.test(upstream.headers.get('content-type') ?? ''))
        res.send(Buffer.from(scrub(body.toString('utf8'), [code, this.env.AMAP_WEB_SERVICE_KEY]), 'utf8'))
      else res.send(body)
    } catch {
      res.status(502).json({ code: 'AMAP_UNAVAILABLE', message: '无法连接高德服务' })
    }
  }
}
