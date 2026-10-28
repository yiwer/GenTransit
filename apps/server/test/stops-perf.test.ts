import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

/** 需求 7.1：站点 2 万的规模下列表查询 1 秒内完成 */
describe('站点列表性能（2 万站点种子）', () => {
  let t: TestApp
  let api: Agent
  let roadId: string

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    roadId = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' })).body.id
    // 2 万个站点，名称有中文前缀以触发拼音排序，四分之一挂在同一路段上
    await t.prisma.$executeRaw`
      INSERT INTO "Stop" (id, name, direction, "nameEn", lng, lat, "roadId", "updatedAt")
      SELECT gen_random_uuid(),
             (ARRAY['人民','解放','火车','中山','北门','滨江','科技','文化'])[1 + i % 8] || '站' || i,
             (ARRAY['东','南','西','北'])[1 + i % 4],
             'Stop ' || i,
             120.1 + (i % 200) * 0.001, 30.2 + (i / 200) * 0.001,
             CASE WHEN i % 4 = 0 THEN ${roadId}::uuid ELSE NULL END,
             now() - (i || ' seconds')::interval
      FROM generate_series(1, 20000) AS i`
    await t.prisma.$executeRaw`ANALYZE "Stop"`
  }, 120_000)
  afterAll(() => t.close())

  const timed = async (url: string) => {
    await api.get(url).expect(200) // 预热
    const start = performance.now()
    const res = await api.get(url).expect(200)
    return { ms: performance.now() - start, body: res.body }
  }

  it.each([
    ['默认第一页', '/api/stops'],
    ['每页 100 条', '/api/stops?size=100'],
    ['靠后的页', '/api/stops?page=150&size=100'],
    ['按名称搜索', `/api/stops?q=${encodeURIComponent('解放站1')}`],
    ['按路段 + 方位筛选', '/api/stops?dir=%E4%B8%9C&roadId=ROAD'],
    ['按最近修改排序', '/api/stops?sort=-updatedAt&size=100'],
  ])('%s < 1 秒', async (_, url) => {
    const { ms, body } = await timed(url.replace('ROAD', roadId))
    expect(body.total).toBeGreaterThan(0)
    expect(ms).toBeLessThan(1000)
  })

  it('总数正确', async () => {
    expect((await api.get('/api/stops?size=10')).body.total).toBe(20000)
  })
})
