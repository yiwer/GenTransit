import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

// 纬度 1 米约 1/111195 度
const north = (lat: number, meters: number) => lat + meters / 111195

describe('地标（T9）', () => {
  let t: TestApp
  let api: Agent
  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
  })
  afterAll(() => t.close())

  const category = async (name: string, enabled = true) =>
    (await api.post('/api/landmark-categories').send({ name, defaultRadius: 100, enabled }).expect(201)).body
  const landmark = async (name: string, categoryId: string, points: { lng: number; lat: number; radius: number }[]) =>
    (await api.post('/api/landmarks').send({ name, categoryId, points }).expect(201)).body
  const candidates = async (lng: number, lat: number) =>
    (await api.get(`/api/landmarks/candidates?lng=${lng}&lat=${lat}`).expect(200)).body as {
      name: string
      distance: number
    }[]

  it('候选：半径内命中、半径外不命中、停用类别不参与；多个位置点取最近', async () => {
    const park = await category('公园')
    const closed = await category('已停用', false)
    await landmark('中山公园', park.id, [
      { lng: 120.2, lat: 30.25, radius: 100 },
      { lng: 120.2, lat: north(30.25, 400), radius: 100 },
    ])
    await landmark('停用类别的地标', closed.id, [{ lng: 120.2, lat: 30.25, radius: 500 }])

    const inside = await candidates(120.2, north(30.25, 60))
    expect(inside).toEqual([{ id: expect.any(String), name: '中山公园', category: '公园', distance: 60 }])
    expect(await candidates(120.2, north(30.25, 150))).toEqual([])
    // 靠近第二个位置点
    const near2 = await candidates(120.2, north(30.25, 330))
    expect(near2.map((c) => [c.name, c.distance])).toEqual([['中山公园', 70]])
    // 恰在半径边界上算命中
    expect((await candidates(120.2, north(30.25, 99.5))).length).toBe(1)
  })

  it('地标与位置点：编辑时整体替换位置点；按类别与名称筛选', async () => {
    const park = await category('公园')
    const school = await category('学校')
    const a = await landmark('中山公园', park.id, [{ lng: 120.2, lat: 30.25, radius: 90 }])
    await landmark('实验中学', school.id, [{ lng: 120.21, lat: 30.26, radius: 60 }])
    const upd = await api
      .put(`/api/landmarks/${a.id}`)
      .send({
        name: '中山公园',
        nameEn: 'Zhongshan Park',
        categoryId: park.id,
        points: [
          { lng: 120.2, lat: 30.25, radius: 90 },
          { lng: 120.201, lat: 30.251, radius: 50 },
        ],
      })
      .expect(200)
    expect(upd.body.points).toHaveLength(2)
    expect(await t.prisma.landmarkPoint.count()).toBe(3)
    expect((await api.get(`/api/landmarks?categoryId=${school.id}`)).body.map((l: { name: string }) => l.name)).toEqual(
      ['实验中学'],
    )
    expect((await api.get('/api/landmarks?q=zhongshan')).body.map((l: { name: string }) => l.name)).toEqual([
      '中山公园',
    ])
    await api.post('/api/landmarks').send({ name: '空', categoryId: park.id, points: [] }).expect(400)
  })

  it('被引用时不能删除：类别下有地标、地标绑定了站点', async () => {
    const park = await category('公园')
    const lm = await landmark('中山公园', park.id, [{ lng: 120.2, lat: 30.25, radius: 90 }])
    const r1 = await api.delete(`/api/landmark-categories/${park.id}`).expect(409)
    expect(r1.body.details.referrers).toEqual([expect.objectContaining({ type: '地标', name: '中山公园' })])
    const stop = await t.prisma.stop.create({ data: { name: '中山公园', direction: '北', lng: 120.2, lat: 30.25 } })
    await t.prisma.stopLandmark.create({ data: { stopId: stop.id, landmarkId: lm.id } })
    const r2 = await api.delete(`/api/landmarks/${lm.id}`).expect(409)
    expect(r2.body.details.referrers).toEqual([expect.objectContaining({ type: '站点', name: '中山公园（北）' })])
    await t.prisma.stopLandmark.deleteMany()
    await api.delete(`/api/landmarks/${lm.id}`).expect(204)
    await api.delete(`/api/landmark-categories/${park.id}`).expect(204)
  })
})
