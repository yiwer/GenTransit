import {
  addBoard,
  addShelf,
  addSlot,
  findBoard,
  hide,
  placeOnBoard,
  placeOnSlot,
  updateBoard,
  updateSlot,
  type ImportJobView,
  type LineDetail,
  type SignSetDraft,
  type SignSetView,
  type StopDetail,
} from '@gentransit/shared'
import type { Agent, Response } from 'supertest'
import { readWorkbook, workbookBuffer } from '../src/import/excel'
import { createTestApp, type TestApp } from './helpers'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

describe('站牌集（M3 T2、T3）', () => {
  let t: TestApp
  let api: Agent
  let s: Record<'x' | 'b' | 'c' | 'y', StopDetail>
  let shelfType: { id: string; name: string }

  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    shelfType = (await api.post('/api/dicts').send({ category: 'shelfType', name: '双立柱站架' }).expect(201)).body
    const mk = async (name: string, direction: string) =>
      (await api.post('/api/stops').send({ name, direction, lng: 120.2, lat: 30.25 }).expect(201)).body
        .item as StopDetail
    s = {
      x: await mk('人民广场', '东'),
      b: await mk('火车站', '场站'),
      c: await mk('北门', '南'),
      y: await mk('环城站', '北'),
    }
  })
  afterAll(() => t.close())

  /* ---------------- 辅助 ---------------- */

  const view = async (stopId: string) =>
    (await api.get(`/api/stops/${stopId}/sign-set`).expect(200)).body as SignSetView
  const input = (d: SignSetDraft, rev: number) => ({
    rev,
    reminder: d.reminder,
    shelves: d.shelves,
    schedules: d.schedules,
  })
  const save = (v: SignSetView, d: SignSetDraft = v) => api.put(`/api/sign-sets/${v.id}`).send(input(d, v.rev))
  /** 一个站架、一块整版站牌 */
  const withBoard = (v: SignSetDraft) => {
    const a = addShelf(v, { type: shelfType })
    const b = addBoard(a.draft, a.shelfId)
    return { draft: b.draft, boardId: b.boardId, shelfId: a.shelfId }
  }
  const snaps = (id: string) =>
    t.prisma.snapshot.findMany({
      where: { objectType: 'signSet', objectId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  const status = (v: SignSetView) => v.counts
  const line = async (body: Record<string, unknown>) =>
    (await api.post('/api/lines').send(body).expect(201)).body.item as LineDetail
  const twoway = (up: string[], down: string[], name = 'K1路', number = 'K-1') =>
    line({
      name,
      number,
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
  const route = (l: LineDetail, kind: string) => l.routes.find((r) => r.kind === kind)!
  const summary = async () => (await api.get('/api/sign-sets/summary').expect(200)).body

  /* ---------------- 验收 ---------------- */

  it('AC-02～AC-04：站序加入站点后出现待编排、工作台待处理数加一；放到一号牌保存生成快照；原样保存不生成', async () => {
    const l = await twoway([s.b.id, s.c.id], [s.c.id, s.b.id])
    const before = await summary()
    expect(before).toMatchObject({ pendingSets: 2, waiting: 4, invalid: 0, signSets: 4 })
    expect(status(await view(s.x.id))).toEqual({ waiting: 0, placed: 0, hidden: 0, invalid: 0 })

    // AC-02：上行站序加入 X
    const up = route(l, 'up')
    await api
      .put(`/api/lines/${l.id}`)
      .send(
        lineBody(l, {
          routes: [
            { kind: 'up', stops: [s.x.id, s.b.id, s.c.id].map((stopId) => ({ stopId })) },
            { kind: 'down', stops: [s.c.id, s.b.id].map((stopId) => ({ stopId })) },
          ],
        }),
      )
      .expect(200)
    const v = await view(s.x.id)
    expect(v.passages).toEqual([{ routeId: up.id, pass: 1, count: 1 }])
    expect(v.routes).toEqual([
      { id: up.id, lineId: l.id, lineName: 'K1路', kind: 'up', suspended: false, terminal: '北门' },
    ])
    expect(status(v)).toEqual({ waiting: 1, placed: 0, hidden: 0, invalid: 0 })
    expect((await summary()).pendingSets).toBe(before.pendingSets + 1)
    expect((await api.get(`/api/stops/${s.x.id}`)).body.signSet).toMatchObject({ shelves: 0, boards: 0, waiting: 1 })

    // AC-03：放到整版站牌一号牌并保存
    const { draft, boardId } = withBoard(v)
    const placed = placeOnBoard(draft, { routeId: up.id, pass: 1 }, boardId)
    const r = await save(v, placed).expect(200)
    expect(r.body.changed).toBe(true)
    expect(r.body.item.rev).toBe(v.rev + 1)
    expect(status(r.body.item)).toEqual({ waiting: 0, placed: 1, hidden: 0, invalid: 0 })
    const list = await snaps(v.id)
    expect(list.map((x) => x.action)).toEqual(['create', 'update'])
    expect(list[1].note).toBe('修改：站架、站牌、线路编排')
    expect(list[1].content).toMatchObject({
      stop: { id: s.x.id, name: '人民广场（东）' },
      shelves: [
        {
          no: 1,
          type: { id: shelfType.id, name: shelfType.name },
          boards: [{ no: 1, face: 'front', kind: 'whole', width: 1200 }],
        },
      ],
      schedules: [
        { id: `${up.id}#1`, route: { id: up.id, name: 'K1路 上行' }, pass: 1, hidden: false, places: [{ boardId }] },
      ],
    })
    expect((await api.get(`/api/stops/${s.x.id}`)).body.signSet).toMatchObject({ shelves: 1, boards: 1, waiting: 0 })

    // AC-04：原样再保存：不生成快照，rev 不变
    const saved = r.body.item as SignSetView
    const again = await save(saved).expect(200)
    expect(again.body).toMatchObject({ changed: false, item: { rev: saved.rev } })
    expect(await snaps(v.id)).toHaveLength(2)
  })

  it('AC-05、AC-06：停运后编排显示失效、不出现在待编排、站牌集不生成快照；恢复后回到已编排', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const v = await view(s.x.id)
    const { draft, boardId } = withBoard(v)
    const d = placeOnBoard(draft, { routeId: route(l, 'up').id, pass: 1 }, boardId)
    await save(v, d).expect(200)
    const count = (await snaps(v.id)).length

    await api.post(`/api/lines/${l.id}/suspend`).send({ rev: l.rev }).expect(200)
    const off = await view(s.x.id)
    expect(off.passages).toEqual([])
    expect(status(off)).toEqual({ waiting: 0, placed: 0, hidden: 0, invalid: 1 })
    expect(off.routes.find((r) => r.id === route(l, 'up').id)?.suspended).toBe(true)
    expect(off.rev).toBe(v.rev + 1)
    expect(await snaps(v.id)).toHaveLength(count)
    const pending = (await api.get('/api/sign-sets?pending=1')).body
    expect(pending.items.find((x: { id: string }) => x.id === v.id)).toMatchObject({ waiting: 0, invalid: 1 })

    await api
      .post(`/api/lines/${l.id}/resume`)
      .send({ rev: l.rev + 1 })
      .expect(200)
    expect(status(await view(s.x.id))).toEqual({ waiting: 1, placed: 1, hidden: 0, invalid: 0 })
    expect(await snaps(v.id)).toHaveLength(count)
  })

  it('AC-07：删除线路，所有站牌集中的编排删除，各存一份"连带修改"快照；线路出现在已删除视图', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    for (const [stop, kind] of [
      [s.x, 'up'],
      [s.b, 'down'],
    ] as const) {
      const v = await view(stop.id)
      const { draft, boardId } = withBoard(v)
      await save(v, placeOnBoard(draft, { routeId: route(l, kind).id, pass: 1 }, boardId)).expect(200)
    }
    // 走向外键是 Restrict：绕过连带处理直接删走向会被数据库拒绝
    await expect(t.prisma.route.delete({ where: { id: route(l, 'up').id } })).rejects.toThrow()

    expect((await api.get(`/api/lines/${l.id}/impact`)).body).toEqual({ stops: 2, signSets: 2, schedules: 2 })
    expect((await api.get(`/api/lines/${l.id}/delete-check`)).body).toMatchObject({ affectedSignSets: 2 })
    await api.delete(`/api/lines/${l.id}`).expect(204)
    for (const stop of [s.x, s.b]) {
      const v = await view(stop.id)
      expect(v.schedules).toEqual([])
      expect(v.shelves).toHaveLength(1)
      const last = (await snaps(v.id)).at(-1)!
      expect(last).toMatchObject({ action: 'cascadeUpdate', note: '删除线路 K1路，连带移除编排' })
      expect((last.content as { schedules: unknown[] }).schedules).toEqual([])
    }
    const deleted = (await api.get('/api/snapshots/deleted?type=line')).body
    expect(deleted.items).toEqual([expect.objectContaining({ objectId: l.id, objectName: 'K1路' })])
    expect(
      (await api.get(`/api/snapshots?type=line&id=${l.id}`)).body.map((x: { action: string }) => x.action),
    ).toEqual(['delete', 'create'])
  })

  it('AC-08：环线两次经过站点，出现两条独立途经，可分别编排；删掉第 1 次后按位置对应，原第 2 次的编排失效', async () => {
    const l = await line({
      name: '环1路',
      number: 'H-1',
      mode: 'loop',
      routes: [{ kind: 'loop', stops: [s.y.id, s.b.id, s.y.id, s.c.id].map((stopId) => ({ stopId })) }],
    })
    const loop = route(l, 'loop')
    const v = await view(s.y.id)
    expect(v.passages).toEqual([
      { routeId: loop.id, pass: 1, count: 2 },
      { routeId: loop.id, pass: 2, count: 2 },
    ])
    expect(status(v).waiting).toBe(2)
    const { draft, boardId } = withBoard(v)
    let d = placeOnBoard(draft, { routeId: loop.id, pass: 1 }, boardId)
    d = hide(d, { routeId: loop.id, pass: 2 })
    const r = await save(v, d).expect(200)
    expect(status(r.body.item)).toEqual({ waiting: 0, placed: 1, hidden: 1, invalid: 0 })
    const content = (await snaps(v.id)).at(-1)!.content as { schedules: { id: string; hidden: boolean }[] }
    expect(content.schedules.map((x) => [x.id, x.hidden])).toEqual([
      [`${loop.id}#1`, false],
      [`${loop.id}#2`, true],
    ])

    await api
      .put(`/api/lines/${l.id}`)
      .send(lineBody(l, { routes: [{ kind: 'loop', stops: [s.b.id, s.y.id, s.c.id].map((stopId) => ({ stopId })) }] }))
      .expect(200)
    // 原第 2 次变成第 1 次，沿用原第 1 次的编排；原第 2 次的隐藏编排失效
    expect(status(await view(s.y.id))).toEqual({ waiting: 0, placed: 1, hidden: 0, invalid: 1 })
  })

  it('AC-16：双边改单向，确认弹窗写明下行编排数；保存后受影响站牌集生成"连带修改"快照', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const v = await view(s.x.id)
    const { draft, boardId } = withBoard(v)
    let d = placeOnBoard(draft, { routeId: route(l, 'up').id, pass: 1 }, boardId)
    d = placeOnBoard(d, { routeId: route(l, 'down').id, pass: 1 }, boardId)
    await save(v, d).expect(200)

    expect((await api.get(`/api/lines/${l.id}/impact?kinds=down`)).body).toEqual({
      stops: 2,
      signSets: 1,
      schedules: 1,
    })
    expect((await api.get(`/api/lines/${l.id}/impact?kinds=up,down`)).body.schedules).toBe(2)
    await api
      .put(`/api/lines/${l.id}`)
      .send(
        lineBody(l, { mode: 'oneway', routes: [{ kind: 'oneway', stops: [{ stopId: s.x.id }, { stopId: s.b.id }] }] }),
      )
      .expect(200)
    const after = await view(s.x.id)
    expect(after.schedules.map((x) => x.routeId)).toEqual([route(l, 'up').id])
    expect(status(after)).toEqual({ waiting: 0, placed: 1, hidden: 0, invalid: 0 })
    expect(after.rev).toBe(v.rev + 2)
    expect((await snaps(v.id)).at(-1)).toMatchObject({
      action: 'cascadeUpdate',
      note: '修改线路 K1路 的模式，删除走向 下行，连带移除编排',
    })
  })

  it('线路导入改模式：预览写明受影响的站牌集数，确认后生成"连带修改"快照', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const v = await view(s.x.id)
    const { draft, boardId } = withBoard(v)
    await save(v, placeOnBoard(draft, { routeId: route(l, 'down').id, pass: 1 }, boardId)).expect(200)
    const buf = await workbookBuffer([
      {
        name: '线路',
        columns: ['管理编号*', '线路名*', '英文名', '模式*'].map((header) => ({ header })),
        rows: [['K-1', 'K1路', null, '单向']],
      },
    ])
    const job = (
      await api.post('/api/import/line').attach('file', buf, { filename: 'l.xlsx', contentType: XLSX }).expect(201)
    ).body as ImportJobView
    expect(job.preview.removedRoutes).toEqual([
      { key: 'K-1', name: 'K1路', routes: ['下行'], signSets: 1, schedules: 1 },
    ])
    await api.post(`/api/import/${job.id}/confirm`).expect(200)
    expect((await view(s.x.id)).schedules).toEqual([])
    expect((await snaps(v.id)).at(-1)).toMatchObject({ action: 'cascadeUpdate' })
  })

  /* ---------------- 有效修改判定、并发 ---------------- */

  it('线路改名、站点改名、重建路径站之后原样保存站牌集，不产生快照', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const v = await view(s.x.id)
    const { draft, boardId } = withBoard(v)
    await save(v, placeOnBoard(draft, { routeId: route(l, 'up').id, pass: 1 }, boardId)).expect(200)
    const n = (await snaps(v.id)).length

    await api
      .put(`/api/lines/${l.id}`)
      .send(lineBody(l, { name: 'K1路快线' }))
      .expect(200)
    const stop = (await api.get(`/api/stops/${s.x.id}`)).body as StopDetail
    await api
      .put(`/api/stops/${s.x.id}`)
      .send({ name: '人民广场站', direction: '东', lng: stop.lng, lat: stop.lat, rev: stop.rev })
      .expect(200)
    const now = await view(s.x.id)
    expect(now.routes[0].lineName).toBe('K1路快线')
    expect((await save(now).expect(200)).body.changed).toBe(false)
    expect(await snaps(v.id)).toHaveLength(n)
  })

  it('并发保护：旧 rev 保存返回 409 并带最新内容；属于别的站牌集的 ID 被拒', async () => {
    const v = await view(s.x.id)
    const { draft } = withBoard(v)
    await save(v, draft).expect(200)
    const stale = await save(v, { ...draft, reminder: '临时调整' }).expect(409)
    expect(stale.body).toMatchObject({ code: 'CONFLICT', details: { latest: { rev: v.rev + 1 } } })

    const other = await view(s.b.id)
    const mine = await view(s.x.id)
    const r = await save(other, mine).expect(400)
    expect(r.body.message).toBe('提交里有属于别的站牌集的站架、站牌或插片')
  })

  /* ---------------- 校验 ---------------- */

  it('保存校验：编号范围与唯一、尺寸、BR-06、BR-07、引用存在', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const up = { routeId: route(l, 'up').id, pass: 1 }
    const v = await view(s.x.id)
    const { draft, boardId, shelfId } = withBoard(v)
    const bad = async (d: SignSetDraft, msg: string | RegExp) => {
      const r = await save(v, d).expect(400)
      expect(r.body.code).toBe('VALIDATION_FAILED')
      expect(r.body.message).toMatch(msg)
    }
    const mut = (f: (d: SignSetDraft) => void) => {
      const d = structuredClone(draft)
      f(d)
      return d
    }
    await bad(
      mut((d) => (d.shelves[0].boards[0].no = 91)),
      '站牌编号最大 90',
    )
    await bad(
      mut((d) => (d.shelves[0].boards[0].width = 0)),
      '应为正整数（毫米）',
    )
    await bad(
      mut((d) => (d.shelves[0].boards[0].height = 10001)),
      '不能超过 10000 毫米',
    )
    await bad(
      mut((d) => d.shelves.push({ ...d.shelves[0], id: crypto.randomUUID(), boards: [] })),
      '站架编号重复：一号架',
    )
    await bad(
      mut((d) => (d.shelves[0].typeId = s.x.id)),
      '站架类型不存在',
    )
    // 分片站牌：非线路插片不能放线路；直接放在分片站牌上不行；同一插片放两条不行
    let sliced = updateBoard(draft, boardId, { kind: 'sliced' }).draft
    sliced = addSlot(sliced, boardId).draft
    const [slot1, slot2] = findBoard(sliced, boardId)!.board.slots
    const other = updateSlot(sliced, slot2.id, { kind: 'other', note: '公告栏' }).draft
    await bad(
      mut((d) =>
        Object.assign(d, other, {
          schedules: [{ ...up, id: 'x', placement: 'slot', boardId, slotId: slot2.id, order: null }],
        }),
      ),
      '是非线路插片，不能放线路',
    )
    await bad(
      mut((d) =>
        Object.assign(d, sliced, {
          schedules: [{ ...up, id: 'x', placement: 'board', boardId, slotId: null, order: 1 }],
        }),
      ),
      '是分片站牌，要放进插片里',
    )
    const twice = placeOnSlot(sliced, up, slot1.id).draft
    twice.schedules.push({ ...twice.schedules[0], routeId: route(l, 'down').id })
    await bad(twice, '只能放一条线路')
    // 隐藏与放置互斥
    const both = placeOnBoard(draft, up, boardId)
    both.schedules.push({ ...both.schedules[0], id: 'h', placement: 'hidden', boardId: null, order: null })
    await bad(both, '不能同时隐藏和放在站牌上')
    // 走向不存在
    await bad(placeOnBoard(draft, { routeId: s.c.id, pass: 1 }, boardId), '线路编排引用的走向不存在')
    expect(shelfId).toBeTruthy()
  })

  it('失效编排只能留在原位；编辑期间线路停运，新放置被拒并提示刷新', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const up = { routeId: route(l, 'up').id, pass: 1 }
    const down = { routeId: route(l, 'down').id, pass: 1 }
    const v = await view(s.x.id)
    let { draft } = withBoard(v)
    const b1 = draft.shelves[0].boards[0].id
    const b2r = addBoard(draft, draft.shelves[0].id)
    draft = b2r.draft
    const saved = (await save(v, placeOnBoard(draft, up, b1)).expect(200)).body.item as SignSetView

    // 打开编辑器后线路停运
    await api.post(`/api/lines/${l.id}/suspend`).send({ rev: l.rev }).expect(200)
    const moved = placeOnBoard(saved, up, b2r.boardId, { moveFrom: saved.schedules[0].id })
    const r1 = await save(saved, moved).expect(400)
    expect(r1.body.message).toBe('K1路 上行已不经过本站，失效编排只能保留原位、排序或移除，不能放到新的站牌或插片上')
    const r2 = await save(saved, placeOnBoard(saved, down, b1)).expect(400)
    expect(r2.body.message).toBe('K1路 下行已不经过本站（可能刚停运或改了站序），请刷新后重新编排')
    // 原位保留、改温馨提示：可以保存
    expect((await save(saved, { ...saved, reminder: '暂停运营' }).expect(200)).body.changed).toBe(true)
  })

  /* ---------------- 站点、字典、模板 ---------------- */

  it('删除站点时站牌集的"删除"快照为完整内容；站架类型被站架或模板引用时不能删除', async () => {
    const v = await view(s.x.id)
    const { draft } = withBoard(v)
    await save(v, draft).expect(200)
    await api
      .post('/api/shelf-templates')
      .send({
        name: '单面',
        typeId: shelfType.id,
        boards: [{ face: 'front', kind: 'whole', width: 600, height: 1200 }],
      })
      .expect(201)
    const r = await api.delete(`/api/dicts/${shelfType.id}`).expect(409)
    expect(r.body.details.referrers.map((x: { type: string; name: string }) => `${x.type}:${x.name}`)).toEqual([
      '站牌集:人民广场（东）',
      '站架模板:单面',
    ])

    await api.delete(`/api/stops/${s.x.id}`).expect(204)
    const last = (await snaps(v.id)).at(-1)!
    expect(last.action).toBe('delete')
    expect((last.content as { shelves: unknown[] }).shelves).toHaveLength(1)
  })

  it('站架模板：新建、按站架类型分组列出、同类型内名称唯一、修改、删除', async () => {
    const shelter = (await api.post('/api/dicts').send({ category: 'shelfType', name: '候车亭灯箱' }).expect(201)).body
    const body = {
      name: '候车亭灯箱 · 3 插片',
      typeId: shelter.id,
      desc: '标准侧灯箱',
      boards: [
        {
          face: 'front',
          kind: 'sliced',
          width: 1500,
          height: 2000,
          slots: [
            { no: 1, kind: 'route', width: 700, height: 360 },
            { no: 2, kind: 'other', note: '公告栏', width: 700, height: 360 },
          ],
        },
      ],
    }
    const a = (await api.post('/api/shelf-templates').send(body).expect(201)).body
    expect(a).toMatchObject({
      name: body.name,
      type: { id: shelter.id, name: shelter.name },
      noPhysical: false,
      image: null,
    })
    expect(a.boards[0].slots[1]).toEqual({ no: 2, kind: 'other', note: '公告栏', width: 700, height: 360 })
    await api
      .post('/api/shelf-templates')
      .send({
        name: '双面整版',
        typeId: shelfType.id,
        boards: [{ face: 'front', kind: 'whole', width: 1200, height: 1800 }],
      })
      .expect(201)
    expect((await api.post('/api/shelf-templates').send(body).expect(409)).body.message).toBe(
      '候车亭灯箱已有名为「候车亭灯箱 · 3 插片」的模板',
    )
    const bad = await api
      .post('/api/shelf-templates')
      .send({
        ...body,
        name: 'x',
        boards: [{ face: 'front', kind: 'whole', width: 1, height: 1, slots: body.boards[0].slots }],
      })
      .expect(400)
    expect(bad.body.message).toContain('整版站牌不能有插片')
    const list = (await api.get('/api/shelf-templates').expect(200)).body
    expect(list.map((x: { type: { name: string }; name: string }) => `${x.type.name}/${x.name}`)).toEqual([
      '候车亭灯箱/候车亭灯箱 · 3 插片',
      '双立柱站架/双面整版',
    ])
    await api
      .put(`/api/shelf-templates/${a.id}`)
      .send({ ...body, noPhysical: true })
      .expect(200)
    await api.delete(`/api/shelf-templates/${a.id}`).expect(204)
    expect((await api.get('/api/shelf-templates')).body).toHaveLength(1)
  })

  /* ---------------- 列表、导出、最近修改 ---------------- */

  it('站牌集列表：筛选、只看待处理、排序；站牌尺寸下拉', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const v = await view(s.x.id)
    const { draft, boardId } = withBoard(v)
    let d = placeOnBoard(draft, { routeId: route(l, 'up').id, pass: 1 }, boardId)
    d = placeOnBoard(d, { routeId: route(l, 'down').id, pass: 1 }, boardId)
    await save(v, d).expect(200)

    const all = (await api.get('/api/sign-sets').expect(200)).body
    expect(all.total).toBe(4)
    expect(all.items.map((x: { stop: { name: string } }) => x.stop.name)).toEqual([
      '北门',
      '环城站',
      '火车站',
      '人民广场',
    ])
    const x = all.items.find((i: { id: string }) => i.id === v.id)
    expect(x).toMatchObject({
      stop: { id: s.x.id, name: '人民广场', direction: '东' },
      lines: [{ id: l.id, name: 'K1路', suspended: false }],
      shelves: 1,
      shelfTypes: [{ name: '双立柱站架', count: 1 }],
      boards: 1,
      boardSizes: ['1200×1800'],
      waiting: 0,
      invalid: 0,
    })
    const names = async (q: string) =>
      (await api.get(`/api/sign-sets?${q}`).expect(200)).body.items.map((i: { stop: { name: string } }) => i.stop.name)
    expect(await names('pending=1')).toEqual(['火车站'])
    expect(await names(`lineIds=${l.id}`)).toEqual(['火车站', '人民广场'])
    expect(await names(`shelfTypeIds=${shelfType.id}`)).toEqual(['人民广场'])
    expect(await names('boardSize=1200x1800')).toEqual(['人民广场'])
    expect(await names('boardSize=600x1200')).toEqual([])
    expect(await names(`q=${encodeURIComponent('广场')}`)).toEqual(['人民广场'])
    expect((await names('sort=-pending'))[0]).toBe('火车站')
    expect((await api.get('/api/sign-sets?page=9').expect(200)).body).toMatchObject({ total: 4, items: [] })
    expect((await api.get('/api/sign-sets/board-sizes').expect(200)).body).toEqual([
      { width: 1200, height: 1800, count: 1 },
    ])
  })

  it('站牌集导出：站架、站牌、插片、线路编排四个 sheet，编排带状态', async () => {
    const l = await twoway([s.x.id, s.b.id], [s.b.id, s.x.id])
    const k2 = await twoway([s.x.id, s.c.id], [s.c.id, s.x.id], '2路', 'N-2')
    const v = await view(s.x.id)
    const w = withBoard(v)
    let d = placeOnBoard(w.draft, { routeId: route(l, 'up').id, pass: 1 }, w.boardId)
    const b2 = addBoard(d, w.shelfId)
    d = updateBoard(b2.draft, b2.boardId, { kind: 'sliced', width: 1500, height: 2000 }).draft
    d = addSlot(d, b2.boardId).draft
    const [sl1, sl2] = findBoard(d, b2.boardId)!.board.slots
    d = updateSlot(d, sl2.id, { kind: 'other', note: '公告栏', width: 700, height: 360 }).draft
    d = placeOnSlot(d, { routeId: route(l, 'down').id, pass: 1 }, sl1.id).draft
    d = hide(d, { routeId: route(k2, 'up').id, pass: 1 })
    d.shelves[0].name = '主站架'
    await save(v, d).expect(200)
    await api.post(`/api/lines/${k2.id}/suspend`).send({ rev: k2.rev }).expect(200)

    const res = await api
      .get('/api/export/sign-sets?shelfTypeIds=' + shelfType.id)
      .buffer(true)
      .parse(binary)
      .expect(200)
    expect(res.headers['content-type']).toBe(XLSX)
    expect(decodeURIComponent(res.headers['content-disposition'])).toMatch(/站牌集_\d{4}-\d{2}-\d{2}\.xlsx/)
    const sheets = await readWorkbook(res.body as Buffer)
    const rows = (name: string) => sheets.find((x) => x.name === name)!.rows.map((r) => r.values)
    expect(sheets.map((x) => x.name)).toEqual(['站架', '站牌', '插片', '线路编排'])
    expect(rows('站架')).toEqual([['人民广场', '东', '1', '双立柱站架', '主站架', '', '否', '', '1']])
    expect(rows('站牌')).toEqual([
      ['人民广场', '东', '1', '1', '正面', '整版', '1200', '1800', ''],
      ['人民广场', '东', '1', '2', '正面', '分片', '1500', '2000', ''],
    ])
    expect(rows('插片')).toEqual([
      ['人民广场', '东', '2', '1', '线路插片', '', '1500', '2000'],
      ['人民广场', '东', '2', '2', '非线路插片', '公告栏', '700', '360'],
    ])
    expect(rows('线路编排')).toEqual([
      ['人民广场', '东', '2路', '上行', '1', '', '', '', '失效'],
      ['人民广场', '东', 'K1路', '上行', '1', '1', '', '1', '已编排'],
      ['人民广场', '东', 'K1路', '下行', '1', '2', '1', '', '已编排'],
    ])
  })

  it('最近修改：每个对象一行，按时间倒序；已删除的对象标出', async () => {
    const v = await view(s.x.id)
    await save(v, withBoard(v).draft).expect(200)
    await api.delete(`/api/stops/${s.c.id}`).expect(204)
    const r = (await api.get('/api/snapshots/recent?limit=3').expect(200)).body
    const rows = r.map((x: { objectType: string; objectName: string; action: string; exists: boolean }) =>
      [x.objectType, x.objectName, x.action, x.exists].join(' '),
    )
    // 同一事务里的两份快照时间相同，先后不固定
    expect(rows.slice(0, 2).sort()).toEqual(['signSet 北门（南） delete false', 'stop 北门（南） delete false'])
    expect(rows[2]).toBe('signSet 人民广场（东） update true')
    expect(r[2].stopId).toBe(s.x.id)
  })
})
