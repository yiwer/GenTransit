import type { SignSetView } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { seedDesignScale } from './design-scale'
import { createTestApp, type TestApp } from './helpers'

/**
 * 需求 7.1、M3 计划 3.2：设计规模（站点 2 万、线路 3000、站架 5 万、站牌 10 万，途经约 18 万）下
 * 站牌集列表（含"只看待处理"）、工作台汇总、编辑器读取与保存都在 1 秒内
 */
describe('站牌集性能（设计规模）', () => {
  let t: TestApp
  let api: Agent

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    await seedDesignScale(t.prisma)
  }, 600_000)
  afterAll(() => t.close())

  const timed = async (url: string) => {
    await api.get(url).expect(200)
    const start = performance.now()
    const res = await api.get(url).expect(200)
    return { ms: performance.now() - start, body: res.body }
  }

  it('规模核对', async () => {
    const [row] = await t.prisma.$queryRaw<{ shelves: number; boards: number; rs: number; schedules: number }[]>`
      SELECT (SELECT count(*) FROM "Shelf")::int AS shelves, (SELECT count(*) FROM "Board")::int AS boards,
             (SELECT count(*) FROM "RouteStop")::int AS rs, (SELECT count(*) FROM "Schedule")::int AS schedules`
    console.log(`站架 ${row.shelves}，站牌 ${row.boards}，路径站 ${row.rs}，编排 ${row.schedules}`)
    expect(row.shelves).toBeGreaterThan(45000)
    expect(row.boards).toBeGreaterThan(90000)
    expect(row.rs).toBe(180000)
  })

  it.each([
    ['默认第一页', '/api/sign-sets'],
    ['每页 100 条，靠后的页', '/api/sign-sets?size=100&page=150'],
    ['只看待处理', '/api/sign-sets?pending=1'],
    ['按待处理数排序', '/api/sign-sets?sort=-pending&size=100'],
    ['只看待处理 + 站架类型 + 站牌尺寸', '/api/sign-sets?pending=1&boardSize=600x1800'],
    ['按站名搜索', `/api/sign-sets?q=${encodeURIComponent('站12')}`],
    ['工作台汇总', '/api/sign-sets/summary'],
    ['站牌尺寸下拉', '/api/sign-sets/board-sizes'],
  ])('%s < 1 秒', async (_, url) => {
    const { ms, body } = await timed(url)
    console.log(`${url} ${Math.round(ms)} ms`)
    expect(body).toBeTruthy()
    expect(ms).toBeLessThan(1000)
  })

  it('汇总的数字与列表一致', async () => {
    const s = (await api.get('/api/sign-sets/summary')).body
    const pending = (await api.get('/api/sign-sets?pending=1&size=1')).body
    expect(s.signSets).toBe(20000)
    expect(pending.total).toBe(s.pendingSets)
    expect(s.waiting).toBeGreaterThan(0)
    expect(s.invalid).toBeGreaterThan(0)
  })

  it('编辑器读取与保存 < 1 秒', async () => {
    const [{ stopId }] = await t.prisma.$queryRaw<{ stopId: string }[]>`
      SELECT ss."stopId"::text AS "stopId" FROM "SignSet" ss
      JOIN "Schedule" s ON s."signSetId" = ss.id GROUP BY ss."stopId" ORDER BY count(*) DESC LIMIT 1`
    const { ms, body } = await timed(`/api/stops/${stopId}/sign-set`)
    const v = body as SignSetView
    console.log(`编辑器读取 ${Math.round(ms)} ms（${v.schedules.length} 条编排、${v.passages.length} 个途经）`)
    expect(ms).toBeLessThan(1000)
    const start = performance.now()
    const r = await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, reminder: '性能测试', shelves: v.shelves, schedules: v.schedules })
      .expect(200)
    const saveMs = performance.now() - start
    console.log(`保存 ${Math.round(saveMs)} ms`)
    expect(r.body.changed).toBe(true)
    expect(saveMs).toBeLessThan(1000)
  })
})
