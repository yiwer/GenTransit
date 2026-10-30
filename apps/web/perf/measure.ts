// M6 性能测量（M6 计划第 6 节）：用 Playwright 驱动本机 Chrome 打开生产构建，CDP 模拟约 10 Mbps 的专网 / VPN，
// 量各页首次访问（清缓存）与再次访问（有缓存）的传输量、数据就绪时间、最大内容绘制时间，再量几个重接口的服务端耗时，
// 输出一张 Markdown 表。不进测试与持续集成，手动运行：
//   1. 临时库：docker run -d --name gentransit-perf-db -e POSTGRES_USER=gt -e POSTGRES_PASSWORD=gt -e POSTGRES_DB=gentransit_perf -p 127.0.0.1:54400:5432 postgres:16
//   2. 迁移与造数（apps/server）：DATABASE_URL=... npx prisma migrate deploy；DATABASE_URL=... node --import tsx scripts/perf-seed.ts
//   3. 构建并启动服务端：pnpm -r build；在 apps/server 下 NODE_ENV=production WEB_DIST=../web/dist PORT=3200
//      DATABASE_URL=... SESSION_SECRET=... GT_ADMIN_USERNAME=admin GT_ADMIN_PASSWORD=... AMAP_JSAPI_KEY= node dist/main.js
//      （高德变量置空，地图用示意平面，不依赖外网）
//   4. 测量（apps/web）：PERF_BASE_URL=http://127.0.0.1:3200 PERF_PASSWORD=... PERF_OUT=结果.md pnpm exec tsx perf/measure.ts
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test'

const BASE = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:3200'
const USERNAME = process.env.PERF_USERNAME ?? 'admin'
const PASSWORD = process.env.PERF_PASSWORD
const ROUNDS = Number(process.env.PERF_ROUNDS ?? 3)
/** 下行 10 Mbps、上行 5 Mbps、往返 40 毫秒（Q77） */
const NETWORK = { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 5e6 / 8 }
/** 这么久没有新请求、也没有未完成的请求，就算页面加载完了 */
const QUIET_MS = 1500

interface Req {
  url: string
  start: number
  end?: number
  bytes: number
}

/** 记录一个页面的全部网络请求（CDP 时间戳，秒） */
class NetLog {
  reqs = new Map<string, Req>()
  last = performance.now()

  constructor(cdp: CDPSession) {
    cdp.on('Network.requestWillBeSent', (e) => {
      if (!e.request.url.startsWith('http')) return
      // 重定向沿用同一个 requestId：只保留最后一跳的地址
      const prev = this.reqs.get(e.requestId)
      this.reqs.set(e.requestId, { url: e.request.url, start: prev?.start ?? e.timestamp, bytes: prev?.bytes ?? 0 })
      this.last = performance.now()
    })
    cdp.on('Network.loadingFinished', (e) => this.finish(e.requestId, e.timestamp, e.encodedDataLength))
    cdp.on('Network.loadingFailed', (e) => this.finish(e.requestId, e.timestamp, 0))
  }

  private finish(id: string, ts: number, bytes: number) {
    const r = this.reqs.get(id)
    if (!r) return
    r.end = ts
    r.bytes += bytes
    this.last = performance.now()
  }

  clear() {
    this.reqs.clear()
    this.last = performance.now()
  }

  async idle(timeout = 120_000) {
    const until = performance.now() + timeout
    while (performance.now() < until) {
      const pending = [...this.reqs.values()].some((r) => r.end === undefined)
      if (!pending && performance.now() - this.last > QUIET_MS) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error('等待网络空闲超时')
  }

  /**
   * 从 since（CDP 时间戳）起的统计：总字节、接口字节、最后一个接口返回的时刻（毫秒），
   * 以及最后一个接口返回之后才开始下载的字节（空闲预取等，不影响本页数据就绪）
   */
  stats(since: number) {
    const all = [...this.reqs.values()].filter((r) => r.start >= since)
    const api = all.filter((r) => new URL(r.url).pathname.startsWith('/api/'))
    const sum = (rs: Req[]) => rs.reduce((n, r) => n + r.bytes, 0)
    const ready = api.length ? Math.max(...api.map((r) => r.end ?? r.start)) : since
    return {
      bytes: sum(all),
      apiBytes: sum(api),
      dataReady: (ready - since) * 1000,
      lateBytes: sum(all.filter((r) => r.start > ready)),
    }
  }
}

interface Visit {
  bytes: number
  apiBytes: number
  dataReady: number
  lateBytes: number
  lcp: number
}

async function openPage(ctx: BrowserContext) {
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', NETWORK)
  return { page, cdp, log: new NetLog(cdp) }
}

/** 打开一页直到网络空闲；navStart 取文档请求发出的时刻 */
async function visit(ctx: BrowserContext, path: string, clearCache: boolean): Promise<Visit> {
  const { page, cdp, log } = await openPage(ctx)
  try {
    if (clearCache) await cdp.send('Network.clearBrowserCache')
    await page.goto(BASE + path, { waitUntil: 'commit' })
    await log.idle()
    const doc = [...log.reqs.values()].find((r) => r.url === BASE + path)
    if (!doc) throw new Error(`没有记录到 ${path} 的文档请求`)
    const s = log.stats(doc.start)
    return { ...s, lcp: await lcpOf(page) }
  } finally {
    await page.close()
  }
}

async function lcpOf(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const es = list.getEntries()
          resolve(es.length ? es[es.length - 1].startTime : 0)
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        setTimeout(() => resolve(0), 1000)
      }),
  )
}

/** 全局搜索一次：在已加载的工作台上按 Ctrl K，输入"12"，量两次输入触发的搜索请求 */
async function search(ctx: BrowserContext): Promise<Visit> {
  const { page, log } = await openPage(ctx)
  try {
    await page.goto(BASE + '/home')
    await log.idle()
    await page.keyboard.press('Control+k')
    await page.getByRole('textbox', { name: '搜索站点与线路' }).waitFor()
    log.clear()
    await page.keyboard.type('12')
    await log.idle()
    // 从第一个搜索请求发出算起
    const first = Math.min(...[...log.reqs.values()].map((r) => r.start))
    return { ...log.stats(first), lcp: NaN }
  } finally {
    await page.close()
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const kb = (n: number) => (Number.isNaN(n) ? '—' : (n / 1024).toFixed(n < 10240 ? 1 : 0))
const ms = (n: number) => (Number.isNaN(n) ? '—' : String(Math.round(n)))

async function main() {
  if (!PASSWORD) throw new Error('请设置 PERF_PASSWORD（临时库测试账号的密码）')
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const login = await ctx.request.post(BASE + '/api/auth/login', {
    data: { username: USERNAME, password: PASSWORD },
    headers: { 'X-GT-Request': '1' },
  })
  if (!login.ok()) throw new Error(`登录失败：${login.status()}`)
  const cookie = (await ctx.cookies(BASE)).map((c) => `${c.name}=${c.value}`).join('; ')
  const api = async <T>(path: string): Promise<T> => {
    const res = await fetch(BASE + path, { headers: { cookie } })
    if (!res.ok) throw new Error(`${path} 返回 ${res.status}`)
    return (await res.json()) as T
  }
  type Page<T> = { items: T[]; total: number }
  const stopId = async (name: string) => {
    const r = await api<Page<{ id: string; name: string }>>(`/api/stops?q=${encodeURIComponent(name)}&size=10`)
    const hit = r.items.find((s) => s.name === name)
    if (!hit) throw new Error(`找不到站点"${name}"，请先运行 apps/server/scripts/perf-seed.ts`)
    return hit.id
  }
  const hub = await stopId('枢纽站')
  const plain = await stopId('普通站')
  const lines = await api<Page<{ id: string; name: string }>>(`/api/lines?q=${encodeURIComponent('K1路')}&size=10`)
  const line = lines.items.find((l) => l.name === 'K1路')!.id
  const stopsTotal = (await api<Page<unknown>>('/api/stops?size=10')).total
  const linesTotal = (await api<Page<unknown>>('/api/lines?size=10')).total

  const pages: [string, string][] = [
    ['工作台', '/home'],
    ['站点列表（20 条）', '/stops'],
    ['站点列表（100 条）', '/stops?size=100'],
    ['站点详情（普通站）', `/stops/${plain}`],
    ['站点详情（枢纽站）', `/stops/${hub}`],
    ['线路列表（20 条）', '/lines'],
    ['线路列表（100 条）', '/lines?size=100'],
    ['线路详情', `/lines/${line}`],
    ['站牌集列表', '/sign-sets'],
    ['站牌集编辑器（枢纽站）', `/sign-sets/${hub}`],
  ]
  const rows: { name: string; first: Visit[]; again: Visit[] }[] = pages.map(([name]) => ({
    name,
    first: [],
    again: [],
  }))
  const searchRuns: Visit[] = []
  for (let round = 1; round <= ROUNDS; round++) {
    for (const [i, [name, path]] of pages.entries()) {
      rows[i].first.push(await visit(ctx, path, true))
      rows[i].again.push(await visit(ctx, path, false))
      console.error(`第 ${round} 轮 ${name}：首次 ${kb(rows[i].first.at(-1)!.bytes)} KB`)
    }
    searchRuns.push(await search(ctx))
  }

  // 服务端耗时：不限速，按顺序各请求 4 次；再并发请求工作台的 4 个计数接口
  const endpoints = [
    '/api/sign-sets/summary',
    '/api/sign-sets?pending=1&sort=-pending&size=5',
    '/api/sign-sets/queue?from=home',
    '/api/data-checks',
    '/api/lines?size=20',
    '/api/lines?size=100',
    `/api/stops/${hub}`,
    `/api/stops/${hub}/sign-set`,
  ]
  const timeOf = async (path: string) => {
    const t = performance.now()
    const res = await fetch(BASE + path, { headers: { cookie } })
    await res.arrayBuffer()
    if (!res.ok) throw new Error(`${path} 返回 ${res.status}`)
    return performance.now() - t
  }
  const timings: [string, number[]][] = []
  for (const path of endpoints) {
    const ts: number[] = []
    for (let i = 0; i < 4; i++) ts.push(await timeOf(path))
    timings.push([path.replace(hub, ':枢纽站'), ts])
  }
  const together: number[] = []
  for (let i = 0; i < 4; i++) {
    const t = performance.now()
    await Promise.all(endpoints.slice(0, 4).map(timeOf))
    together.push(performance.now() - t)
  }
  timings.push(['以上前 4 个接口同时请求（工作台）', together])
  await browser.close()

  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim()
  const dirty = git('status --porcelain --untracked-files=no -- :/apps :/packages') ? '（含未提交的改动）' : ''
  const pick = (vs: Visit[], k: keyof Visit) => median(vs.map((v) => v[k]))
  const out = [
    `### ${process.env.PERF_LABEL ?? '测量结果'}`,
    '',
    `提交 \`${git('rev-parse --short HEAD')}\`${dirty}；${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC；` +
      `站点 ${stopsTotal}、线路 ${linesTotal}；下行 10 Mbps、上行 5 Mbps、往返 40 ms；每项取 ${ROUNDS} 轮的中位数。`,
    '传输量为压缩后的实际字节（含响应头）；数据就绪为文档请求发出到最后一个接口返回；LCP 为最大内容绘制。',
    '',
    '| 页面 | 首次：传输 KB | 首次：其中接口 KB | 首次：数据就绪 ms | 首次：LCP ms | 再次：传输 KB | 再次：数据就绪 ms | 再次：LCP ms |',
    '|---|--:|--:|--:|--:|--:|--:|--:|',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${kb(pick(r.first, 'bytes'))} | ${kb(pick(r.first, 'apiBytes'))} | ${ms(pick(r.first, 'dataReady'))} | ` +
        `${ms(pick(r.first, 'lcp'))} | ${kb(pick(r.again, 'bytes'))} | ${ms(pick(r.again, 'dataReady'))} | ${ms(pick(r.again, 'lcp'))} |`,
    ),
    `| 全局搜索一次（输入"12"） | ${kb(pick(searchRuns, 'bytes'))} | ${kb(pick(searchRuns, 'apiBytes'))} | ` +
      `${ms(pick(searchRuns, 'dataReady'))} | — | — | — | — |`,
    '',
    '首次访问的传输里，最后一个接口返回之后才开始下载的部分（空闲预取等，KB）：' +
      rows.map((r) => `${r.name} ${kb(pick(r.first, 'lateBytes'))}`).join('，'),
    '',
    '服务端耗时（本机、不限速，依次请求 4 次，毫秒）：',
    '',
    '| 接口 | 第 1 次 | 第 2 次 | 第 3 次 | 第 4 次 |',
    '|---|--:|--:|--:|--:|',
    ...timings.map(([path, ts]) => `| \`${path}\` | ${ts.map(ms).join(' | ')} |`),
    '',
  ].join('\n')
  console.log(out)
  if (process.env.PERF_OUT) fs.writeFileSync(process.env.PERF_OUT, out)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
