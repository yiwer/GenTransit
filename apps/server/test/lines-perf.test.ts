import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

/** 需求 7.1：线路 3000 条的规模下列表查询 1 秒内完成（默认排序在服务端内存里做） */
describe('线路列表性能（3000 条线路种子）', () => {
  let t: TestApp
  let api: Agent

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    // 200 个站点；3000 条双边线路，每个走向 12 站
    await t.prisma.$executeRaw`
      INSERT INTO "Stop" (id, name, direction, lng, lat, "updatedAt")
      SELECT gen_random_uuid(), '站' || i, '东', 120.1 + i * 0.001, 30.2, now() FROM generate_series(1, 200) AS i`
    await t.prisma.$executeRaw`
      INSERT INTO "Line" (id, name, number, mode, "updatedAt")
      SELECT gen_random_uuid(),
             (ARRAY['', 'K', 'B', '夜', '旅游'])[1 + i % 5] || i || '路',
             'N-' || i, 'twoway', now()
      FROM generate_series(1, 3000) AS i`
    await t.prisma.$executeRaw`
      INSERT INTO "Route" (id, "lineId", kind, "updatedAt")
      SELECT gen_random_uuid(), l.id, k.kind::"RouteKind", now()
      FROM "Line" l CROSS JOIN (VALUES ('up'), ('down')) AS k(kind)`
    await t.prisma.$executeRaw`
      INSERT INTO "RouteStop" (id, "routeId", "stopId", seq, times, "updatedAt")
      SELECT gen_random_uuid(), r.id, s.id, n, '{}', now()
      FROM "Route" r
      CROSS JOIN generate_series(1, 12) AS n
      JOIN LATERAL (SELECT id FROM "Stop" ORDER BY name OFFSET ((abs(hashtext(r.id::text)) + n * 7) % 200) LIMIT 1) s ON true`
    await t.prisma.$executeRaw`ANALYZE`
  }, 180_000)
  afterAll(() => t.close())

  it.each([
    ['默认自动排序第一页', '/api/lines'],
    ['每页 100 条', '/api/lines?size=100'],
    ['靠后的页', '/api/lines?page=30&size=100'],
    ['按名称搜索', `/api/lines?q=${encodeURIComponent('K1')}`],
    ['按最近修改排序', '/api/lines?sort=-updatedAt&size=100'],
  ])('%s < 1 秒', async (_, url) => {
    await api.get(url).expect(200)
    const start = performance.now()
    const res = await api.get(url).expect(200)
    expect(res.body.total).toBeGreaterThan(0)
    expect(performance.now() - start).toBeLessThan(1000)
  })

  it('总数正确，第一页按自动排序', async () => {
    const res = (await api.get('/api/lines?size=3')).body
    expect(res.total).toBe(3000)
    expect(res.items.map((x: { name: string }) => x.name)).toEqual(['5路', '10路', '15路'])
  })

  it('导出全部 3000 条线路（7.2 万个路径站）分批读取，30 秒内完成', async () => {
    const start = performance.now()
    const res = await api
      .get('/api/export/lines')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = []
        r.on('data', (c: Buffer) => chunks.push(c))
        r.on('end', () => cb(null, Buffer.concat(chunks)))
      })
      .expect(200)
    const ms = performance.now() - start
    console.log(`导出 3000 条线路 ${Math.round(ms)} ms，${Math.round((res.body as Buffer).length / 1024)} KB`)
    expect(ms).toBeLessThan(30_000)
  }, 60_000)
})
