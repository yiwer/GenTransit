// AC-18 自动检查（M4 计划第 6 节第 1 项）：另起一个服务端，安全密钥与 Web 服务 Key 设为每次随机生成的哨兵值，
// 高德上游指向本地假服务（把收到的请求地址原样回显）。逐页走一遍并操作，收集浏览器看到的全部请求与响应，
// 再检查这个服务端进程的日志：都不能出现哨兵值
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN, E2E_PORT } from './env'
import { login } from './helpers'
import { startServer, webDist, type StartedServer } from './server'

const PORT = E2E_PORT + 1
const CODE = `sentinelcode${randomBytes(10).toString('hex')}`
const WEB_KEY = `sentinelweb${randomBytes(10).toString('hex')}`

test.use({ baseURL: `http://127.0.0.1:${PORT}` })

/** 假高德：所有请求都回显地址；逆地理编码把地址塞进结果字段 */
function fakeAmap() {
  const seen: string[] = []
  const server = http.createServer((req, res) => {
    const url = req.url ?? ''
    seen.push(url)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (url.startsWith('/v3/geocode/regeo')) {
      res.end(
        JSON.stringify({
          status: '1',
          regeocode: {
            formatted_address: `回显 ${url}`,
            addressComponent: {
              city: '示例市',
              district: decodeURIComponent(url),
              township: '',
              streetNumber: { street: url },
            },
          },
        }),
      )
      return
    }
    res.end(JSON.stringify({ status: '1', echo: url, decoded: decodeURIComponent(url), headers: req.headers }))
  })
  return {
    seen,
    start: () =>
      new Promise<string>((r) =>
        server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      ),
    stop: () =>
      new Promise<void>((r) => {
        // 代理与逆地理编码用的长连接不等它自己超时
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}

const TEXT = /^(text\/|application\/(json|javascript|xml)|image\/svg)/

/** 被中断的请求（如页面跳走）拿不到完整请求头或响应体：超时后用已有的内容 */
const within = <T>(p: Promise<T>, fallback: T, ms = 5000) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

/** 收集页面上发生的每个请求的地址、请求头、请求体，以及响应头与文本响应体 */
function collect(page: Page) {
  const seen: string[] = []
  const pending: Promise<void>[] = []
  page.on('request', (req) => {
    seen.push(req.url(), JSON.stringify(req.headers()), req.postData() ?? '')
    pending.push(
      within(req.allHeaders(), req.headers()).then((h) => {
        seen.push(JSON.stringify(h))
      }),
    )
  })
  page.on('response', (res) => {
    pending.push(
      (async () => {
        const h = await within(res.allHeaders(), res.headers())
        seen.push(res.url(), JSON.stringify(h))
        if (TEXT.test(h['content-type'] ?? '')) seen.push(await within(res.text(), ''))
      })(),
    )
  })
  return {
    text: async () => {
      await Promise.all(pending)
      return seen.join('\n')
    },
    count: () => seen.length,
  }
}

test.describe('AC-18：浏览器与服务端日志里没有高德安全密钥与 Web 服务 Key', () => {
  const fake = fakeAmap()
  let server: StartedServer
  let logFile: string

  test.beforeAll(async () => {
    const upstream = await fake.start()
    logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gentransit-ac18-')), 'server.log')
    server = await startServer(
      {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: process.env.GT_E2E_DATABASE_URL,
        SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
        GT_ADMIN_USERNAME: E2E_ADMIN.username,
        GT_ADMIN_PASSWORD: E2E_ADMIN.password,
        // JS Key 留空：地图仍用示意平面；安全密钥与 Web 服务 Key 用哨兵值
        AMAP_JSAPI_KEY: '',
        AMAP_JSAPI_SECURITY_CODE: CODE,
        AMAP_WEB_SERVICE_KEY: WEB_KEY,
        AMAP_UPSTREAM_OVERRIDE: upstream,
        UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gentransit-ac18-uploads-')),
        WEB_DIST: webDist,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'debug',
      },
      { logFile },
    )
  })
  test.afterAll(async () => {
    await server?.stop()
    await fake.stop()
  })

  test('逐页走一遍并操作，请求与响应里都不出现哨兵值', async ({ page }) => {
    test.setTimeout(120_000)
    const net = collect(page)
    await login(page)
    const stop = await page.request.post('/api/stops', {
      headers: { 'X-GT-Request': '1' },
      data: { name: `密钥检查站${Date.now()}`, direction: '东', lng: 120.2, lat: 30.25 },
    })
    const stopId = ((await stop.json()) as { item: { id: string } }).item.id

    for (const p of [
      '/home',
      '/stops',
      `/stops/${stopId}`,
      '/lines',
      '/sign-sets',
      `/sign-sets/${stopId}`,
      '/landmarks',
    ])
      await page.goto(p)
    for (const tab of ['account', 'api-tokens', 'orientation', 'ext-fields', 'backup'])
      await page.goto(`/settings/${tab}`)

    // 站点表单：在示意平面上点一下，触发逆地理编码
    await page.goto('/stops/new')
    const map = page.getByTestId('plane-map')
    await expect(map).toBeVisible()
    const regeo = page.waitForResponse((r) => r.url().includes('/api/geo/regeo'))
    const box = (await map.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const r = await regeo
    expect(r.status()).toBe(200)

    // 在页面里直接请求高德代理：上游会把带 jscode 的地址回显回来
    const statuses = await page.evaluate(async () => {
      const out: number[] = []
      for (const p of [
        '/_AMapService/v3/place/text?keywords=a&s=rsv3',
        '/_AMapService/v4/map/styles?styleid=x',
        '/_AMapService/v3/vectormap?t=1',
        '/api/geo/regeo?lng=120.2&lat=30.25',
        '/api/config',
      ]) {
        const res = await fetch(p)
        await res.text()
        out.push(res.status)
      }
      return out
    })
    expect(statuses).toEqual([200, 200, 200, 200, 200])

    await page.goto('/api/v1/docs')
    await expect(page.locator('.swagger-ui')).toBeVisible()

    // 假上游确实收到了哨兵值：说明代理与逆地理编码真的带上了密钥，检查有意义
    expect(fake.seen.some((u) => u.includes(CODE))).toBe(true)
    expect(fake.seen.some((u) => u.includes(WEB_KEY))).toBe(true)

    const all = await net.text()
    expect(net.count()).toBeGreaterThan(100)
    expect(all.includes(CODE), '浏览器看到了安全密钥').toBe(false)
    expect(all.includes(WEB_KEY), '浏览器看到了 Web 服务 Key').toBe(false)
    expect(all).toContain('jscode=***')

    // 服务端日志
    await server.stop()
    const log = fs.readFileSync(logFile, 'utf8')
    expect(log.length).toBeGreaterThan(0)
    expect(log).toContain('/_AMapService/')
    expect(log.includes(CODE), '服务端日志里有安全密钥').toBe(false)
    expect(log.includes(WEB_KEY), '服务端日志里有 Web 服务 Key').toBe(false)
  })
})
