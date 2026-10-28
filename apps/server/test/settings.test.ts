import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

describe('设置（T6）', () => {
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

  const stop = (name: string, direction: string, ext: object = {}) =>
    t.prisma.stop.create({ data: { name, direction, lng: 120.2, lat: 30.25, ext } })

  it('默认方位模式、单站绑定上限 5、启用自动匹配', async () => {
    const res = await api.get('/api/settings').expect(200)
    expect(res.body).toEqual({ orientationMode: 'orientation', landmarkLimit: 5, autoMatch: true })
  })

  it('AC-14：编码模式下存在值为"A1"的站点时切回方位模式被拒绝，并列出不符合的站点', async () => {
    await api.put('/api/settings/orientation').send({ mode: 'code' }).expect(200)
    await stop('人民广场', '东')
    await stop('人民广场', 'A1')
    await stop('火车站', 'B-2')
    const res = await api.put('/api/settings/orientation').send({ mode: 'orientation' }).expect(409)
    expect(res.body.code).toBe('ORIENTATION_INCOMPATIBLE')
    expect(res.body.details.total).toBe(2)
    expect(res.body.details.stops.map((s: { label: string }) => s.label)).toEqual(['火车站（B-2）', '人民广场（A1）'])
    expect((await api.get('/api/settings')).body.orientationMode).toBe('code')
  })

  it('BR-13：方位 → 编码随时可切且原值保留；全部是方位值时可以切回', async () => {
    await stop('人民广场', '东')
    await stop('火车站', '场站')
    await api.put('/api/settings/orientation').send({ mode: 'code' }).expect(200)
    expect((await t.prisma.stop.findMany({ orderBy: { name: 'asc' } })).map((s) => s.direction)).toEqual(['场站', '东'])
    const res = await api.put('/api/settings/orientation').send({ mode: 'orientation' }).expect(200)
    expect(res.body.orientationMode).toBe('orientation')
  })

  it('地标设置', async () => {
    const res = await api.put('/api/settings/landmarks').send({ landmarkLimit: 3, autoMatch: false }).expect(200)
    expect(res.body).toMatchObject({ landmarkLimit: 3, autoMatch: false })
    await api.put('/api/settings/landmarks').send({ landmarkLimit: 0, autoMatch: true }).expect(400)
  })

  it('扩展字段：键与字段名在同归属内唯一；下拉必须有选项；站点字段默认放在"其他"分区', async () => {
    const f = (
      await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '养护片区', type: 'text' }).expect(201)
    ).body
    expect(f).toMatchObject({ section: 'other', enabled: true, hasValues: false, sort: 0 })
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '片区2', type: 'text' }).expect(409)
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area2', name: '养护片区', type: 'text' }).expect(409)
    // 不同归属可以同键
    const lf = (
      await api.post('/api/ext-fields').send({ owner: 'line', key: 'area', name: '养护片区', type: 'text' }).expect(201)
    ).body
    expect(lf.section).toBeNull()
    const bad = await api
      .post('/api/ext-fields')
      .send({ owner: 'stop', key: 'kind', name: '类型', type: 'select' })
      .expect(400)
    expect(bad.body.message).toContain('至少要有一个选项')
  })

  it('扩展字段类型锁定：已有取值后类型不能改；没有值时可以改；只停用不删除', async () => {
    const f = (
      await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '养护片区', type: 'text' }).expect(201)
    ).body
    const body = { name: '养护片区', type: 'number', options: [], description: '', section: 'basic', enabled: true }
    // 没有值时可以改类型
    const changed = await api.put(`/api/ext-fields/${f.id}`).send(body).expect(200)
    expect(changed.body).toMatchObject({ type: 'number', section: 'basic' })
    await stop('人民广场', '东', { area: 12 })
    const locked = await api
      .put(`/api/ext-fields/${f.id}`)
      .send({ ...body, type: 'text' })
      .expect(409)
    expect(locked.body.code).toBe('EXT_TYPE_LOCKED')
    const list = await api.get('/api/ext-fields?owner=stop').expect(200)
    expect(list.body[0].hasValues).toBe(true)
    // 改名、停用仍可以
    const off = await api
      .put(`/api/ext-fields/${f.id}`)
      .send({ ...body, name: '片区', enabled: false })
      .expect(200)
    expect(off.body).toMatchObject({ name: '片区', enabled: false, type: 'number' })
    // 没有删除接口
    await api.delete(`/api/ext-fields/${f.id}`).expect(404)
    expect(await t.prisma.extField.count()).toBe(1)
  })

  it('扩展字段排序', async () => {
    const a = (await api.post('/api/ext-fields').send({ owner: 'stop', key: 'a', name: 'A', type: 'text' })).body
    const b = (await api.post('/api/ext-fields').send({ owner: 'stop', key: 'b', name: 'B', type: 'text' })).body
    const res = await api
      .put('/api/ext-fields/order')
      .send({ ids: [b.id, a.id] })
      .expect(200)
    expect(res.body.map((x: { key: string }) => x.key)).toEqual(['b', 'a'])
  })
})
