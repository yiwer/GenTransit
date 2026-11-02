import {
  SHELF_PARAM_DEFAULTS,
  addBoard,
  addShelf,
  v1DictItem,
  v1ShelfType,
  type ApiTokenCreated,
  type ShelfTypeItem,
  type SignSetView,
  type StopDetail,
  type V1Page,
} from '@gentransit/shared'
import request, { type Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

/** 站架类型（M7 计划 3.4、3.5 节） */
describe('站架类型（M7 T1）', () => {
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

  const create = (body: Record<string, unknown>) => api.post('/api/shelf-types').send(body)
  const mkStop = async (name: string) =>
    (await api.post('/api/stops').send({ name, direction: '东', lng: 120.2, lat: 30.25 }).expect(201)).body
      .item as StopDetail

  it('新建补齐默认参数；名称唯一；按拼音排序；参数按形式校验', async () => {
    const a = (await create({ name: '三面图腾柱', form: 'totem', params: { faces: 3 } }).expect(201))
      .body as ShelfTypeItem
    expect(a).toMatchObject({
      name: '三面图腾柱',
      form: 'totem',
      params: { ...SHELF_PARAM_DEFAULTS.totem, faces: 3 },
      needsReview: false,
      shelfCount: 0,
      templateCount: 0,
    })
    await create({ name: '挂墙站牌', form: 'attached' }).expect(201)
    await create({ name: '电子站牌立杆', form: 'ePost', params: {} }).expect(201)
    const dup = await create({ name: '三面图腾柱', form: 'doublePost' }).expect(409)
    expect(dup.body).toMatchObject({ code: 'DUPLICATE', message: '站架类型「三面图腾柱」已存在' })
    // 参数越界、挂墙双面、未知形式
    await create({ name: 'x', form: 'totem', params: { faces: 9 } }).expect(400)
    const wall = await create({ name: 'y', form: 'attached', params: { host: 'wall', sides: 2 } }).expect(400)
    expect(wall.body.message).toContain('挂墙站牌只能单面')
    await create({ name: 'z', form: 'cube' }).expect(400)
    const list = (await api.get('/api/shelf-types').expect(200)).body as ShelfTypeItem[]
    expect(list.map((x) => x.name)).toEqual(['电子站牌立杆', '挂墙站牌', '三面图腾柱'])
  })

  it('修改：可改名称、形式与参数，保存即清除"待核对"；不给引用方站牌集生成快照（BR-23）', async () => {
    const type = (await create({ name: '双立柱站架', form: 'doublePost' }).expect(201)).body as ShelfTypeItem
    await t.prisma.shelfType.update({ where: { id: type.id }, data: { needsReview: true } })
    const stop = await mkStop('人民广场')
    const v = (await api.get(`/api/stops/${stop.id}/sign-set`).expect(200)).body as SignSetView
    const sh = addShelf(v, { type })
    const d = addBoard(sh.draft, sh.shelfId).draft
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, ...d })
      .expect(200)
    const before = await t.prisma.snapshot.count({ where: { objectId: v.id } })
    const changedAt = (await t.prisma.signSet.findUniqueOrThrow({ where: { id: v.id } })).changedAt

    const r = await api
      .patch(`/api/shelf-types/${type.id}`)
      .send({ name: '双立柱 · 高', form: 'doublePost', params: { postHeight: 3200 }, desc: '主干道' })
      .expect(200)
    expect(r.body).toMatchObject({ name: '双立柱 · 高', needsReview: false, shelfCount: 1, desc: '主干道' })
    expect(r.body.params.postHeight).toBe(3200)
    await api.patch(`/api/shelf-types/${type.id}`).send({ name: '三面柱', form: 'totem', params: {} }).expect(200)
    expect(await t.prisma.snapshot.count({ where: { objectId: v.id } })).toBe(before)
    const after = await t.prisma.signSet.findUniqueOrThrow({ where: { id: v.id } })
    expect(after.changedAt).toEqual(changedAt)
    const view = (await api.get(`/api/stops/${stop.id}/sign-set`).expect(200)).body as SignSetView
    expect(view.shelves[0].typeName).toBe('三面柱')
    await api
      .patch(`/api/shelf-types/00000000-0000-4000-8000-000000000000`)
      .send({ name: 'x', form: 'totem' })
      .expect(404)
  })

  it('被站架或模板引用时删除返回 409 并带引用数；未引用的删除写 shelfType 墓碑', async () => {
    const type = (await create({ name: '双立柱站架', form: 'doublePost' }).expect(201)).body as ShelfTypeItem
    const free = (await create({ name: '单立柱站架', form: 'singlePost' }).expect(201)).body as ShelfTypeItem
    const stop = await mkStop('人民广场')
    const v = (await api.get(`/api/stops/${stop.id}/sign-set`).expect(200)).body as SignSetView
    const one = addShelf(v, { type })
    const two = addShelf(one.draft, { type })
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, ...two.draft })
      .expect(200)
    await api.post('/api/shelf-templates').send({ name: '单面', typeId: type.id, boards: [] }).expect(201)
    const res = await api.delete(`/api/shelf-types/${type.id}`).expect(409)
    expect(res.body.code).toBe('IN_USE')
    expect(res.body.details.total).toBe(3)
    expect(res.body.details.referrers).toEqual([
      expect.objectContaining({ type: '站牌集', name: '人民广场（东）' }),
      expect.objectContaining({ type: '站架模板', name: '单面' }),
    ])
    const list = (await api.get('/api/shelf-types').expect(200)).body as ShelfTypeItem[]
    expect(list.find((x) => x.id === type.id)).toMatchObject({ shelfCount: 2, templateCount: 1 })

    await api.delete(`/api/shelf-types/${free.id}`).expect(204)
    expect(await t.prisma.tombstone.findUnique({ where: { objectId: free.id } })).toMatchObject({
      type: 'shelfType',
      name: '单立柱站架',
    })
    await api.delete(`/api/shelf-types/${free.id}`).expect(404)
  })

  it('站牌集保存、模板保存时站架类型必须存在；字典接口不再接受站架类型', async () => {
    const stop = await mkStop('人民广场')
    const v = (await api.get(`/api/stops/${stop.id}/sign-set`).expect(200)).body as SignSetView
    const road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' }).expect(201)).body
    const missing = { id: '00000000-0000-4000-8000-000000000000', name: '没有' }
    const bad = addShelf(v, { type: missing }).draft
    expect(
      (
        await api
          .put(`/api/sign-sets/${v.id}`)
          .send({ rev: v.rev, ...bad })
          .expect(400)
      ).body.message,
    ).toBe('站架类型不存在')
    // 字典项的 ID 不能当站架类型用
    const asDict = addShelf(v, { type: road }).draft
    await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, ...asDict })
      .expect(400)
    const tpl = await api.post('/api/shelf-templates').send({ name: '单面', typeId: road.id, boards: [] }).expect(400)
    expect(tpl.body.message).toBe('站架类型不存在')
    await api.post('/api/dicts').send({ category: 'shelfType', name: '双立柱' }).expect(400)
    await api.get('/api/dicts?category=shelfType').expect(400)
  })

  describe('只读 API', () => {
    let token: ApiTokenCreated
    beforeEach(async () => {
      token = (await api.post('/api/api-tokens').send({ name: '同步' }).expect(201)).body
    })
    const v1 = (path: string) =>
      request(t.app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${token.token}`)
    /** 一路翻页取完 */
    const all = async <T>(path: string) => {
      const out: T[] = []
      let cursor: string | null = null
      do {
        const sep = path.includes('?') ? '&' : '?'
        const page = (await v1(`${path}${cursor ? `${sep}cursor=${cursor}` : ''}`).expect(200)).body as V1Page<T>
        out.push(...page.items)
        cursor = page.nextCursor
      } while (cursor)
      return out
    }

    it('shelf-types：结构形式与完整参数，游标分页与 updatedSince', async () => {
      const ids: string[] = []
      for (const [i, form] of (['singlePost', 'doublePost', 'shelter', 'totem', 'attached'] as const).entries())
        ids.push((await create({ name: `类型${i}`, form }).expect(201)).body.id)
      // 库里参数缺字段（老数据）时补默认值；修改时间放到过去，便于下面看 updatedSince
      await t.prisma.shelfType.update({ where: { id: ids[3] }, data: { params: { faces: 4 } } })
      await t.prisma.shelfType.updateMany({ data: { updatedAt: new Date(Date.now() - 3600_000) } })
      const items = await all<Record<string, unknown>>('/shelf-types?limit=2')
      expect(items.map((x) => x.id).sort()).toEqual([...ids].sort())
      for (const x of items) expect(v1ShelfType.safeParse(x).success).toBe(true)
      expect(items.find((x) => x.id === ids[3])).toMatchObject({
        form: 'totem',
        params: { ...SHELF_PARAM_DEFAULTS.totem, faces: 4 },
      })
      const first = (await v1('/shelf-types').expect(200)).body as V1Page<{ id: string }>
      await new Promise((r) => setTimeout(r, 10))
      await t.prisma.shelfType.update({ where: { id: ids[0] }, data: { updatedAt: new Date(Date.now() + 60_000) } })
      const later = (await v1(`/shelf-types?updatedSince=${first.nextUpdatedSince}`).expect(200)).body
      expect(later.items.map((x: { id: string }) => x.id)).toEqual([ids[0]])
    })

    it('dict-items 合并字典与站架类型：两边 updatedAt 交错时游标不漏、不重；按类别筛选', async () => {
      const base = Date.parse('2026-11-01T00:00:00.000Z')
      const expected: string[] = []
      for (let i = 0; i < 7; i++) {
        const at = new Date(base + i * 1000)
        if (i % 2) {
          const r = await t.prisma.shelfType.create({
            data: { name: `站架${i}`, form: 'doublePost', params: {}, createdAt: at, updatedAt: at },
          })
          expected.push(`shelfType:${r.id}`)
        } else {
          const r = await t.prisma.dictItem.create({ data: { category: 'road', name: `路${i}`, updatedAt: at } })
          expected.push(`road:${r.id}`)
        }
      }
      // 同一时刻两边各一条：按 ID 排
      const same = new Date(base + 10_000)
      const x = await t.prisma.dictItem.create({ data: { category: 'safety', name: '护栏', updatedAt: same } })
      const y = await t.prisma.shelfType.create({
        data: { name: '同时', form: 'totem', params: {}, createdAt: same, updatedAt: same },
      })
      expected.push(
        ...[`safety:${x.id}`, `shelfType:${y.id}`].sort((a, b) => (a.split(':')[1] < b.split(':')[1] ? -1 : 1)),
      )
      for (const limit of [1, 2, 3, 100]) {
        const items = await all<{ id: string; category: string }>(`/dict-items?limit=${limit}`)
        expect(items.map((r) => `${r.category}:${r.id}`)).toEqual(expected)
        for (const r of items) expect(v1DictItem.safeParse(r).success).toBe(true)
      }
      const types = await all<{ category: string }>('/dict-items?category=shelfType&limit=2')
      expect(types).toHaveLength(4)
      expect(types.every((r) => r.category === 'shelfType')).toBe(true)
      const roads = await all<{ category: string }>('/dict-items?category=road')
      expect(roads).toHaveLength(4)
    })

    it('站牌集、站架模板里的 type 带 form；已删除对象里有 shelfType', async () => {
      const type = (await create({ name: '三面图腾柱', form: 'totem' }).expect(201)).body as ShelfTypeItem
      const stop = await mkStop('人民广场')
      const v = (await api.get(`/api/stops/${stop.id}/sign-set`).expect(200)).body as SignSetView
      await api
        .put(`/api/sign-sets/${v.id}`)
        .send({ rev: v.rev, ...addShelf(v, { type }).draft })
        .expect(200)
      await api.post('/api/shelf-templates').send({ name: '每面一块', typeId: type.id, boards: [] }).expect(201)
      const ss = (await v1(`/stops/${stop.id}/sign-set`).expect(200)).body
      expect(ss.shelves[0].type).toEqual({ id: type.id, name: '三面图腾柱', form: 'totem' })
      const tpl = (await v1('/shelf-templates').expect(200)).body.items[0]
      expect(tpl.type).toEqual({ id: type.id, name: '三面图腾柱', form: 'totem' })

      const gone = (await create({ name: '旧类型', form: 'ePost' }).expect(201)).body as ShelfTypeItem
      await api.delete(`/api/shelf-types/${gone.id}`).expect(204)
      const del = (await v1('/deleted?type=shelfType').expect(200)).body.items
      expect(del).toEqual([expect.objectContaining({ type: 'shelfType', id: gone.id, name: '旧类型' })])
    })
  })
})
