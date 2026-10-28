import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Agent } from 'supertest'
import { AMAP_UPSTREAMS } from '../src/amap/regeo.service'
import { createTestApp, type TestApp } from './helpers'

/** 本地假高德：记录收到的请求，按路径返回固定内容 */
function fakeAmap() {
  const seen: string[] = []
  let regeoBody: unknown = { status: '0' }
  const server = http.createServer((req, res) => {
    seen.push(req.url ?? '')
    if (req.url?.startsWith('/restapi/v3/geocode/regeo')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(regeoBody))
      return
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Set-Cookie', 'upstream=1')
    res.end(JSON.stringify({ status: '1', info: 'OK', path: req.url?.split('?')[0] }))
  })
  return {
    seen,
    setRegeo: (b: unknown) => (regeoBody = b),
    start: () =>
      new Promise<string>((r) =>
        server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      ),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}

describe('高德（T8）', () => {
  let t: TestApp
  let api: Agent
  const fake = fakeAmap()
  const CODE = 'test-security-code-7f3a9c'
  const WEB_KEY = 'test-web-service-key-5b1d'

  beforeAll(async () => {
    const base = await fake.start()
    t = await createTestApp((b) =>
      b
        .overrideProvider(AMAP_UPSTREAMS)
        .useValue({ webapi: `${base}/webapi`, fmap: `${base}/fmap`, restapi: `${base}/restapi` }),
    )
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    fake.seen.length = 0
  })
  afterAll(async () => {
    await t.close()
    await fake.stop()
  })

  it('/api/config 只下发 JS Key，不出现安全密钥与 Web 服务 Key；需要登录', async () => {
    await t.anon().get('/api/config').expect(401)
    const res = await api.get('/api/config').expect(200)
    expect(res.body).toEqual({ amapKey: 'test-jsapi-key', amapProxy: true, regeo: true })
    expect(res.text).not.toContain(CODE)
    expect(res.text).not.toContain(WEB_KEY)
  })

  it('代理转发时附加 jscode，响应里不出现安全密钥，不透传上游 Cookie', async () => {
    const res = await api.get('/_AMapService/v3/place/text?keywords=%E4%BA%BA%E6%B0%91&s=rsv3').expect(200)
    expect(fake.seen).toEqual([`/restapi/v3/place/text?keywords=%E4%BA%BA%E6%B0%91&s=rsv3&jscode=${CODE}`])
    expect(res.body).toMatchObject({ status: '1', path: '/restapi/v3/place/text' })
    expect(res.text).not.toContain(CODE)
    expect(JSON.stringify(res.headers)).not.toContain(CODE)
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('按原型规则选择上游：样式走 webapi，矢量瓦片走 fmap01，其余走 restapi', async () => {
    await api.get('/_AMapService/v4/map/styles?styleid=whitesmoke').expect(200)
    await api.get('/_AMapService/v3/vectormap?t=1').expect(200)
    await api.get('/_AMapService/v3/log/init').expect(200)
    expect(fake.seen.map((u) => u.split('/')[1])).toEqual(['webapi', 'fmap', 'restapi'])
    expect(fake.seen.every((u) => u.includes(`jscode=${CODE}`))).toBe(true)
  })

  it('代理要求登录会话，避免被当作公开代理', async () => {
    await t.anon().get('/_AMapService/v3/place/text?keywords=a').expect(401)
    expect(fake.seen).toHaveLength(0)
  })

  it('逆地理编码：服务端用 Web 服务 Key 调高德，先精确、再去后缀模糊匹配，匹配不到给新建建议', async () => {
    const city = await t.prisma.region.create({ data: { level: 'city', name: '示例市' } })
    const district = await t.prisma.region.create({ data: { level: 'district', name: '中心区', parentId: city.id } })
    const street = await t.prisma.region.create({ data: { level: 'street', name: '解放', parentId: district.id } })
    fake.setRegeo({
      status: '1',
      regeocode: {
        formatted_address: '示例市中心区解放街道解放路 1 号',
        addressComponent: {
          province: '示例省',
          city: '示例市',
          district: '中心区',
          township: '解放街道',
          streetNumber: { street: '解放路', number: '1号' },
        },
      },
    })
    const res = await api.get('/api/geo/regeo?lng=120.2&lat=30.25').expect(200)
    expect(fake.seen[0]).toContain(`key=${WEB_KEY}`)
    expect(fake.seen[0]).toContain('location=120.200000,30.250000')
    expect(res.text).not.toContain(WEB_KEY)
    expect(res.body).toMatchObject({
      available: true,
      city: { name: '示例市', match: { id: city.id }, how: 'exact' },
      district: { name: '中心区', match: { id: district.id }, how: 'exact' },
      street: { name: '解放街道', match: { id: street.id, name: '解放' }, how: 'fuzzy' },
      road: { name: '解放路', match: null, how: null },
    })
  })

  it('没有 Web 服务 Key 时逆地理编码不可用，地图仍可用', async () => {
    const t2 = await createTestApp(undefined, { AMAP_WEB_SERVICE_KEY: undefined })
    try {
      const a = await t2.login()
      expect((await a.get('/api/geo/regeo?lng=120.2&lat=30.25').expect(200)).body.available).toBe(false)
      expect((await a.get('/api/config')).body).toEqual({ amapKey: 'test-jsapi-key', amapProxy: true, regeo: false })
    } finally {
      await t2.close()
    }
  })
})
