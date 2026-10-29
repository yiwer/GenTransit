import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { v1Line, type LineDetail, type LineListItem, type StopDetail } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { AMAP_UPSTREAMS } from '../src/amap/regeo.service'
import { createTestApp, type TestApp } from './helpers'

const KEY = 'test-route-api-key-9c2e41'

/**
 * 本地假高德的驾车路线规划：按起点、途经点、终点依次连线，每两点之间插一个中点，路程每段 100 米。
 * fail 设为错误码时返回失败；failTimes 次之后恢复正常（默认一直失败）
 */
function fakeDriving() {
  const calls: URLSearchParams[] = []
  let fail: string | null = null
  let failTimes = Infinity
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    res.setHeader('Content-Type', 'application/json')
    if (!url.pathname.endsWith('/v5/direction/driving')) {
      res.end(JSON.stringify({ status: '0', info: 'NOT_FOUND', infocode: '20000' }))
      return
    }
    calls.push(url.searchParams)
    if (fail && failTimes > 0) {
      failTimes--
      res.end(JSON.stringify({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT', infocode: fail }))
      return
    }
    const q = url.searchParams
    const pts = [q.get('origin')!, ...(q.get('waypoints')?.split(';') ?? []), q.get('destination')!].map((p) =>
      p.split(',').map(Number),
    )
    const steps = pts.slice(1).map((b, i) => {
      const a = pts[i]
      const mid = [((a[0] + b[0]) / 2).toFixed(6), ((a[1] + b[1]) / 2 + 0.0005).toFixed(6)]
      return { polyline: `${a.join(',')};${mid.join(',')};${b.join(',')}` }
    })
    res.end(JSON.stringify({ status: '1', route: { paths: [{ distance: String(steps.length * 100), steps }] } }))
  })
  return {
    calls,
    failWith: (code: string | null, times = Infinity) => {
      fail = code
      failTimes = times
    },
    start: () =>
      new Promise<string>((r) =>
        server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      ),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  }
}

describe('走向轨迹', () => {
  let t: TestApp
  let api: Agent
  const fake = fakeDriving()
  let stops: StopDetail[]

  beforeAll(async () => {
    const base = await fake.start()
    t = await createTestApp(
      (b) =>
        b
          .overrideProvider(AMAP_UPSTREAMS)
          .useValue({ webapi: `${base}/webapi`, fmap: `${base}/fmap`, restapi: `${base}/restapi` }),
      { AMAP_API_KEY: KEY },
    )
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    fake.calls.length = 0
    fake.failWith(null)
    stops = []
    // 20 个站点：一次请求最多 16 个途经点（18 个站），要分两段
    for (let i = 0; i < 20; i++)
      stops.push(
        (
          await api
            .post('/api/stops')
            .send({ name: `轨迹站${i + 1}`, direction: '东', lng: 120.1 + i * 0.004, lat: 30.2 + (i % 3) * 0.002 })
            .expect(201)
        ).body.item,
      )
  })
  afterAll(async () => {
    await t.close()
    await fake.stop()
  })

  const mkLine = async (ids: string[]) =>
    (
      await api
        .post('/api/lines')
        .send({
          name: 'G1路',
          number: 'G-1',
          mode: 'oneway',
          routes: [{ kind: 'oneway', stops: ids.map((stopId) => ({ stopId })) }],
        })
        .expect(201)
    ).body.item as LineDetail
  const compute = (id: string) => api.post(`/api/lines/${id}/track`).send({})

  it('按站序分段请求、拼接；详情、列表、只读 API 都带轨迹；不生成快照、不改 rev', async () => {
    const line = await mkLine(stops.map((s) => s.id))
    expect(line.routes[0].track).toBeNull()
    const snapshots = await t.prisma.snapshot.count({ where: { objectType: 'line', objectId: line.id } })
    const before = (await t.prisma.line.findUniqueOrThrow({ where: { id: line.id } })).updatedAt

    const r = (await compute(line.id).expect(200)).body as { results: { ok: boolean }[]; item: LineDetail }
    expect(r.results).toEqual([{ routeId: line.routes[0].id, ok: true }])

    // 两段：第一段起点 + 16 个途经点 + 终点（第 18 站），第二段从第 18 站到第 20 站
    expect(fake.calls).toHaveLength(2)
    expect(fake.calls[0].get('key')).toBe(KEY)
    expect(fake.calls[0].get('waypoints')!.split(';')).toHaveLength(16)
    expect(fake.calls[1].get('origin')).toBe(fake.calls[0].get('destination'))
    expect(fake.calls[1].get('waypoints')!.split(';')).toHaveLength(1)
    expect(fake.calls[0].get('show_fields')).toBe('polyline')

    const track = r.item.routes[0].track!
    expect(track.stale).toBe(false)
    expect(track.distance).toBe(19 * 100)
    // 每段插了中点；接缝处的重复点去掉
    expect(track.points[0]).toEqual([stops[0].lng, stops[0].lat])
    expect(track.points.at(-1)).toEqual([stops[19].lng, stops[19].lat])
    expect(track.points.length).toBeGreaterThan(20)
    expect(JSON.stringify(r)).not.toContain(KEY)

    const list = (await api.get('/api/lines').expect(200)).body.items as LineListItem[]
    expect(list[0].routes[0].track).toEqual(track.points)

    expect(await t.prisma.snapshot.count({ where: { objectType: 'line', objectId: line.id } })).toBe(snapshots)
    const after = await t.prisma.line.findUniqueOrThrow({ where: { id: line.id } })
    expect(after.rev).toBe(line.rev)
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime())

    // 只读 API：线路详情带轨迹，契约模式严格通过
    const token = (await api.post('/api/api-tokens').send({ name: '轨迹' }).expect(201)).body.token as string
    const v1 = (await t.anon().get(`/api/v1/lines/${line.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body
    expect(v1Line.parse(v1).routes[0].track).toMatchObject({ distance: 1900, stale: false })
  })

  it('站序变了以后轨迹标为已过期；列表不再用它', async () => {
    const line = await mkLine(stops.slice(0, 5).map((s) => s.id))
    const done = (await compute(line.id).expect(200)).body.item as LineDetail
    const reordered = (
      await api
        .put(`/api/lines/${line.id}`)
        .send({
          name: done.name,
          number: done.number,
          nameEn: done.nameEn,
          mode: done.mode,
          companyId: null,
          ticketType: done.ticketType,
          fareSystemId: null,
          fare: done.fare,
          ext: done.ext,
          rev: done.rev,
          routes: [
            { kind: 'oneway', stops: [stops[1], stops[0], ...stops.slice(2, 5)].map((s) => ({ stopId: s.id })) },
          ],
        })
        .expect(200)
    ).body.item as LineDetail
    expect(reordered.routes[0].track?.stale).toBe(true)
    const list = (await api.get('/api/lines').expect(200)).body.items as LineListItem[]
    expect(list[0].routes[0].track).toBeNull()
  })

  it('高德返回错误：给出中文原因，不保存', async () => {
    const line = await mkLine(stops.slice(0, 4).map((s) => s.id))
    fake.failWith('10003')
    const r = (await compute(line.id).expect(200)).body as {
      results: { ok: boolean; message?: string }[]
      item: LineDetail
    }
    expect(r.results[0]).toMatchObject({ ok: false, message: '今天的调用次数已用完' })
    expect(r.item.routes[0].track).toBeNull()
  })

  it('每秒次数超限：自动等一会儿重试；两个走向的请求之间也留间隔', async () => {
    const l = (
      await api
        .post('/api/lines')
        .send({
          name: 'G3路',
          number: 'G-3',
          mode: 'twoway',
          routes: [
            { kind: 'up', stops: stops.slice(0, 3).map((s) => ({ stopId: s.id })) },
            {
              kind: 'down',
              stops: stops
                .slice(0, 3)
                .reverse()
                .map((s) => ({ stopId: s.id })),
            },
          ],
        })
        .expect(201)
    ).body.item as LineDetail
    fake.failWith('10021', 1)
    const t0 = Date.now()
    const r = (await compute(l.id).expect(200)).body as { results: { ok: boolean }[] }
    expect(r.results.map((x) => x.ok)).toEqual([true, true])
    // 第一次被限流 + 重试成功 + 第二个走向
    expect(fake.calls).toHaveLength(3)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000 + 400)
  })

  it('没有配置 AMAP_API_KEY：接口返回 503，配置里 routeTrack 为 false', async () => {
    expect((await api.get('/api/config').expect(200)).body.routeTrack).toBe(true)
    const t2 = await createTestApp(undefined, { AMAP_API_KEY: undefined })
    try {
      await t2.reset()
      const a2 = await t2.login()
      expect((await a2.get('/api/config').expect(200)).body.routeTrack).toBe(false)
      const s1 = (await a2.post('/api/stops').send({ name: '甲', direction: '东', lng: 120.1, lat: 30.2 }).expect(201))
        .body.item
      const s2 = (await a2.post('/api/stops').send({ name: '乙', direction: '东', lng: 120.2, lat: 30.2 }).expect(201))
        .body.item
      const l = (
        await a2
          .post('/api/lines')
          .send({
            name: 'G2路',
            number: 'G-2',
            mode: 'oneway',
            routes: [{ kind: 'oneway', stops: [{ stopId: s1.id }, { stopId: s2.id }] }],
          })
          .expect(201)
      ).body.item as LineDetail
      const r = await a2.post(`/api/lines/${l.id}/track`).send({}).expect(503)
      expect(r.body.code).toBe('AMAP_UNAVAILABLE')
    } finally {
      await t2.close()
    }
  })
})
