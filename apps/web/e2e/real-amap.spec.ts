// AC-18 的真实 Key 检查（M4 计划第 6 节第 3 项）：对着 Docker 部署，用真实的高德变量，
// 等真实地图瓦片加载出来，再做一次逆地理编码；收集包括高德域名在内的全部网络请求与响应，
// 断言不含真实的安全密钥与 Web 服务 Key。只报告出现次数与密钥长度，不打印值。
// 只在 playwright.real-amap.config.ts 里运行（pnpm -F @gentransit/web test:real-amap）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'))
} catch {
  // 没有 .env 时只用环境变量
}

const USER = process.env.GT_REAL_USERNAME ?? process.env.GT_ADMIN_USERNAME ?? ''
const PASS = process.env.GT_REAL_PASSWORD ?? process.env.GT_ADMIN_PASSWORD ?? ''
const SECRETS = [
  ['安全密钥', process.env.AMAP_JSAPI_SECURITY_CODE ?? ''],
  ['Web 服务 Key', process.env.AMAP_WEB_SERVICE_KEY ?? ''],
] as const

const occurrences = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0)
/** 被中断的请求拿不到完整请求头或响应体：超时后用已有的内容 */
const within = <T>(p: Promise<T>, fallback: T, ms = 5000) =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

test('真实 Key：浏览器看到的请求与响应里没有安全密钥与 Web 服务 Key', async ({ page }) => {
  expect(USER && PASS, '需要 GT_REAL_USERNAME / GT_REAL_PASSWORD（或 .env 里的初始账号）').toBeTruthy()
  expect(SECRETS[0][1], '本机没有设置 AMAP_JSAPI_SECURITY_CODE').not.toBe('')
  const seen: string[] = []
  const pending: Promise<unknown>[] = []
  const hosts = new Set<string>()
  page.on('request', (req) => {
    hosts.add(new URL(req.url()).host)
    seen.push(req.url(), JSON.stringify(req.headers()), req.postData() ?? '')
    pending.push(within(req.allHeaders(), req.headers()).then((h) => seen.push(JSON.stringify(h))))
  })
  page.on('response', (res) => {
    pending.push(
      (async () => {
        const h = await within(res.allHeaders(), res.headers())
        seen.push(res.url(), JSON.stringify(h))
        if (/^(text\/|application\/(json|javascript|x-javascript|xml))/.test(h['content-type'] ?? ''))
          seen.push(await within(res.text(), ''))
      })(),
    )
  })

  await page.goto('/login')
  await page.getByLabel('用户名').fill(USER)
  await page.getByLabel('密码').fill(PASS)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/home$/)

  const config = (await (await page.request.get('/api/config')).json()) as { amapKey: string | null; regeo: boolean }
  expect(config.amapKey, '部署没有拿到 JS Key 与安全密钥，地图不会用真实高德').toBeTruthy()

  // 站点表单的地图：等真实瓦片加载出来（JS API 2.0 的矢量瓦片直接来自高德域名，旧版本经代理取 vectormap）
  const tiles = page.waitForResponse((r) => /amap\.com\/tile\/|\/v3\/vectormap/.test(r.url()) && r.status() === 200, {
    timeout: 60_000,
  })
  await page.goto('/stops/new')
  await tiles
  await page.waitForTimeout(3000)
  const map = page.locator('.amap-container, [data-testid="amap"]').first()
  await expect(map).toBeVisible()

  // 经 /_AMapService 代理做一次真实的服务请求（与 JS API 插件的写法相同：带 JS Key 与 s=rsv3）。
  // 高德返回 status=1 说明服务端附加的安全密钥有效；响应同样被收集检查
  const proxied = await page.evaluate(async (key) => {
    const res = await fetch(
      `/_AMapService/v3/place/text?keywords=${encodeURIComponent('公交站')}&offset=1&key=${key}&s=rsv3`,
    )
    return { status: res.status, body: (await res.json()) as { status?: string; info?: string } }
  }, config.amapKey!)
  console.log(`经代理的地点搜索：HTTP ${proxied.status}，高德 status=${proxied.body.status}，info=${proxied.body.info}`)
  expect(proxied.status).toBe(200)
  expect(proxied.body.status, '高德拒绝了经代理的请求，安全密钥或 Key 配置不对').toBe('1')

  // 逆地理编码：部署配置了 Web 服务 Key 时点一下地图触发；没有配置则直接请求，确认接口仍然不泄露
  const box = (await map.boundingBox())!
  if (config.regeo) {
    const regeo = page.waitForResponse((r) => r.url().includes('/api/geo/regeo'), { timeout: 30_000 })
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect((await regeo).status()).toBe(200)
  } else {
    await page.evaluate(() => fetch('/api/geo/regeo?lng=120.2&lat=30.25').then((r) => r.text()))
  }
  await page.waitForTimeout(2000)
  await Promise.all(pending)

  const all = seen.join('\n')
  const amapHosts = [...hosts].filter((h) => /amap\.com|autonavi\.com/.test(h))
  console.log(
    `收集了 ${seen.length} 段请求与响应，其中高德域名 ${amapHosts.length} 个；逆地理编码${config.regeo ? '已触发' : '未配置 Web 服务 Key，直接请求了接口'}`,
  )
  for (const [label, value] of SECRETS) {
    if (!value) {
      console.log(`${label}：本机没有设置，跳过`)
      continue
    }
    const n = occurrences(all, value) + occurrences(all, encodeURIComponent(value))
    console.log(`${label}（长度 ${value.length}）：出现 ${n} 次`)
    expect(n, `浏览器看到了${label}`).toBe(0)
  }
  expect(amapHosts.length, '没有访问到高德域名，地图没有真正加载').toBeGreaterThan(0)
})
