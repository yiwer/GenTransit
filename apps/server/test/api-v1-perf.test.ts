import type { V1Page } from '@gentransit/shared'
import request from 'supertest'
import { seedDesignScale } from './design-scale'
import { createTestApp, type TestApp } from './helpers'

/**
 * M4 计划 3.9 节：设计规模下只读 API 每页 < 1 秒（站点 500 条、线路 100 条、站牌集 100 个、已删除对象 500 条）；
 * 带最近 updatedSince 的增量查询 < 200 毫秒
 */
describe('只读 API 性能（设计规模）', () => {
  let t: TestApp
  let token: string

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    const api = await t.login()
    token = (await api.post('/api/api-tokens').send({ name: '性能' }).expect(201)).body.token
    await seedDesignScale(t.prisma)
    const sql = (q: TemplateStringsArray) => t.prisma.$executeRawUnsafe(q.join(''))
    // 已删除对象：5000 条删除快照、2000 条墓碑
    await sql`
      INSERT INTO "Snapshot" (id, "objectType", "objectId", "objectName", action, content, "compareHash", "createdAt")
      SELECT gen_random_uuid(), (ARRAY['stop', 'line', 'signSet'])[1 + i % 3]::"ObjectType", gen_random_uuid(),
             '已删' || i, 'delete', '{}', '', now() - (i || ' seconds')::interval
      FROM generate_series(1, 5000) AS i`
    await sql`
      INSERT INTO "Tombstone" ("objectId", type, name, "deletedAt")
      SELECT gen_random_uuid(), (ARRAY['landmark', 'dictItem', 'region'])[1 + i % 3]::"TombstoneType", '墓碑' || i,
             now() - (i || ' seconds')::interval
      FROM generate_series(1, 2000) AS i`
    // 一部分对象的修改时间错开，模拟真实分布
    await sql`UPDATE "Stop" SET "updatedAt" = now() - (abs(hashtext(id::text)) % 100000 || ' seconds')::interval`
    await sql`UPDATE "SignSet" SET "changedAt" = now() - (abs(hashtext(id::text)) % 100000 || ' seconds')::interval`
    await sql`ANALYZE`
  }, 600_000)
  afterAll(() => t.close())

  const get = (url: string) =>
    request(t.app.getHttpServer()).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).expect(200)
  const timed = async (url: string) => {
    await get(url)
    const start = performance.now()
    const res = await get(url)
    return { ms: performance.now() - start, body: res.body as V1Page<unknown> }
  }
  /** 第一页之后再翻若干页，取最后一页的游标 */
  const deepCursor = async (url: string, pages: number) => {
    let cursor: string | null = null
    for (let i = 0; i < pages; i++) {
      const sep = url.includes('?') ? '&' : '?'
      const res = await get(`${url}${cursor ? `${sep}cursor=${cursor}` : ''}`)
      cursor = (res.body as V1Page<unknown>).nextCursor
    }
    return cursor!
  }

  it.each([
    ['站点 500 条', '/stops?limit=500', 500],
    ['线路 100 条', '/lines?limit=100', 100],
    ['站牌集 100 个', '/sign-sets?limit=100', 100],
    ['已删除对象 500 条', '/deleted?limit=500', 500],
  ])('%s：第一页与靠后的页 < 1 秒', async (_, url, n) => {
    const first = await timed(url)
    const cursor = await deepCursor(url, 8)
    const later = await timed(`${url}&cursor=${cursor}`)
    console.log(`${url} 第一页 ${Math.round(first.ms)} ms，第 9 页 ${Math.round(later.ms)} ms`)
    expect(first.body.items).toHaveLength(n)
    expect(later.body.items).toHaveLength(n)
    expect(first.ms).toBeLessThan(1000)
    expect(later.ms).toBeLessThan(1000)
  })

  it('带最近 updatedSince 的增量查询 < 200 毫秒', async () => {
    const since = new Date(Date.now() - 60_000).toISOString()
    // 最近一分钟只改了 30 个站点
    await t.prisma.$executeRawUnsafe(
      `UPDATE "Stop" SET "updatedAt" = now() AT TIME ZONE 'UTC' WHERE id IN (SELECT id FROM "Stop" ORDER BY id LIMIT 30)`,
    )
    await t.prisma.$executeRawUnsafe(
      `UPDATE "SignSet" SET "changedAt" = now() AT TIME ZONE 'UTC' WHERE id IN (SELECT id FROM "SignSet" ORDER BY id LIMIT 30)`,
    )
    for (const url of ['/stops', '/sign-sets', '/lines', '/deleted']) {
      const { ms, body } = await timed(`${url}?updatedSince=${encodeURIComponent(since)}`)
      console.log(`${url} 增量 ${Math.round(ms)} ms（${body.items.length} 条）`)
      expect(ms).toBeLessThan(200)
    }
  })
})
