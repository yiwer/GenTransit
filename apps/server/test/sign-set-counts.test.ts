import {
  addBoard,
  addShelf,
  hide,
  placeOnBoard,
  type DataChecks,
  type ImportResult,
  type ImportJobView,
  type LineDetail,
  type Page,
  type SignSetListItem,
  type SignSetQueue,
  type SignSetView,
  type StopDetail,
  type StopReference,
} from '@gentransit/shared'
import type { Agent } from 'supertest'
import { workbookBuffer } from '../src/import/excel'
import { SignSetStatusService } from '../src/sign-sets/sign-set-status.service'
import { createTestApp, type TestApp } from './helpers'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * M6 计划 3.5：全部站牌集的编排计数按数据版本缓存。工作台汇总、数据体检、逐站编排队列、
 * 站牌集列表的"只看待处理"与按待处理排序共用这份快照；每条写入路径改完后都要立即反映
 */
describe('编排计数快照', () => {
  let t: TestApp
  let api: Agent
  let type: { id: string }
  let s: Record<string, StopDetail>
  let l1: LineDetail

  beforeAll(async () => {
    t = await createTestApp()
    // 同时发几个请求：先监听端口，supertest 就不会每个请求各自起停服务
    await t.app.listen(0, '127.0.0.1')
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    type = (await api.post('/api/shelf-types').send({ name: '双立柱站架', form: 'doublePost' }).expect(201)).body
    s = {}
    for (const name of ['甲', '乙', '丙', '丁', '戊'])
      s[name] = (
        await api.post('/api/stops').send({ name, direction: '东', lng: 120.2, lat: 30.25 }).expect(201)
      ).body.item
    l1 = await line('1路', [
      { kind: 'up', stops: ['甲', '乙', '丙'] },
      { kind: 'down', stops: ['丙', '乙', '甲'] },
    ])
  })
  afterAll(() => t.close())

  const line = async (name: string, routes: { kind: string; stops: string[] }[]) =>
    (
      await api
        .post('/api/lines')
        .send({
          name,
          number: name,
          mode: 'twoway',
          routes: routes.map((r) => ({ kind: r.kind, stops: r.stops.map((n) => ({ stopId: s[n].id })) })),
        })
        .expect(201)
    ).body.item as LineDetail
  const getLine = async (id: string) => (await api.get(`/api/lines/${id}`).expect(200)).body as LineDetail
  const saveLine = async (id: string, routes: { kind: string; stops: string[] }[]) => {
    const cur = await getLine(id)
    await api
      .put(`/api/lines/${id}`)
      .send({
        name: cur.name,
        number: cur.number,
        mode: cur.mode,
        rev: cur.rev,
        routes: routes.map((r) => ({ kind: r.kind, stops: r.stops.map((n) => ({ stopId: s[n].id })) })),
      })
      .expect(200)
  }
  const routeOf = async (lineId: string, kind: string) => (await getLine(lineId)).routes.find((r) => r.kind === kind)!
  const saveSignSet = async (stop: string, edit: (v: SignSetView) => { shelves: unknown; schedules: unknown }) => {
    const v = (await api.get(`/api/stops/${s[stop].id}/sign-set`).expect(200)).body as SignSetView
    const d = edit(v)
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, reminder: '', shelves: d.shelves, schedules: d.schedules })
      .expect(200)
  }
  /** 在本站放一块站牌，把给定途经放上去 */
  const place = (stop: string, routeId: string, more?: (d: SignSetView) => SignSetView) =>
    saveSignSet(stop, (v) => {
      const sh = addShelf(v, { type: { id: type.id, name: '双立柱站架' } })
      const b = addBoard(sh.draft, sh.shelfId)
      const d = placeOnBoard(b.draft, { routeId, pass: 1 }, b.boardId) as SignSetView
      return more ? more(d) : d
    })

  /** 汇总、数据体检、工作台队列、"只看待处理 + 按待处理排序"的列表四处读数，并核对彼此一致 */
  const state = async () => {
    const [summary, checks, queue, list] = await Promise.all([
      api.get('/api/sign-sets/summary').expect(200),
      api.get('/api/data-checks').expect(200),
      api.get('/api/sign-sets/queue?from=home').expect(200),
      api.get('/api/sign-sets?pending=1&sort=-pending&size=100').expect(200),
    ])
    const sum = summary.body as { pendingSets: number; waiting: number; invalid: number; signSets: number }
    const items = (list.body as Page<SignSetListItem>).items
    const q = queue.body as SignSetQueue
    expect((checks.body as DataChecks).pendingSets).toBe(sum.pendingSets)
    expect(list.body.total).toBe(sum.pendingSets)
    expect(q.total).toBe(sum.pendingSets)
    expect(q.stopIds).toEqual(items.map((x) => x.stop.id))
    expect(items.reduce((n, x) => n + x.waiting, 0)).toBe(sum.waiting)
    expect(items.reduce((n, x) => n + x.invalid, 0)).toBe(sum.invalid)
    return {
      waiting: sum.waiting,
      invalid: sum.invalid,
      signSets: sum.signSets,
      /** 待处理的站点，按待处理数从多到少（相同时按站名） */
      pending: items.map((x) => `${x.stop.name}${x.waiting + x.invalid}`),
    }
  }

  it('新建线路、编辑器保存、线路保存、停运与恢复、站点替换、加入线路、站点删除、导入、删除线路都立即反映', async () => {
    expect(await state()).toMatchObject({ waiting: 6, invalid: 0, pending: ['丙2', '甲2', '乙2'] })

    // 编辑器保存：甲的上行放到站牌、下行隐藏
    const up = await routeOf(l1.id, 'up')
    const down = await routeOf(l1.id, 'down')
    await place('甲', up.id, (d) => hide(d, { routeId: down.id, pass: 1 }) as SignSetView)
    expect(await state()).toMatchObject({ waiting: 4, invalid: 0, pending: ['丙2', '乙2'] })

    // 线路保存：上行最后一站丙换成丁
    await saveLine(l1.id, [
      { kind: 'up', stops: ['甲', '乙', '丁'] },
      { kind: 'down', stops: ['丙', '乙', '甲'] },
    ])
    expect(await state()).toMatchObject({ waiting: 4, invalid: 0, pending: ['乙2', '丙1', '丁1'] })

    // 停运：途经都没了，甲的两条编排失效；恢复后回到原样
    await api
      .post(`/api/lines/${l1.id}/suspend`)
      .send({ rev: (await getLine(l1.id)).rev })
      .expect(200)
    expect(await state()).toMatchObject({ waiting: 0, invalid: 2, pending: ['甲2'] })
    await api
      .post(`/api/lines/${l1.id}/resume`)
      .send({ rev: (await getLine(l1.id)).rev })
      .expect(200)
    expect(await state()).toMatchObject({ waiting: 4, invalid: 0, pending: ['乙2', '丙1', '丁1'] })

    // 站点替换（M5）：上行的丁换成戊
    const refs = (await api.get(`/api/stops/${s['丁'].id}/references`).expect(200)).body as StopReference[]
    await api
      .post(`/api/stops/${s['丁'].id}/replace`)
      .send({
        targetId: s['戊'].id,
        refs: refs.map((r) => ({ lineId: r.lineId, rev: r.rev, kind: r.routeKind, index: r.index })),
      })
      .expect(200)
    expect(await state()).toMatchObject({ waiting: 4, invalid: 0, pending: ['乙2', '丙1', '戊1'] })

    // 加入线路（M5）：丁加到下行丙之后
    const cur = await getLine(l1.id)
    await api
      .post(`/api/stops/${s['丁'].id}/join`)
      .send({ items: [{ lineId: l1.id, rev: cur.rev, inserts: [{ kind: 'down', stopId: s['丁'].id, at: 1 }] }] })
      .expect(200)
    expect(await state()).toMatchObject({ waiting: 5, invalid: 0, pending: ['乙2', '丙1', '丁1', '戊1'] })

    // 站点删除：戊的编排在它移出线路后失效，删除站点后随站牌集一起没了
    await place('戊', up.id)
    expect(await state()).toMatchObject({ waiting: 4, pending: ['乙2', '丙1', '丁1'] })
    await saveLine(l1.id, [
      { kind: 'up', stops: ['甲', '乙'] },
      { kind: 'down', stops: ['丙', '丁', '乙', '甲'] },
    ])
    expect(await state()).toMatchObject({ waiting: 4, invalid: 1, pending: ['乙2', '丙1', '丁1', '戊1'] })
    const before = (await state()).signSets
    await api.delete(`/api/stops/${s['戊'].id}`).expect(204)
    expect(await state()).toMatchObject({
      waiting: 4,
      invalid: 0,
      signSets: before - 1,
      pending: ['乙2', '丙1', '丁1'],
    })

    // 导入一条经过甲、丙的单向线路
    const buf = await workbookBuffer([
      {
        name: '线路',
        columns: ['管理编号*', '线路名*', '英文名', '模式*'].map((header) => ({ header })),
        rows: [['G-2', '2路', null, '单向']],
      },
      { name: '走向', columns: ['管理编号*', '走向*'].map((header) => ({ header })), rows: [['G-2', '单向']] },
      {
        name: '路径站',
        columns: ['管理编号*', '走向*', '序号*', '站名*', '方位*'].map((header) => ({ header })),
        rows: [
          ['G-2', '单向', 1, '甲', '东'],
          ['G-2', '单向', 2, '丙', '东'],
        ],
      },
    ])
    const job = (
      await api.post('/api/import/line').attach('file', buf, { filename: 'line.xlsx', contentType: XLSX }).expect(201)
    ).body as ImportJobView
    expect(((await api.post(`/api/import/${job.id}/confirm`).expect(200)).body as ImportResult).created).toBe(1)
    expect(await state()).toMatchObject({ waiting: 6, pending: ['丙2', '乙2', '丁1', '甲1'] })

    // 删除线路
    const l2 = (await api.get(`/api/lines?q=${encodeURIComponent('2路')}`)).body.items[0]
    await api
      .delete(`/api/lines/${l2.id}`)
      .send({ rev: (await getLine(l2.id)).rev })
      .expect(204)
    expect(await state()).toMatchObject({ waiting: 4, pending: ['乙2', '丙1', '丁1'] })
  })

  it('同一数据版本只算一次：并发请求共用一次计算，没有写入时不再重算', async () => {
    const status = t.app.get(SignSetStatusService)
    const compute = jest.spyOn(status as unknown as { computeAll: () => Promise<unknown> }, 'computeAll')
    await state()
    expect(compute).toHaveBeenCalledTimes(1)
    await state()
    expect(compute).toHaveBeenCalledTimes(1)
    // 写入后版本变了：下一轮（四个并发请求）只重算一次
    await api.post(`/api/lines/${l1.id}/suspend`).send({ rev: l1.rev }).expect(200)
    await state()
    expect(compute).toHaveBeenCalledTimes(2)
    compute.mockRestore()
  })

  it('默认排序且不筛待处理时，列表只算本页计数，与快照一致', async () => {
    const all = (await api.get('/api/sign-sets?size=100').expect(200)).body as Page<SignSetListItem>
    expect(all.total).toBe(5)
    expect(all.items.map((x) => `${x.stop.name}${x.waiting}`)).toEqual(['丙2', '丁0', '甲2', '戊0', '乙2'])
  })
})
