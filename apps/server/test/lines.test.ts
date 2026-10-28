import type { LineDetail } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { ROUTE_REMOVAL_HOOK, type RouteRemovalHook } from '../src/lines/route-removal.hook'
import { createTestApp, type TestApp } from './helpers'

describe('线路（T2）', () => {
  let t: TestApp
  let api: Agent
  const removed: { routeIds: string[]; note: string }[] = []
  const hook: RouteRemovalHook = {
    onRoutesRemoved: async (_tx, input) => void removed.push(input),
    countAffected: async () => 0,
  }
  let s: Record<string, { id: string }>

  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ROUTE_REMOVAL_HOOK).useValue(hook))
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    removed.length = 0
    s = {}
    for (const [k, name, direction] of [
      ['a', '人民广场', '东'],
      ['b', '火车站', '场站'],
      ['c', '北门', '南'],
      ['d', '人民广场', '西'],
    ])
      s[k] = (await api.post('/api/stops').send({ name, direction, lng: 120.2, lat: 30.25 }).expect(201)).body.item
  })
  afterAll(() => t.close())

  const twoway = (over: Record<string, unknown> = {}) => ({
    name: 'K1路',
    number: 'K-0001',
    mode: 'twoway',
    fare: '2 元',
    routes: [
      {
        kind: 'up',
        serviceType: 'interval',
        serviceTime: '06:00–22:00',
        stops: [
          { stopId: s.a.id, times: ['06:00', '06:30'] },
          { stopId: s.b.id, times: ['06:10', '06:40'] },
          { stopId: s.c.id, times: [] },
        ],
      },
      { kind: 'down', stops: [{ stopId: s.c.id }, { stopId: s.b.id }, { stopId: s.d.id }] },
    ],
    ...over,
  })
  const create = async (over: Record<string, unknown> = {}) =>
    (await api.post('/api/lines').send(twoway(over)).expect(201)).body.item as LineDetail
  const bodyOf = (l: LineDetail, over: Record<string, unknown> = {}) => ({
    name: l.name,
    number: l.number,
    nameEn: l.nameEn,
    mode: l.mode,
    companyId: l.company?.id ?? null,
    ticketType: l.ticketType,
    fareSystemId: l.fareSystem?.id ?? null,
    fare: l.fare,
    ext: l.ext,
    rev: l.rev,
    routes: l.routes.map((r) => ({
      kind: r.kind,
      serviceType: r.serviceType,
      serviceTime: r.serviceTime,
      interval: r.interval,
      stops: r.stops.map((x) => ({ stopId: x.stop.id, times: x.times, ext: x.ext })),
    })),
    ...over,
  })
  const snaps = (id: string) =>
    t.prisma.snapshot.findMany({ where: { objectType: 'line', objectId: id }, orderBy: { createdAt: 'asc' } })

  it('新建双边线路：走向按模式排列，第几次途经实时计算，生成"新增"快照', async () => {
    const l = await create({
      routes: [
        twoway().routes[0],
        { kind: 'down', stops: [{ stopId: s.c.id }, { stopId: s.a.id }, { stopId: s.b.id }, { stopId: s.a.id }] },
      ],
    })
    expect(l.routes.map((r) => r.kind)).toEqual(['up', 'down'])
    expect(l.routes[1].stops.map((x) => x.pass)).toEqual([1, 1, 1, 2])
    expect(l.routes[0].stops[0].times).toEqual(['06:00', '06:30'])
    const sn = await snaps(l.id)
    expect(sn.map((x) => x.action)).toEqual(['create'])
    expect(
      (sn[0].content as { routes: { down: { stops: { id: string }[] } } }).routes.down.stops.map((x) => x.id),
    ).toEqual([`${s.c.id}#1`, `${s.a.id}#1`, `${s.b.id}#1`, `${s.a.id}#2`])
  })

  it('校验：走向与模式一致、至少 2 个站、线路名与管理编号唯一、时刻按先后排列', async () => {
    await create()
    const bad = async (over: Record<string, unknown>, status: number, message: RegExp) => {
      const r = await api
        .post('/api/lines')
        .send(twoway({ name: 'X路', number: 'X-1', ...over }))
        .expect(status)
      expect(r.body.message).toMatch(message)
    }
    await bad({ mode: 'oneway' }, 400, /单向线路的走向应为：单向/)
    await bad({ name: 'K1路' }, 409, /线路名「K1路」已存在/)
    await bad({ number: 'K-0001' }, 409, /管理编号「K-0001」已被「K1路」使用/)
    await bad(
      { routes: [twoway().routes[0], { kind: 'down', stops: [{ stopId: s.a.id }] }] },
      400,
      /每个走向至少要有 2 个站/,
    )
    await bad(
      {
        routes: [
          { kind: 'up', stops: [{ stopId: s.a.id, times: ['07:00', '06:00', '08:00', '05:00'] }, { stopId: s.b.id }] },
          twoway().routes[1],
        ],
      },
      400,
      /上行第 1 站的到站时刻没有按先后排列/,
    )
  })

  it('有效修改判定：原样保存、站点改名、重建路径站都不产生快照', async () => {
    const l = await create()
    const same = await api.put(`/api/lines/${l.id}`).send(bodyOf(l)).expect(200)
    expect(same.body.changed).toBe(false)
    expect(same.body.item.rev).toBe(1)
    // 站点改名：站点自己生成快照，线路不生成；线路再原样保存仍没有变化
    const stop = (await api.get(`/api/stops/${s.b.id}`)).body
    await api
      .put(`/api/stops/${s.b.id}`)
      .send({ name: '火车东站', direction: '场站', lng: 120.2, lat: 30.25, rev: stop.rev })
      .expect(200)
    expect(await snaps(l.id)).toHaveLength(1)
    const again = await api.put(`/api/lines/${l.id}`).send(bodyOf(l)).expect(200)
    expect(again.body.changed).toBe(false)
    expect(again.body.item.routes[0].stops[1].stop.name).toBe('火车东站')
    // 真正修改
    const body = bodyOf(l)
    body.routes[0].stops[2].times = ['06:20']
    const changed = await api.put(`/api/lines/${l.id}`).send(body).expect(200)
    expect(changed.body).toMatchObject({ changed: true, item: { rev: 2 } })
    const sn = await snaps(l.id)
    expect(sn.map((x) => [x.action, x.note])).toEqual([
      ['create', ''],
      ['update', '修改：上行 · 站序'],
    ])
  })

  it('并发保护：旧 rev 保存返回 409 并带最新内容', async () => {
    const l = await create()
    await api
      .put(`/api/lines/${l.id}`)
      .send(bodyOf(l, { fare: '1 元' }))
      .expect(200)
    const r = await api
      .put(`/api/lines/${l.id}`)
      .send(bodyOf(l, { fare: '3 元' }))
      .expect(409)
    expect(r.body.code).toBe('CONFLICT')
    expect(r.body.details.latest).toMatchObject({ rev: 2, fare: '1 元' })
  })

  it('改模式：第 1 个走向原地改名并保留 ID，多余走向删除并调用 M3 接口', async () => {
    const l = await create()
    const [up, down] = l.routes
    const body = bodyOf(l, { mode: 'oneway' })
    body.routes = [{ ...body.routes[0], kind: 'oneway' }]
    const res = await api.put(`/api/lines/${l.id}`).send(body).expect(200)
    const after = res.body.item as LineDetail
    expect(after.routes.map((r) => [r.kind, r.id])).toEqual([['oneway', up.id]])
    expect(after.routes[0].stops).toHaveLength(3)
    expect(removed).toEqual([{ routeIds: [down.id], note: '修改线路 K1路 的模式，删除走向 下行，连带移除编排' }])
    expect(await t.prisma.route.count({ where: { id: down.id } })).toBe(0)
    const sn = await snaps(l.id)
    expect(sn[1].note).toContain('线路模式')
  })

  it('停运与恢复：带 rev，线路自身各存一份"修改"快照；站点列表显示停运', async () => {
    const l = await create()
    const sus = await api.post(`/api/lines/${l.id}/suspend`).send({ rev: l.rev }).expect(200)
    expect(sus.body).toMatchObject({ changed: true, item: { status: 'suspended', rev: 2 } })
    await api.post(`/api/lines/${l.id}/resume`).send({ rev: 1 }).expect(409)
    const stops = (await api.get('/api/stops')).body.items
    expect(stops.find((x: { id: string }) => x.id === s.a.id).lines).toEqual([
      { id: l.id, name: 'K1路', suspended: true },
    ])
    await api.post(`/api/lines/${l.id}/resume`).send({ rev: 2 }).expect(200)
    const sn = await snaps(l.id)
    expect(sn.map((x) => x.note)).toEqual(['', '停运', '恢复运营'])
    // 只有线路自己生成快照
    expect(await t.prisma.snapshot.count({ where: { objectType: { not: 'line' }, action: 'update' } })).toBe(0)
  })

  it('删除线路：删除全部走向与站序，调用 M3 接口，存"删除"快照并出现在已删除视图', async () => {
    const l = await create()
    const check = await api.get(`/api/lines/${l.id}/delete-check`).expect(200)
    expect(check.body).toEqual({ routes: 2, stops: 4, affectedSignSets: 0 })
    await api.delete(`/api/lines/${l.id}`).expect(204)
    expect(await t.prisma.route.count()).toBe(0)
    expect(removed).toEqual([{ routeIds: l.routes.map((r) => r.id), note: '删除线路 K1路，连带移除编排' }])
    expect((await snaps(l.id)).map((x) => x.action)).toEqual(['create', 'delete'])
    const del = await api.get('/api/snapshots/deleted?type=line').expect(200)
    expect(del.body.items).toEqual([expect.objectContaining({ objectId: l.id, objectName: 'K1路' })])
    // 站点现在可以删除
    await api.delete(`/api/stops/${s.d.id}`).expect(204)
  })

  it('列表默认按自动排序规则（需求 5.5.6）；按站点、模式、状态筛选；带起终点与站数', async () => {
    const names = ['K12路', '夜1路', 'B2路', '10路', 'K', '1路', 'K1路', '2路', 'B1路']
    for (const [i, name] of names.entries()) await create({ name, number: `N-${i}` })
    const all = (await api.get('/api/lines?size=50').expect(200)).body
    expect(all.items.map((x: { name: string }) => x.name)).toEqual([
      '1路',
      '2路',
      '10路',
      '夜1路',
      'B1路',
      'B2路',
      'K',
      'K1路',
      'K12路',
    ])
    expect(all.items[0].routes[0]).toMatchObject({ kind: 'up', count: 3, origin: '人民广场', terminal: '北门' })
    const page2 = (await api.get('/api/lines?size=4&page=2')).body
    expect(page2.items.map((x: { name: string }) => x.name)).toEqual(['B1路', 'B2路', 'K', 'K1路'])
    await create({
      name: '33路',
      number: 'N-33',
      mode: 'loop',
      routes: [{ kind: 'loop', stops: [{ stopId: s.c.id }, { stopId: s.b.id }, { stopId: s.c.id }] }],
    })
    expect((await api.get('/api/lines?mode=loop')).body.items.map((x: { name: string }) => x.name)).toEqual(['33路'])
    expect((await api.get(`/api/lines?stopId=${s.d.id}`)).body.total).toBe(9)
    const sus = (await api.get('/api/lines?status=suspended')).body
    expect(sus.total).toBe(0)
  })

  it('换乘：该走向每一站可换乘的其他线路', async () => {
    const a = await create()
    await create({ name: '2路', number: 'G-2' })
    const tr = (await api.get(`/api/lines/${a.id}/transfers?routeId=${a.routes[0].id}`).expect(200)).body
    expect(tr).toEqual([
      { stopId: s.a.id, lines: [expect.objectContaining({ name: '2路' })] },
      { stopId: s.b.id, lines: [expect.objectContaining({ name: '2路' })] },
      { stopId: s.c.id, lines: [expect.objectContaining({ name: '2路' })] },
    ])
  })

  it('路径站扩展字段：重建路径站时保留已停用字段的值', async () => {
    const f = (
      await api.post('/api/ext-fields').send({ owner: 'routeStop', key: 'gate', name: '站台口', type: 'text' })
    ).body
    const body = twoway()
    ;(body.routes[0].stops[0] as { ext?: object }).ext = { gate: 'B 口' }
    const l = (await api.post('/api/lines').send(body).expect(201)).body.item as LineDetail
    expect(l.routes[0].stops[0].ext).toEqual({ gate: 'B 口' })
    await api.put(`/api/ext-fields/${f.id}`).send({ name: '站台口', type: 'text', enabled: false }).expect(200)
    const b2 = bodyOf(l)
    b2.routes[0].stops[0].ext = {}
    b2.fare = '3 元'
    const saved = (await api.put(`/api/lines/${l.id}`).send(b2).expect(200)).body.item as LineDetail
    expect(saved.routes[0].stops[0].ext).toEqual({ gate: 'B 口' })
  })

  it('站名 + 方位批量匹配', async () => {
    const r = await api
      .post('/api/stops/match')
      .send({
        rows: [
          { name: '人民广场', direction: '西' },
          { name: '不存在', direction: '东' },
        ],
      })
      .expect(200)
    expect(r.body).toEqual([
      {
        index: 0,
        name: '人民广场',
        direction: '西',
        stop: { id: s.d.id, name: '人民广场', direction: '西', lng: 120.2, lat: 30.25 },
      },
      { index: 1, name: '不存在', direction: '东', stop: null },
    ])
  })

  it('线路名、管理编号重复的即时检查', async () => {
    const l = await create()
    expect((await api.get(`/api/lines/check-name?name=${encodeURIComponent('K1路')}`)).body.exists).toBe(true)
    expect(
      (await api.get(`/api/lines/check-name?name=${encodeURIComponent('K1路')}&excludeId=${l.id}`)).body.exists,
    ).toBe(false)
    expect((await api.get('/api/lines/check-number?number=K-0001')).body.line).toMatchObject({ name: 'K1路' })
  })
})
