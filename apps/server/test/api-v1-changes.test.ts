import {
  addBoard,
  addShelf,
  placeOnBoard,
  type ApiTokenCreated,
  type ImportJobView,
  type LineDetail,
  type SignSetView,
  type StopDetail,
  type V1Page,
} from '@gentransit/shared'
import request, { type Agent } from 'supertest'
import { workbookBuffer, type SheetSpec } from '../src/import/excel'
import { createTestApp, type TestApp } from './helpers'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const sheet = (name: string, header: string[], rows: (string | number | null)[][]): SheetSpec => ({
  name,
  columns: header.map((h) => ({ header: h })),
  rows,
})
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** "有变化"的口径（M4 计划 3.4、3.5 节） */
describe('只读 API 的"有变化"（M4 T3）', () => {
  let t: TestApp
  let api: Agent
  let token: ApiTokenCreated
  let s: Record<'a' | 'b' | 'c' | 'x', StopDetail>

  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    token = (await api.post('/api/api-tokens').send({ name: '同步' }).expect(201)).body
    const mk = async (name: string, direction: string) =>
      (await api.post('/api/stops').send({ name, direction, lng: 120.2, lat: 30.25 }).expect(201)).body
        .item as StopDetail
    s = {
      a: await mk('人民广场', '东'),
      b: await mk('火车站', '场站'),
      c: await mk('北门', '南'),
      x: await mk('新站', '北'),
    }
  })
  afterAll(() => t.close())

  const stopUpdated = async (id: string) => (await t.prisma.stop.findUniqueOrThrow({ where: { id } })).updatedAt
  const lineUpdated = async (id: string) => (await t.prisma.line.findUniqueOrThrow({ where: { id } })).updatedAt
  /** 各站点站牌集的 changedAt */
  const clocks = async () =>
    Object.fromEntries(
      await Promise.all(
        (Object.keys(s) as (keyof typeof s)[]).map(
          async (k) =>
            [k, (await t.prisma.signSet.findUniqueOrThrow({ where: { stopId: s[k].id } })).changedAt] as const,
        ),
      ),
    ) as Record<keyof typeof s, Date>
  /** 与之前相比 changedAt 变了的站点 */
  const moved = async (before: Record<keyof typeof s, Date>) => {
    const now = await clocks()
    return (Object.keys(now) as (keyof typeof s)[]).filter((k) => now[k].getTime() !== before[k].getTime()).sort()
  }
  const step = async () => {
    await sleep(5)
    const c = await clocks()
    await sleep(5)
    return c
  }
  const line = async (body: Record<string, unknown>) =>
    (await api.post('/api/lines').send(body).expect(201)).body.item as LineDetail
  const twoway = (up: string[], down: string[]) =>
    line({
      name: 'K1路',
      number: 'K-1',
      mode: 'twoway',
      routes: [
        { kind: 'up', stops: up.map((stopId) => ({ stopId })) },
        { kind: 'down', stops: down.map((stopId) => ({ stopId })) },
      ],
    })
  const lineBody = (l: LineDetail, over: Record<string, unknown> = {}) => ({
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
  const putLine = async (l: LineDetail, over: Record<string, unknown>) =>
    (await api.put(`/api/lines/${l.id}`).send(lineBody(l, over)).expect(200)).body.item as LineDetail
  const stopBody = (x: StopDetail, over: Record<string, unknown> = {}) => ({
    name: x.name,
    direction: x.direction,
    nameEn: x.nameEn,
    lng: x.lng,
    lat: x.lat,
    remark: x.remark,
    roadId: x.road?.id ?? null,
    rev: x.rev,
    ...over,
  })
  const upload = async (kind: 'stop' | 'line', buf: Buffer) =>
    (
      await api
        .post(`/api/import/${kind}`)
        .attach('file', buf, { filename: `${kind}.xlsx`, contentType: XLSX })
        .expect(201)
    ).body as ImportJobView
  const confirm = (id: string) => api.post(`/api/import/${id}/confirm`).expect(200)

  /* ---------------- 主行的 updatedAt ---------------- */

  it('站点：表单保存与导入修改都会更新；没有变化的保存不更新；被引用的路段改名不更新', async () => {
    const road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' }).expect(201)).body
    const a = (
      await api
        .put(`/api/stops/${s.a.id}`)
        .send(stopBody(s.a, { roadId: road.id }))
        .expect(200)
    ).body.item as StopDetail
    let at = await stopUpdated(s.a.id)
    await sleep(5)
    const same = await api.put(`/api/stops/${s.a.id}`).send(stopBody(a)).expect(200)
    expect(same.body.changed).toBe(false)
    expect(await stopUpdated(s.a.id)).toEqual(at)
    await api.put(`/api/dicts/${road.id}`).send({ name: '解放大道' }).expect(200)
    expect(await stopUpdated(s.a.id)).toEqual(at)

    await api
      .put(`/api/stops/${s.a.id}`)
      .send(stopBody(a, { remark: '表单改' }))
      .expect(200)
    expect((await stopUpdated(s.a.id)).getTime()).toBeGreaterThan(at.getTime())
    at = await stopUpdated(s.a.id)
    await sleep(5)
    const header = ['站名*', '方位*', '英文名', '经度', '纬度', '市', '区', '街道', '路段', '维护公司', '备注']
    const job = await upload(
      'stop',
      await workbookBuffer([
        sheet('站点', header, [['人民广场', '东', null, 120.2, 30.25, null, null, null, '解放大道', null, '导入改']]),
      ]),
    )
    expect(job.preview.updated).toHaveLength(1)
    await confirm(job.id)
    expect((await stopUpdated(s.a.id)).getTime()).toBeGreaterThan(at.getTime())
  })

  it('线路：只改路径站、改模式删走向、导入修改都会更新主行', async () => {
    let l = await twoway([s.a.id, s.b.id], [s.b.id, s.a.id])
    let at = await lineUpdated(l.id)
    await sleep(5)
    l = await putLine(l, {
      routes: lineBody(l).routes.map((r, i) => (i === 0 ? { ...r, stops: [...r.stops, { stopId: s.c.id }] } : r)),
    })
    expect((await lineUpdated(l.id)).getTime()).toBeGreaterThan(at.getTime())

    at = await lineUpdated(l.id)
    await sleep(5)
    l = await putLine(l, { mode: 'oneway', routes: [{ ...lineBody(l).routes[0], kind: 'oneway' }] })
    expect(l.routes.map((r) => r.kind)).toEqual(['oneway'])
    expect((await lineUpdated(l.id)).getTime()).toBeGreaterThan(at.getTime())

    at = await lineUpdated(l.id)
    await sleep(5)
    const RS_HEADER = ['管理编号*', '走向*', '序号*', '站名*', '方位*', '到站时刻']
    const job = await upload(
      'line',
      await workbookBuffer([
        sheet('路径站', RS_HEADER, [
          ['K-1', '单向', 1, '人民广场', '东'],
          ['K-1', '单向', 2, '北门', '南'],
        ]),
      ]),
    )
    expect(job.preview.updated).toHaveLength(1)
    await confirm(job.id)
    expect((await lineUpdated(l.id)).getTime()).toBeGreaterThan(at.getTime())
  })

  it('地标：只改位置点也会更新；地标类别改名不更新地标', async () => {
    const cat = (await api.post('/api/landmark-categories').send({ name: '医院', defaultRadius: 300 }).expect(201)).body
    const lm = (
      await api
        .post('/api/landmarks')
        .send({ name: '人民医院', categoryId: cat.id, points: [{ lng: 120.2, lat: 30.25, radius: 300 }] })
        .expect(201)
    ).body
    const at = (await t.prisma.landmark.findUniqueOrThrow({ where: { id: lm.id } })).updatedAt
    await sleep(5)
    await api
      .put(`/api/landmark-categories/${cat.id}`)
      .send({ name: '医疗', defaultRadius: 300, icon: 'landmark', enabled: true })
      .expect(200)
    expect((await t.prisma.landmark.findUniqueOrThrow({ where: { id: lm.id } })).updatedAt).toEqual(at)
    await api
      .put(`/api/landmarks/${lm.id}`)
      .send({ name: '人民医院', categoryId: cat.id, points: [{ lng: 120.21, lat: 30.25, radius: 300 }] })
      .expect(200)
    expect((await t.prisma.landmark.findUniqueOrThrow({ where: { id: lm.id } })).updatedAt.getTime()).toBeGreaterThan(
      at.getTime(),
    )
  })

  /* ---------------- 站牌集的 changedAt ---------------- */

  it('站牌集：自身保存更新、不碰 rev 与 updatedAt；站点改名不更新', async () => {
    const shelfType = (await api.post('/api/dicts').send({ category: 'shelfType', name: '单立柱' }).expect(201)).body
    const v = (await api.get(`/api/stops/${s.a.id}/sign-set`).expect(200)).body as SignSetView
    let c = await step()
    const d = addShelf(v, { type: shelfType }).draft
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, reminder: '', shelves: d.shelves, schedules: d.schedules })
      .expect(200)
    expect(await moved(c)).toEqual(['a'])
    c = await step()
    await api
      .put(`/api/stops/${s.a.id}`)
      .send(stopBody(s.a, { name: '人民广场北' }))
      .expect(200)
    expect(await moved(c)).toEqual([])
  })

  it('线路新建、加站、只改到站时刻、改名、停运、恢复', async () => {
    let c = await step()
    let l = await twoway([s.a.id, s.b.id], [s.b.id, s.a.id])
    expect(await moved(c)).toEqual(['a', 'b'])

    // 加入站点 X：只更新 X
    c = await step()
    l = await putLine(l, {
      routes: lineBody(l).routes.map((r, i) => (i === 0 ? { ...r, stops: [...r.stops, { stopId: s.x.id }] } : r)),
    })
    expect(await moved(c)).toEqual(['x'])

    // 只改到站时刻、票价、线路名：不更新
    c = await step()
    l = await putLine(l, {
      name: 'K1路（新）',
      fare: '3 元',
      routes: lineBody(l).routes.map((r) => ({ ...r, stops: r.stops.map((x) => ({ ...x, times: ['07:00'] })) })),
    })
    expect(await moved(c)).toEqual([])

    // 停运：该线路所有站点；恢复同样
    c = await step()
    l = (await api.post(`/api/lines/${l.id}/suspend`).send({ rev: l.rev }).expect(200)).body.item
    expect(await moved(c)).toEqual(['a', 'b', 'x'])
    c = await step()
    await api.post(`/api/lines/${l.id}/resume`).send({ rev: l.rev }).expect(200)
    expect(await moved(c)).toEqual(['a', 'b', 'x'])
  })

  it('改模式删走向、环线第二次途经、删除线路（含只有待编排的站牌集）', async () => {
    const shelfType = (await api.post('/api/dicts').send({ category: 'shelfType', name: '单立柱' }).expect(201)).body
    let l = await twoway([s.a.id, s.b.id, s.c.id], [s.b.id, s.a.id])
    // A 上有编排；B、C 只有待编排
    const v = (await api.get(`/api/stops/${s.a.id}/sign-set`).expect(200)).body as SignSetView
    const sh = addShelf(v, { type: shelfType })
    const bd = addBoard(sh.draft, sh.shelfId)
    const d = placeOnBoard(bd.draft, { routeId: l.routes[1].id, pass: 1 }, bd.boardId)
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, reminder: '', shelves: d.shelves, schedules: d.schedules })
      .expect(200)

    // 改为单向：下行删除，A、B 的途经变了；C 只在上行，不变
    let c = await step()
    l = await putLine(l, { mode: 'oneway', routes: [{ ...lineBody(l).routes[0], kind: 'oneway' }] })
    expect(await moved(c)).toEqual(['a', 'b', 'c'])
    // 上行改名为单向，走向种类变了，三个站都算；再加一次 A（第二次途经）只算 A
    c = await step()
    l = await putLine(l, {
      routes: [{ ...lineBody(l).routes[0], stops: [...lineBody(l).routes[0].stops, { stopId: s.a.id }] }],
    })
    expect(await moved(c)).toEqual(['a'])

    // 删除线路：前一份快照里的站点全部更新
    c = await step()
    await api.delete(`/api/lines/${l.id}`).expect(204)
    expect(await moved(c)).toEqual(['a', 'b', 'c'])
  })

  it('增量同步：线路停运后，用之前的水位能取到受影响的站牌集', async () => {
    const l = await twoway([s.a.id, s.b.id], [s.b.id, s.a.id])
    const v1 = (p: string) =>
      request(t.app.getHttpServer()).get(`/api/v1${p}`).set('Authorization', `Bearer ${token.token}`).expect(200)
    const first = (await v1('/sign-sets')).body as V1Page<{ id: string }>
    expect(first.items).toHaveLength(4)
    // 水位是 5 秒前：等它过去，下一轮只剩之后的变化
    const since = new Date(Date.now()).toISOString()
    await sleep(10)
    await api.post(`/api/lines/${l.id}/suspend`).send({ rev: l.rev }).expect(200)
    const next = (await v1(`/sign-sets?updatedSince=${encodeURIComponent(since)}`)).body as V1Page<{
      stop: { id: string }
      counts: { waiting: number; invalid: number }
    }>
    expect(next.items.map((x) => x.stop.id).sort()).toEqual([s.a.id, s.b.id].sort())
    expect(next.items.every((x) => x.counts.waiting === 0)).toBe(true)
  })

  it('数据库会话时区为 Asia/Shanghai 时，写入与输出的时间仍然正确', async () => {
    const url = new URL(t.env.DATABASE_URL)
    url.searchParams.set('options', '-c TimeZone=Asia/Shanghai')
    const sh = await createTestApp(undefined, { DATABASE_URL: url.toString() })
    try {
      const [tz] = await sh.prisma.$queryRaw<{ TimeZone: string }[]>`SHOW TimeZone`
      expect(tz.TimeZone).toBe('Asia/Shanghai')
      const agent = await sh.login()
      const x = (
        await agent.post('/api/stops').send({ name: '时区站', direction: '东', lng: 120, lat: 30 }).expect(201)
      ).body.item as StopDetail
      const l = await (
        await agent.post('/api/lines').send({
          name: 'T1路',
          number: 'T-1',
          mode: 'oneway',
          routes: [{ kind: 'oneway', stops: [{ stopId: x.id }, { stopId: s.a.id }] }],
        })
      ).body.item
      expect(l.id).toBeTruthy()
      const v1 = (p: string) =>
        request(sh.app.getHttpServer()).get(`/api/v1${p}`).set('Authorization', `Bearer ${token.token}`).expect(200)
      const ss = (await v1(`/stops/${x.id}/sign-set`)).body
      const st = (await v1(`/stops/${x.id}`)).body
      for (const iso of [ss.changedAt, st.createdAt, st.changedAt])
        expect(Math.abs(Date.parse(iso) - Date.now())).toBeLessThan(10_000)
      const page = (await v1('/stops')).body as V1Page<unknown>
      expect(Math.abs(Date.parse(page.nextUpdatedSince) - (Date.now() - 5000))).toBeLessThan(10_000)
      const del = await agent.delete(`/api/lines/${l.id}`).expect(204)
      expect(del.status).toBe(204)
      const d = (await v1('/deleted?type=line')).body as V1Page<{ deletedAt: string }>
      expect(Math.abs(Date.parse(d.items[0].deletedAt) - Date.now())).toBeLessThan(10_000)
    } finally {
      await sh.close()
    }
  })
})
