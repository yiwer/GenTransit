import type { StopDetail } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

describe('站点（T10）', () => {
  let t: TestApp
  let api: Agent
  let road: { id: string }
  let maintainer: { id: string }

  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' }).expect(201)).body
    maintainer = (await api.post('/api/dicts').send({ category: 'maintainer', name: '示例公交一公司' }).expect(201))
      .body
  })
  afterAll(() => t.close())

  const input = (over: Record<string, unknown> = {}) => ({
    name: '人民广场',
    direction: '东',
    nameEn: 'Renmin Square',
    lng: 120.2,
    lat: 30.25,
    roadId: road.id,
    maintainerId: maintainer.id,
    seats: 4,
    ...over,
  })
  const create = async (over: Record<string, unknown> = {}) =>
    (await api.post('/api/stops').send(input(over)).expect(201)).body.item as StopDetail
  const body = (s: StopDetail, over: Record<string, unknown> = {}) => ({
    ...input(),
    landmarkIds: s.landmarks.map((l) => l.id),
    photoIds: s.photos.map((p) => p.id),
    ext: s.ext,
    rev: s.rev,
    ...over,
  })
  const snapshots = (type: string, id: string) =>
    t.prisma.snapshot.findMany({ where: { objectType: type as 'stop', objectId: id }, orderBy: { createdAt: 'asc' } })

  it('AC-01：新建站点 X，X 拥有空站牌集，并生成站点"新增"快照（站牌集也存一份）', async () => {
    const res = await api.post('/api/stops').send(input()).expect(201)
    expect(res.body.changed).toBe(true)
    const s = res.body.item as StopDetail
    expect(s).toMatchObject({ name: '人民广场', direction: '东', rev: 1, road: { id: road.id, name: '解放路' } })
    const signSet = await t.prisma.signSet.findUniqueOrThrow({ where: { stopId: s.id } })
    expect(signSet).toMatchObject({ id: s.signSet.id, reminder: '', rev: 1 })
    const stopSnaps = await snapshots('stop', s.id)
    expect(stopSnaps.map((x) => [x.action, x.objectName])).toEqual([['create', '人民广场（东）']])
    expect(stopSnaps[0].content).toMatchObject({ schema: 1, name: '人民广场', road: { id: road.id, name: '解放路' } })
    const ssSnaps = await snapshots('signSet', signSet.id)
    expect(ssSnaps.map((x) => x.action)).toEqual(['create'])
    expect(ssSnaps[0].content).toMatchObject({ schema: 1, shelves: [], schedules: [] })
  })

  it('有效修改判定：原样保存不产生快照、不更新业务行；改名的字典项不扩散；真正修改才生成快照', async () => {
    const s = await create()
    const before = await t.prisma.stop.findUniqueOrThrow({ where: { id: s.id } })
    const same = await api.put(`/api/stops/${s.id}`).send(body(s)).expect(200)
    expect(same.body.changed).toBe(false)
    const after = await t.prisma.stop.findUniqueOrThrow({ where: { id: s.id } })
    expect(after.rev).toBe(1)
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString())
    expect(await snapshots('stop', s.id)).toHaveLength(1)

    // 字典项改名后原样保存：仍然没有变化
    await api.put(`/api/dicts/${road.id}`).send({ name: '解放大道' }).expect(200)
    const again = await api.put(`/api/stops/${s.id}`).send(body(s)).expect(200)
    expect(again.body.changed).toBe(false)
    expect(again.body.item.road.name).toBe('解放大道')

    // 真正修改
    const changed = await api
      .put(`/api/stops/${s.id}`)
      .send(body(s, { remark: '地铁口', seats: 6 }))
      .expect(200)
    expect(changed.body.changed).toBe(true)
    expect(changed.body.item.rev).toBe(2)
    const snaps = await snapshots('stop', s.id)
    expect(snaps.map((x) => x.action)).toEqual(['create', 'update'])
    expect(snaps[1].note).toBe('修改：座椅数、备注')
  })

  it('AC-10（接口层）：两处编辑同一站点，后保存的一方收到冲突，不覆盖前者，并带回最新内容', async () => {
    const s = await create()
    const a = await api
      .put(`/api/stops/${s.id}`)
      .send(body(s, { remark: 'A 的修改' }))
      .expect(200)
    expect(a.body.item.rev).toBe(2)
    const b = await api
      .put(`/api/stops/${s.id}`)
      .send(body(s, { remark: 'B 的修改' }))
      .expect(409)
    expect(b.body.code).toBe('CONFLICT')
    expect(b.body.details.latest).toMatchObject({ id: s.id, rev: 2, remark: 'A 的修改' })
    expect((await t.prisma.stop.findUniqueOrThrow({ where: { id: s.id } })).remark).toBe('A 的修改')
    // 以最新内容重新编辑后可以保存
    await api
      .put(`/api/stops/${s.id}`)
      .send(body(s, { remark: 'B 的修改', rev: 2 }))
      .expect(200)
  })

  it('AC-09：删除仍被路径站引用的站点被拒绝，并列出引用它的线路与走向', async () => {
    const s = await create()
    const line = await t.prisma.line.create({ data: { name: 'K1路', number: 'K-0001', mode: 'twoway' } })
    const up = await t.prisma.route.create({ data: { lineId: line.id, kind: 'up' } })
    const down = await t.prisma.route.create({ data: { lineId: line.id, kind: 'down' } })
    await t.prisma.routeStop.create({ data: { routeId: up.id, stopId: s.id, seq: 1 } })
    await t.prisma.routeStop.create({ data: { routeId: down.id, stopId: s.id, seq: 1 } })

    const check = await api.get(`/api/stops/${s.id}/delete-check`).expect(200)
    expect(check.body).toEqual({
      canDelete: false,
      referrers: [
        { type: '线路走向', id: up.id, name: 'K1路 上行' },
        { type: '线路走向', id: down.id, name: 'K1路 下行' },
      ],
    })
    const res = await api.delete(`/api/stops/${s.id}`).expect(409)
    expect(res.body.code).toBe('IN_USE')
    expect(res.body.details.referrers.map((r: { name: string }) => r.name)).toEqual(['K1路 上行', 'K1路 下行'])
    expect(await t.prisma.stop.count()).toBe(1)
    // 详情里能看到经过的线路
    const detail = await api.get(`/api/stops/${s.id}`).expect(200)
    expect(
      detail.body.routes.map((r: { lineName: string; routeKind: string }) => `${r.lineName}${r.routeKind}`),
    ).toEqual(['K1路down', 'K1路up'])
  })

  it('删除站点同时删除站牌集，两者各存一份"删除"快照，并出现在"已删除"视图', async () => {
    const s = await create()
    await api.delete(`/api/stops/${s.id}`).expect(204)
    expect(await t.prisma.stop.count()).toBe(0)
    expect(await t.prisma.signSet.count()).toBe(0)
    expect((await snapshots('stop', s.id)).map((x) => x.action)).toEqual(['create', 'delete'])
    expect((await snapshots('signSet', s.signSet.id)).map((x) => x.action)).toEqual(['create', 'delete'])
    const deleted = await api.get('/api/snapshots/deleted?type=stop').expect(200)
    expect(deleted.body.items).toEqual([
      expect.objectContaining({ objectId: s.id, objectName: '人民广场（东）', snapshotCount: 2 }),
    ])
    await api.get(`/api/stops/${s.id}`).expect(404)
  })

  it('站名 + 方位唯一：重复时拒绝；即时检查接口', async () => {
    const s = await create()
    const dup = await api.post('/api/stops').send(input()).expect(409)
    expect(dup.body).toMatchObject({ code: 'DUPLICATE', message: '已存在「人民广场（东）」，站名 + 方位不能重复' })
    await create({ direction: '西' })
    const chk = await api.get(
      `/api/stops/check-name?name=${encodeURIComponent('人民广场')}&direction=${encodeURIComponent('东')}`,
    )
    expect(chk.body).toMatchObject({ exists: true, stop: { id: s.id } })
    const self = await api.get(
      `/api/stops/check-name?name=${encodeURIComponent('人民广场')}&direction=${encodeURIComponent('东')}&excludeId=${s.id}`,
    )
    expect(self.body.exists).toBe(false)
  })

  it('字段校验：方位、英文名、字典类别、地标上限、扩展字段', async () => {
    const bad = async (over: Record<string, unknown>, message: string | RegExp) => {
      const r = await api.post('/api/stops').send(input(over)).expect(400)
      expect(r.body.message).toMatch(message)
    }
    await bad({ direction: 'A1' }, /方位只能是/)
    await bad({ nameEn: '人民广场' }, /只允许英文字母/)
    await bad({ roadId: maintainer.id }, '路段不存在')
    await bad({ ext: { nope: 1 } }, '未知的扩展字段「nope」')
    await api
      .post('/api/ext-fields')
      .send({ owner: 'stop', key: 'area', name: '养护片区', type: 'select', options: ['甲', '乙'] })
    await bad({ ext: { area: '丙' } }, '「养护片区」只能从下拉选项中选择')
    await api.put('/api/settings/landmarks').send({ landmarkLimit: 1, autoMatch: true })
    const cat = (await api.post('/api/landmark-categories').send({ name: '公园', defaultRadius: 100 })).body
    const lm = (n: string) =>
      api.post('/api/landmarks').send({ name: n, categoryId: cat.id, points: [{ lng: 120.2, lat: 30.25, radius: 50 }] })
    const ids = [(await lm('A')).body.id, (await lm('B')).body.id]
    await bad({ landmarkIds: ids }, '地标最多绑定 1 个')
    // 编码模式下方位可以是任意文本
    await api.put('/api/settings/orientation').send({ mode: 'code' }).expect(200)
    await create({ direction: 'A1' })
  })

  it('扩展字段：按定义存值；停用字段的已有值保存时保留', async () => {
    const f = (await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '养护片区', type: 'text' }))
      .body
    const s = await create({ ext: { area: '解放片区' } })
    expect(s.ext).toEqual({ area: '解放片区' })
    await api.put(`/api/ext-fields/${f.id}`).send({ name: '养护片区', type: 'text', enabled: false }).expect(200)
    const saved = await api
      .put(`/api/stops/${s.id}`)
      .send(body(s, { ext: {}, remark: '改备注' }))
      .expect(200)
    expect(saved.body.item.ext).toEqual({ area: '解放片区' })
  })

  it('列表：筛选、分页、按拼音排序、经过线路', async () => {
    await create({ name: '人民广场' })
    await create({ name: '火车站', direction: '场站', roadId: null })
    await create({ name: '北门', direction: '南', nameEn: 'North Gate' })
    const s = await create({ name: '人民广场', direction: '西' })
    const line = await t.prisma.line.create({
      data: { name: '1路', number: 'G-1', mode: 'oneway', status: 'suspended' },
    })
    const r = await t.prisma.route.create({ data: { lineId: line.id, kind: 'oneway' } })
    await t.prisma.routeStop.create({ data: { routeId: r.id, stopId: s.id, seq: 1 } })

    const all = (await api.get('/api/stops').expect(200)).body
    expect(all.total).toBe(4)
    expect(all.items.map((x: { name: string; direction: string }) => `${x.name}${x.direction}`)).toEqual([
      '北门南',
      '火车站场站',
      '人民广场东',
      '人民广场西',
    ])
    expect(all.items[3].lines).toEqual([{ name: '1路', suspended: true }])
    const q = (await api.get(`/api/stops?q=${encodeURIComponent('north')}`)).body
    expect(q.items.map((x: { name: string }) => x.name)).toEqual(['北门'])
    const byRoad = (await api.get(`/api/stops?roadId=${road.id}&dir=${encodeURIComponent('西')}`)).body
    expect(byRoad.items.map((x: { direction: string }) => x.direction)).toEqual(['西'])
    const byLine = (await api.get(`/api/stops?line=${encodeURIComponent('1路')}`)).body
    expect(byLine.total).toBe(1)
    const page2 = (await api.get('/api/stops?page=2&size=3')).body
    expect(page2).toMatchObject({ total: 4, page: 2, size: 3 })
    expect(page2.items).toHaveLength(1)
    const sug = (await api.get(`/api/stops/suggest?q=${encodeURIComponent('人')}`)).body
    expect(sug).toEqual(['人民广场'])
  })
})
