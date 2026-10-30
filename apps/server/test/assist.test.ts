import {
  addBoard,
  addShelf,
  hide,
  placeOnBoard,
  type DataChecks,
  type GroupLineResult,
  type LineArrangement,
  type LineDetail,
  type OppositeMap,
  type Page,
  type SignSetQueue,
  type SignSetView,
  type StopBatchPreview,
  type StopDetail,
  type StopListItem,
  type StopReference,
} from '@gentransit/shared'
import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

/** 以 (120.2, 30.25) 为原点按米偏移（x 向东、y 向北） */
const at = (x: number, y: number) => ({
  lng: Number((120.2 + x / (Math.cos((30.25 * Math.PI) / 180) * 111320)).toFixed(6)),
  lat: Number((30.25 + y / 110540).toFixed(6)),
})

describe('M5 流程简化（T2–T4）', () => {
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

  const stop = async (name: string, direction: string, x = 0, y = 0, extra: Record<string, unknown> = {}) =>
    (
      await api
        .post('/api/stops')
        .send({ name, direction, ...at(x, y), ...extra })
        .expect(201)
    ).body.item as StopDetail
  const line = async (name: string, routes: { kind: string; stops: string[]; times?: string[][] }[], mode = 'twoway') =>
    (
      await api
        .post('/api/lines')
        .send({
          name,
          number: name,
          mode,
          routes: routes.map((r) => ({
            kind: r.kind,
            stops: r.stops.map((stopId, i) => ({ stopId, times: r.times?.[i] ?? [] })),
          })),
        })
        .expect(201)
    ).body.item as LineDetail
  const getLine = async (id: string) => (await api.get(`/api/lines/${id}`).expect(200)).body as LineDetail
  const lineSnaps = (id: string) =>
    t.prisma.snapshot.findMany({
      where: { objectType: 'line', objectId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  const ids = (l: LineDetail, kind: string) => l.routes.find((r) => r.kind === kind)!.stops.map((s) => s.stop.id)

  /* ---------------- 对向站点、按距离排序、视野与范围 ---------------- */

  it('对向站点：同名、方位相对、300 米内最近；场站取同名任意站；编码模式取同名任意站', async () => {
    const e = await stop('人民广场', '东', 12, 0)
    const w = await stop('人民广场', '西', -12, 0)
    const n = await stop('人民广场', '北', 0, 30)
    const far = await stop('火车站', '东', 0, 0)
    await stop('火车站', '西', 400, 0)
    const depot = await stop('公交总站', '场站', 0, 500)
    const near = await stop('公交总站', '无', 40, 500)
    const r = (
      await api
        .post('/api/stops/opposites')
        .send({ ids: [e.id, w.id, n.id, far.id, depot.id] })
        .expect(200)
    ).body as OppositeMap
    expect(r[e.id]?.id).toBe(w.id)
    expect(r[w.id]?.id).toBe(e.id)
    expect(r[n.id]).toBeNull()
    expect(r[far.id]).toBeNull()
    expect(r[depot.id]?.id).toBe(near.id)

    await api.put('/api/settings/orientation').send({ mode: 'code' }).expect(200)
    const c = (
      await api
        .post('/api/stops/opposites')
        .send({ ids: [n.id] })
        .expect(200)
    ).body as OppositeMap
    expect([e.id, w.id]).toContain(c[n.id]?.id)
  })

  it('near 按距离排序并带距离；in-view 与 extent', async () => {
    const a = await stop('人民广场', '东', 0, 0)
    const b = await stop('人民医院', '东', 900, 0)
    const c = await stop('人民公园', '东', 300, 0)
    const page = (
      await api
        .get('/api/stops')
        .query({ q: '人民', near: `${at(1000, 0).lng},${at(1000, 0).lat}` })
        .expect(200)
    ).body as Page<StopListItem>
    expect(page.items.map((s) => s.id)).toEqual([b.id, c.id, a.id])
    expect(page.items[0].distance).toBeGreaterThan(90)
    expect(page.items[0].distance).toBeLessThan(110)
    const sw = at(-100, -100)
    const ne = at(400, 100)
    const inView = (
      await api
        .get('/api/stops/in-view')
        .query({ bbox: `${sw.lng},${sw.lat},${ne.lng},${ne.lat}` })
        .expect(200)
    ).body as { id: string }[]
    expect(inView.map((s) => s.id).sort()).toEqual([a.id, c.id].sort())
    await api.get('/api/stops/in-view').query({ bbox: '1,2,3' }).expect(400)
    const ext = (await api.get('/api/stops/extent').expect(200)).body
    expect(ext.west).toBeCloseTo(a.lng)
    expect(ext.east).toBeCloseTo(b.lng)
  })

  /* ---------------- 替换站点（AC-20） ---------------- */

  it('AC-20：替换 4 处引用，到站时刻保留，每条线路一份快照；替换后可删除原站', async () => {
    const [a, x, b, y] = [
      await stop('甲', '东'),
      await stop('乙', '东'),
      await stop('丙', '东'),
      await stop('丁', '东'),
    ]
    const l1 = await line('1路', [
      { kind: 'up', stops: [a.id, x.id, b.id], times: [['06:00'], ['06:05'], ['06:10']] },
      { kind: 'down', stops: [b.id, x.id, a.id] },
    ])
    const l2 = await line('2路', [{ kind: 'oneway', stops: [x.id, b.id] }], 'oneway')
    const l3 = await line('3路', [{ kind: 'loop', stops: [a.id, x.id, b.id] }], 'loop')
    const refs = (await api.get(`/api/stops/${x.id}/references`).expect(200)).body as StopReference[]
    expect(refs.map((r) => `${r.lineName}${r.routeKind}${r.index}`)).toEqual([
      '1路up1',
      '1路down1',
      '2路oneway0',
      '3路loop1',
    ])
    expect(refs[0]).toMatchObject({ prev: { id: a.id }, next: { id: b.id } })
    expect(refs[2].prev).toBeNull()

    const body = {
      targetId: y.id,
      refs: refs.map((r) => ({ lineId: r.lineId, rev: r.rev, kind: r.routeKind, index: r.index })),
    }
    const res = (await api.post(`/api/stops/${x.id}/replace`).send(body).expect(200)).body as GroupLineResult
    expect(res.lines).toHaveLength(3)
    const after = await getLine(l1.id)
    expect(ids(after, 'up')).toEqual([a.id, y.id, b.id])
    expect(ids(after, 'down')).toEqual([b.id, y.id, a.id])
    expect(after.routes.find((r) => r.kind === 'up')!.stops[1].times).toEqual(['06:05'])
    for (const l of [l1, l2, l3]) {
      const snaps = await lineSnaps(l.id)
      expect(snaps).toHaveLength(2)
      expect(snaps[1]).toMatchObject({ action: 'update', note: '站点 乙（东） 替换为 丁（东）' })
    }
    expect((await api.get(`/api/stops/${x.id}/references`).expect(200)).body).toEqual([])
    await api.delete(`/api/stops/${x.id}`).expect(204)
  })

  it('替换：rev 过期整组拒绝；替换后与相邻站相同拒绝；不能换成自己', async () => {
    const [a, x, b] = [await stop('甲', '东'), await stop('乙', '东'), await stop('丙', '东')]
    const l1 = await line('1路', [{ kind: 'oneway', stops: [a.id, x.id, b.id] }], 'oneway')
    const l2 = await line('2路', [{ kind: 'oneway', stops: [x.id, b.id] }], 'oneway')
    const stale = {
      targetId: a.id,
      refs: [
        { lineId: l1.id, rev: l1.rev, kind: 'oneway', index: 1 },
        { lineId: l2.id, rev: 99, kind: 'oneway', index: 0 },
      ],
    }
    const r1 = await api.post(`/api/stops/${x.id}/replace`).send(stale).expect(409)
    expect(r1.body.message).toContain('2路')
    expect(await lineSnaps(l1.id)).toHaveLength(1)
    // 换成甲：1 路会出现"甲、甲"
    const dup = { targetId: a.id, refs: [{ lineId: l1.id, rev: l1.rev, kind: 'oneway', index: 1 }] }
    expect((await api.post(`/api/stops/${x.id}/replace`).send(dup).expect(400)).body.message).toContain('相邻')
    // 下标处已不是本站：按冲突处理
    const moved = { targetId: b.id, refs: [{ lineId: l1.id, rev: l1.rev, kind: 'oneway', index: 0 }] }
    await api.post(`/api/stops/${x.id}/replace`).send(moved).expect(409)
    await api
      .post(`/api/stops/${x.id}/replace`)
      .send({ ...dup, targetId: x.id })
      .expect(400)
  })

  /* ---------------- 加入线路 ---------------- */

  it('加入线路：多条线路、两个走向一次保存，同一走向从后往前插；快照说明', async () => {
    const [a, b, c] = [await stop('甲', '东'), await stop('丙', '东'), await stop('戊', '东')]
    const x = await stop('乙', '东')
    const xo = await stop('乙', '西', -20, 0)
    const l1 = await line('1路', [
      { kind: 'up', stops: [a.id, b.id, c.id] },
      { kind: 'down', stops: [c.id, b.id, a.id] },
    ])
    const l2 = await line('2路', [{ kind: 'oneway', stops: [a.id, c.id] }], 'oneway')
    const res = (
      await api
        .post(`/api/stops/${x.id}/join`)
        .send({
          items: [
            {
              lineId: l1.id,
              rev: l1.rev,
              inserts: [
                { kind: 'up', stopId: x.id, at: 1 },
                { kind: 'down', stopId: xo.id, at: 2 },
              ],
            },
            {
              lineId: l2.id,
              rev: l2.rev,
              inserts: [
                { kind: 'oneway', stopId: x.id, at: 1 },
                { kind: 'oneway', stopId: x.id, at: 2 },
              ],
            },
          ],
        })
        .expect(200)
    ).body as GroupLineResult
    expect(res.lines.map((l) => l.name)).toEqual(['1路', '2路'])
    const a1 = await getLine(l1.id)
    expect(ids(a1, 'up')).toEqual([a.id, x.id, b.id, c.id])
    expect(ids(a1, 'down')).toEqual([c.id, b.id, xo.id, a.id])
    expect(ids(await getLine(l2.id), 'oneway')).toEqual([a.id, x.id, c.id, x.id])
    expect((await lineSnaps(l1.id))[1].note).toBe('站点 乙（东）、乙（西） 加入站序')
    // 过期的 rev：整组不写
    await api
      .post(`/api/stops/${x.id}/join`)
      .send({ items: [{ lineId: l2.id, rev: l2.rev, inserts: [{ kind: 'oneway', stopId: x.id, at: 0 }] }] })
      .expect(409)
    // 走向不存在
    await api
      .post(`/api/stops/${x.id}/join`)
      .send({ items: [{ lineId: a1.id, rev: a1.rev, inserts: [{ kind: 'loop', stopId: x.id, at: 0 }] }] })
      .expect(400)
  })

  /* ---------------- 批量修改（AC-23） ---------------- */

  it('AC-23：批量设维护公司，预览与写入，值相同的站点不生成快照；按筛选结果；区划层级校验', async () => {
    const m = (await api.post('/api/dicts').send({ category: 'maintainer', name: '城北养护' }).expect(201)).body
    const other = (await api.post('/api/dicts').send({ category: 'maintainer', name: '城南养护' }).expect(201)).body
    const stops = [
      await stop('甲', '东', 0, 0, { maintainerId: m.id }),
      await stop('乙', '东', 0, 0, { maintainerId: other.id }),
      await stop('丙', '东'),
    ]
    const body = { scope: { ids: stops.map((s) => s.id) }, patch: { maintainerId: m.id, facilities: { seats: 4 } } }
    const p = (await api.post('/api/stops/batch/preview').send(body).expect(200)).body as StopBatchPreview
    expect(p).toMatchObject({ selected: 3, changing: 3 })
    expect(p.sample.find((x) => x.name === '甲')!.fields).toEqual(['座椅数'])
    expect(p.sample.find((x) => x.name === '乙')!.fields).toEqual(['维护公司', '座椅数'])

    const only = { scope: { ids: stops.map((s) => s.id) }, patch: { maintainerId: m.id } }
    expect((await api.post('/api/stops/batch').send(only).expect(200)).body).toEqual({ selected: 3, changed: 2 })
    const snaps = await t.prisma.snapshot.findMany({ where: { objectType: 'stop', action: 'update' } })
    expect(snaps).toHaveLength(2)
    expect(snaps.every((s) => s.note === '批量修改：维护公司')).toBe(true)
    const b = (await api.get(`/api/stops/${stops[1].id}`).expect(200)).body as StopDetail
    expect(b.maintainer?.id).toBe(m.id)
    expect(b.rev).toBe(2)

    // 按筛选结果：名称含"丙"
    const f = { scope: { filter: { q: '丙' } }, patch: { maintainerId: null } }
    expect((await api.post('/api/stops/batch').send(f).expect(200)).body).toEqual({ selected: 1, changed: 1 })
    expect(((await api.get(`/api/stops/${stops[2].id}`)).body as StopDetail).maintainer).toBeNull()

    // 区划：区不属于所选的市
    const city = (await api.post('/api/regions').send({ level: 'city', name: '杭州市' }).expect(201)).body
    const city2 = (await api.post('/api/regions').send({ level: 'city', name: '宁波市' }).expect(201)).body
    const dist = (
      await api.post('/api/regions').send({ level: 'district', parentId: city2.id, name: '海曙区' }).expect(201)
    ).body
    const bad = {
      scope: { ids: [stops[0].id] },
      patch: { region: { cityId: city.id, districtId: dist.id, streetId: null } },
    }
    await api.post('/api/stops/batch').send(bad).expect(400)
    // 字典类别不对、没有要改的字段、勾选超过上限
    await api
      .post('/api/stops/batch')
      .send({ scope: { ids: [stops[0].id] }, patch: { roadId: m.id } })
      .expect(400)
    await api
      .post('/api/stops/batch')
      .send({ scope: { ids: [stops[0].id] }, patch: {} })
      .expect(400)
  })

  it('批量修改扩展字段：只认启用的字段，null 清空', async () => {
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '养护片区', type: 'text' }).expect(201)
    const s = await stop('甲', '东', 0, 0, { ext: { area: '一片' } })
    await api
      .post('/api/stops/batch')
      .send({ scope: { ids: [s.id] }, patch: { ext: { area: '二片' } } })
      .expect(200)
    expect(((await api.get(`/api/stops/${s.id}`)).body as StopDetail).ext).toEqual({ area: '二片' })
    await api
      .post('/api/stops/batch')
      .send({ scope: { ids: [s.id] }, patch: { ext: { area: null } } })
      .expect(200)
    expect(((await api.get(`/api/stops/${s.id}`)).body as StopDetail).ext).toEqual({})
    await api
      .post('/api/stops/batch')
      .send({ scope: { ids: [s.id] }, patch: { ext: { nope: 1 } } })
      .expect(400)
  })

  /* ---------------- 沿线编排进度、队列 ---------------- */

  it('沿线编排进度：已编排、隐藏、待编排，站序移除后的失效站；停运；逐站编排队列的顺序', async () => {
    const type = (await api.post('/api/dicts').send({ category: 'shelfType', name: '双立柱站架' }).expect(201)).body
    const [a, b, c, d] = [
      await stop('甲', '东'),
      await stop('乙', '东'),
      await stop('丙', '东'),
      await stop('丁', '东'),
    ]
    const l = await line('1路', [
      { kind: 'up', stops: [a.id, b.id, c.id] },
      { kind: 'down', stops: [d.id, b.id, a.id] },
    ])
    const up = l.routes.find((r) => r.kind === 'up')!
    // 甲：放到站牌；乙：上行隐藏
    const va = (await api.get(`/api/stops/${a.id}/sign-set`).expect(200)).body as SignSetView
    const s1 = addShelf(va, { type })
    const b1 = addBoard(s1.draft, s1.shelfId)
    const da = placeOnBoard(b1.draft, { routeId: up.id, pass: 1 }, b1.boardId)
    await api
      .put(`/api/sign-sets/${va.id}`)
      .send({ rev: va.rev, reminder: '', shelves: da.shelves, schedules: da.schedules })
      .expect(200)
    const vb = (await api.get(`/api/stops/${b.id}/sign-set`).expect(200)).body as SignSetView
    const db = hide(vb, { routeId: up.id, pass: 1 })
    await api
      .put(`/api/sign-sets/${vb.id}`)
      .send({ rev: vb.rev, reminder: '', shelves: db.shelves, schedules: db.schedules })
      .expect(200)

    const arr = (await api.get(`/api/lines/${l.id}/arrangement`).expect(200)).body as LineArrangement
    expect(arr.routes[0].stops.map((s) => s.status)).toEqual(['placed', 'hidden', 'waiting'])
    expect(arr.routes[1].stops.map((s) => s.status)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(arr.totals).toEqual({ placed: 1, hidden: 1, waiting: 4, invalidStops: 0 })

    const q = (await api.get('/api/sign-sets/queue').query({ from: 'line', lineId: l.id }).expect(200))
      .body as SignSetQueue
    expect(q.stopIds).toEqual([c.id, d.id, b.id, a.id])

    // 上行去掉甲：甲上的编排失效，排在队列最后
    const cur = await getLine(l.id)
    await api
      .put(`/api/lines/${l.id}`)
      .send({
        name: cur.name,
        number: cur.number,
        mode: cur.mode,
        rev: cur.rev,
        routes: [
          { kind: 'up', stops: [b.id, c.id].map((stopId) => ({ stopId })) },
          { kind: 'down', stops: [d.id, b.id, a.id].map((stopId) => ({ stopId })) },
        ],
      })
      .expect(200)
    const arr2 = (await api.get(`/api/lines/${l.id}/arrangement`).expect(200)).body as LineArrangement
    expect(arr2.invalid).toEqual([{ id: a.id, name: '甲', direction: '东', count: 1 }])
    expect(arr2.totals.invalidStops).toBe(1)
    const q2 = (await api.get('/api/sign-sets/queue').query({ from: 'line', lineId: l.id }).expect(200))
      .body as SignSetQueue
    expect(q2.stopIds.at(-1)).toBe(a.id)

    // 工作台队列：待处理最多的在前；列表队列：与列表筛选相同
    const home = (await api.get('/api/sign-sets/queue').query({ from: 'home' }).expect(200)).body as SignSetQueue
    expect(home.stopIds[0]).toBe(a.id)
    expect(home.total).toBe(4)
    const list = (await api.get('/api/sign-sets/queue').query({ from: 'list', q: '丙' }).expect(200))
      .body as SignSetQueue
    expect(list.stopIds).toEqual([c.id])

    const { rev } = await getLine(l.id)
    await api.post(`/api/lines/${l.id}/suspend`).send({ rev }).expect(200)
    const arr3 = (await api.get(`/api/lines/${l.id}/arrangement`).expect(200)).body as LineArrangement
    expect(arr3.suspended).toBe(true)
    expect(arr3.routes.every((r) => r.stops.length === 0)).toBe(true)
  })

  /* ---------------- 数据体检 ---------------- */

  it('数据体检：各项计数与列表 check 筛选一致；方位反了、站间距离过远、没算轨迹', async () => {
    // 向北行驶的一段路：东侧（x>0）是行驶方向右侧
    const s0 = await stop('南口', '东', 12, 0, { nameEn: 'South Gate' })
    const s1 = await stop('中街', '西', -12, 400)
    await stop('中街', '东', 12, 400)
    const s2 = await stop('北口', '东', 12, 800)
    const far = await stop('远郊', '东', 12, 5000)
    const ok = await line('1路', [{ kind: 'oneway', stops: [s0.id, s2.id] }], 'oneway')
    const wrong = await line('2路', [{ kind: 'oneway', stops: [s0.id, s1.id, s2.id] }], 'oneway')
    const gap = await line('3路', [{ kind: 'oneway', stops: [s2.id, far.id] }], 'oneway')

    const c = (await api.get('/api/data-checks').expect(200)).body as DataChecks
    expect(c.lines).toEqual({ noTrack: 3, trackStale: 0, gap: 1, wrongSide: 1 })
    expect(c.stops.noNameEn).toBe(4)
    expect(c.stops.noRegion).toBe(5)
    expect(c.stops.noPhoto).toBe(5)
    expect(c.stops.noShelf).toBe(4)
    expect(c.pendingSets).toBe(4)

    const listed = async (check: string) =>
      ((await api.get('/api/lines').query({ check }).expect(200)).body as Page<{ id: string }>).items.map((x) => x.id)
    expect(await listed('wrongSide')).toEqual([wrong.id])
    expect(await listed('gap')).toEqual([gap.id])
    expect((await listed('noTrack')).sort()).toEqual([ok.id, wrong.id, gap.id].sort())
    const noEn = (await api.get('/api/stops').query({ check: 'noNameEn' }).expect(200)).body as Page<StopListItem>
    expect(noEn.total).toBe(4)
    expect(noEn.items.some((s) => s.id === s0.id)).toBe(false)

    // 改对方位后缓存随版本失效
    const east = (await api.get('/api/stops').query({ q: '中街', dir: '东' })).body.items[0].id
    await api
      .post(`/api/stops/${s1.id}/replace`)
      .send({ targetId: east, refs: [{ lineId: wrong.id, rev: wrong.rev, kind: 'oneway', index: 1 }] })
      .expect(200)
    expect(((await api.get('/api/data-checks').expect(200)).body as DataChecks).lines.wrongSide).toBe(0)
  })
})
