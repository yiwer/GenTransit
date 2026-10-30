import type { DataChecks, StopBatchResult } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { seedDesignScale } from './design-scale'
import { createTestApp, type TestApp } from './helpers'

/**
 * M5 计划第 6 节：设计规模（站点 2 万、线路 3000、途经 18 万）下，数据体检 < 2 秒（不走缓存）、
 * 沿线编排进度 < 200 ms、编辑器队列 < 500 ms、批量修改 2000 个站点 < 30 秒
 */
describe('M5 性能（设计规模）', () => {
  let t: TestApp
  let api: Agent

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    await seedDesignScale(t.prisma)
  }, 600_000)
  afterAll(() => t.close())

  const timed = async (fn: () => Promise<unknown>) => {
    const start = performance.now()
    const body = await fn()
    return { ms: performance.now() - start, body }
  }

  it('数据体检：第一次计算 < 2 秒，之后走缓存', async () => {
    const first = await timed(async () => (await api.get('/api/data-checks').expect(200)).body as DataChecks)
    const again = await timed(async () => (await api.get('/api/data-checks').expect(200)).body as DataChecks)
    console.log(`数据体检 ${Math.round(first.ms)} ms，缓存后 ${Math.round(again.ms)} ms`, JSON.stringify(first.body))
    expect((first.body as DataChecks).lines.noTrack).toBe(3000)
    expect(first.ms).toBeLessThan(2000)
    const list = await timed(async () => (await api.get('/api/lines?check=gap').expect(200)).body)
    console.log(`线路列表 check=gap ${Math.round(list.ms)} ms`)
    expect(list.ms).toBeLessThan(1000)
  })

  it('沿线编排进度 < 200 ms；逐站编排队列与工作台队列 < 500 ms', async () => {
    const [l] = await t.prisma.line.findMany({ where: { status: 'running' }, take: 1, select: { id: true } })
    await api.get(`/api/lines/${l.id}/arrangement`).expect(200)
    const arr = await timed(() => api.get(`/api/lines/${l.id}/arrangement`).expect(200))
    const byLine = await timed(() => api.get(`/api/sign-sets/queue?from=line&lineId=${l.id}`).expect(200))
    const home = await timed(() => api.get('/api/sign-sets/queue?from=home').expect(200))
    console.log(
      `沿线进度 ${Math.round(arr.ms)} ms，线路队列 ${Math.round(byLine.ms)} ms，工作台队列 ${Math.round(home.ms)} ms`,
    )
    expect(arr.ms).toBeLessThan(200)
    expect(byLine.ms).toBeLessThan(500)
    expect(home.ms).toBeLessThan(500)
  })

  it('按距离排序搜索、500 个站点的对向站判定 < 1 秒', async () => {
    const near = await timed(() => api.get(`/api/stops?q=${encodeURIComponent('站1')}&near=120.05,30.2`).expect(200))
    const ids = (await t.prisma.stop.findMany({ take: 500, select: { id: true } })).map((s) => s.id)
    const opp = await timed(() => api.post('/api/stops/opposites').send({ ids }).expect(200))
    console.log(`near 搜索 ${Math.round(near.ms)} ms，对向站 ${Math.round(opp.ms)} ms`)
    expect(near.ms).toBeLessThan(1000)
    expect(opp.ms).toBeLessThan(1000)
  })

  it('批量修改 2000 个站点 < 30 秒', async () => {
    const m = (await api.post('/api/dicts').send({ category: 'maintainer', name: '城北养护' }).expect(201)).body
    const ids = (await t.prisma.stop.findMany({ take: 2000, select: { id: true } })).map((s) => s.id)
    const r = await timed(
      async () =>
        (
          await api
            .post('/api/stops/batch')
            .send({ scope: { ids }, patch: { maintainerId: m.id } })
            .expect(200)
        ).body,
    )
    console.log(`批量修改 2000 站 ${Math.round(r.ms)} ms`)
    expect(r.body as StopBatchResult).toEqual({ selected: 2000, changed: 2000 })
    expect(r.ms).toBeLessThan(30_000)
  }, 120_000)
})
