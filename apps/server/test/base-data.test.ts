import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

describe('基础数据（T5）', () => {
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

  const newStop = (data: Record<string, unknown>) =>
    t.prisma.stop.create({ data: { name: '人民广场', direction: '东', lng: 120.2, lat: 30.25, ...data } })

  it('字典：新建、同类重名被拒、按拼音排序、改名', async () => {
    const road = (name: string) => api.post('/api/dicts').send({ category: 'road', name })
    const a = (await road('中山路').expect(201)).body
    await road('解放路').expect(201)
    await road('北京路').expect(201)
    const dup = await road('中山路').expect(409)
    expect(dup.body).toMatchObject({ code: 'DUPLICATE', message: '路段「中山路」已存在' })
    // 不同类别可以同名
    await api.post('/api/dicts').send({ category: 'maintainer', name: '中山路' }).expect(201)
    const list = await api.get('/api/dicts?category=road').expect(200)
    expect(list.body.map((d: { name: string }) => d.name)).toEqual(['北京路', '解放路', '中山路'])
    const renamed = await api.put(`/api/dicts/${a.id}`).send({ name: '中山大道' }).expect(200)
    expect(renamed.body.name).toBe('中山大道')
    await api.put(`/api/dicts/${a.id}`).send({ name: '解放路' }).expect(409)
  })

  it('被引用的字典项删除被拒，并列出引用方（BR-12）；未引用的可以删除', async () => {
    const road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' }).expect(201)).body
    const free = (await api.post('/api/dicts').send({ category: 'road', name: '中山路' }).expect(201)).body
    await newStop({ roadId: road.id })
    await newStop({ name: '火车站', direction: '场站', maintainerId: null, roadId: road.id })
    const res = await api.delete(`/api/dicts/${road.id}`).expect(409)
    expect(res.body.code).toBe('IN_USE')
    expect(res.body.message).toBe('「解放路」仍被引用，不能删除')
    expect(res.body.details.total).toBe(2)
    expect(res.body.details.referrers).toEqual([
      expect.objectContaining({ type: '站点', name: '火车站（场站）' }),
      expect.objectContaining({ type: '站点', name: '人民广场（东）' }),
    ])
    const list = await api.get('/api/dicts?category=road').expect(200)
    expect(list.body.find((d: { id: string }) => d.id === road.id).refCount).toBe(2)
    await api.delete(`/api/dicts/${free.id}`).expect(204)
  })

  it('行政区划：三级结构、上级层级校验、名称在上级内唯一、有下级或被站点引用时不能删除', async () => {
    const city = (await api.post('/api/regions').send({ level: 'city', name: '示例市' }).expect(201)).body
    await api.post('/api/regions').send({ level: 'city', name: '示例市' }).expect(409)
    const district = (
      await api.post('/api/regions').send({ level: 'district', parentId: city.id, name: '中心区' }).expect(201)
    ).body
    await api.post('/api/regions').send({ level: 'street', parentId: city.id, name: '解放街道' }).expect(400)
    const street = (
      await api.post('/api/regions').send({ level: 'street', parentId: district.id, name: '解放街道' }).expect(201)
    ).body
    await api.post('/api/regions').send({ level: 'street', parentId: district.id, name: '解放街道' }).expect(409)

    const del = await api.delete(`/api/regions/${district.id}`).expect(409)
    expect(del.body.details.referrers).toEqual([expect.objectContaining({ type: '下级区划', name: '解放街道' })])

    await newStop({ cityId: city.id, districtId: district.id, streetId: street.id })
    const del2 = await api.delete(`/api/regions/${street.id}`).expect(409)
    expect(del2.body.details.referrers).toEqual([expect.objectContaining({ type: '站点', name: '人民广场（东）' })])

    const list = await api.get('/api/regions').expect(200)
    expect(list.body.map((r: { level: string }) => r.level)).toEqual(['city', 'district', 'street'])
  })

  it('公交公司：名称唯一、logo 必须是已上传文件、被线路引用时不能删除', async () => {
    const c = (await api.post('/api/companies').send({ name: '示例公交一公司', hotline: '96000' }).expect(201)).body
    expect(c).toMatchObject({ name: '示例公交一公司', lineCount: 0, logo: null })
    await api.post('/api/companies').send({ name: '示例公交一公司' }).expect(409)
    await api
      .put(`/api/companies/${c.id}`)
      .send({ name: '示例公交一公司', logoId: '0190a4b4-0000-7000-8000-000000000000' })
      .expect(404)
    await t.prisma.line.create({ data: { name: '1路', number: 'G-0001', mode: 'twoway', companyId: c.id } })
    const res = await api.delete(`/api/companies/${c.id}`).expect(409)
    expect(res.body.details.referrers).toEqual([expect.objectContaining({ type: '线路', name: '1路' })])
    const list = await api.get('/api/companies').expect(200)
    expect(list.body[0].lineCount).toBe(1)
  })
})
