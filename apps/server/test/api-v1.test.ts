import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import {
  addBoard,
  addShelf,
  findBoard,
  placeOnBoard,
  placeOnSlot,
  updateBoard,
  type ApiTokenCreated,
  type LineDetail,
  type SignSetView,
  type StopDetail,
  type V1Page,
} from '@gentransit/shared'
import request, { type Agent, type Response } from 'supertest'
import {
  V1CoreController,
  V1DocsController,
  V1FileController,
  V1ReferenceController,
} from '../src/api-v1/api-v1.controller'
import { V1_ENDPOINTS, buildOpenApi } from '../src/api-v1/openapi'
import { createTestApp, type TestApp } from './helpers'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('只读 API 与 API Token（M4 T2、T4）', () => {
  let t: TestApp
  let api: Agent
  let token: ApiTokenCreated

  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
    token = (await api.post('/api/api-tokens').send({ name: '数据中台' }).expect(201)).body
  })
  afterAll(() => t.close())

  /** 只带 Token 的请求（不带 Cookie） */
  const v1 = (path: string, tk = token.token) =>
    request(t.app.getHttpServer()).get(`/api/v1${path}`).set('Authorization', `Bearer ${tk}`)
  const page = async <T>(path: string) => (await v1(path).expect(200)).body as V1Page<T>
  const mkStop = async (name: string, direction = '东', extra: Record<string, unknown> = {}) =>
    (
      await api
        .post('/api/stops')
        .send({ name, direction, lng: 120.2, lat: 30.25, ...extra })
        .expect(201)
    ).body.item as StopDetail
  const stopBody = (s: StopDetail, over: Record<string, unknown> = {}) => ({
    name: s.name,
    direction: s.direction,
    nameEn: s.nameEn,
    lng: s.lng,
    lat: s.lat,
    remark: s.remark,
    rev: s.rev,
    ...over,
  })

  /* ---------------- Token 管理与鉴权 ---------------- */

  describe('Token 与鉴权', () => {
    it('新建：明文只在创建时返回；列表只有前缀；不能重名', async () => {
      expect(token.token).toMatch(/^gt_[A-Za-z0-9_-]{43}$/)
      expect(token.token).toHaveLength(46)
      expect(token.prefix).toBe(token.token.slice(0, 10))
      const list = (await api.get('/api/api-tokens').expect(200)).body
      expect(list).toEqual([
        { id: token.id, name: '数据中台', prefix: token.prefix, createdAt: token.createdAt, lastUsedAt: null },
      ])
      expect(JSON.stringify(list)).not.toContain(token.token)
      // 库里不存明文
      const row = await t.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })
      expect(JSON.stringify(row)).not.toContain(token.token)
      const dup = await api.post('/api/api-tokens').send({ name: '数据中台' }).expect(409)
      expect(dup.body.code).toBe('DUPLICATE')
      await api.post('/api/api-tokens').send({ name: '' }).expect(400)
    })

    it('/api/v1 只认 Token，不认登录 Cookie；内部接口只认会话，不认 Token', async () => {
      const noToken = await request(t.app.getHttpServer()).get('/api/v1/stops').expect(401)
      expect(noToken.body).toEqual({ code: 'UNAUTHORIZED', message: 'API Token 无效或已吊销' })
      await api.get('/api/v1/stops').expect(401)
      await v1('/stops').expect(200)
      await request(t.app.getHttpServer()).get('/api/stops').set('Authorization', `Bearer ${token.token}`).expect(401)
      // Token 不能管理 Token
      await request(t.app.getHttpServer())
        .get('/api/api-tokens')
        .set('Authorization', `Bearer ${token.token}`)
        .expect(401)
      await request(t.app.getHttpServer())
        .post('/api/api-tokens')
        .set('Authorization', `Bearer ${token.token}`)
        .set('X-GT-Request', '1')
        .send({ name: 'x' })
        .expect(401)
      // 不支持放在查询参数里；格式不对、猜一个都不行
      await request(t.app.getHttpServer()).get(`/api/v1/stops?access_token=${token.token}`).expect(401)
      await v1('/stops', `${token.token.slice(0, -1)}A`).expect(401)
      await v1('/stops', 'gt_short').expect(401)
    })

    it('只读：/api/v1 的非 GET 请求返回 404；HEAD 可用', async () => {
      const server = t.app.getHttpServer()
      for (const m of ['post', 'put', 'patch', 'delete'] as const) {
        const agent = request(server)
        const r = await agent[m]('/api/v1/stops')
          .set('Authorization', `Bearer ${token.token}`)
          .set('X-GT-Request', '1')
          .send({})
        expect(r.status).toBe(404)
      }
      const s = await mkStop('人民广场')
      await request(server)
        .delete(`/api/v1/stops/${s.id}`)
        .set('Authorization', `Bearer ${token.token}`)
        .set('X-GT-Request', '1')
        .expect(404)
      await request(server).head('/api/v1/stops').set('Authorization', `Bearer ${token.token}`).expect(200)
    })

    it('吊销后返回 401；最后使用时间每分钟最多写一次', async () => {
      await v1('/stops').expect(200)
      const first = (await t.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt!
      expect(first).toBeInstanceOf(Date)
      await sleep(20)
      await v1('/stops').expect(200)
      expect((await t.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt).toEqual(first)
      await t.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date(Date.now() - 120_000) } })
      await v1('/stops').expect(200)
      const after = (await t.prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt!
      expect(Date.now() - after.getTime()).toBeLessThan(5000)
      expect((await api.get('/api/api-tokens').expect(200)).body[0].lastUsedAt).toBe(after.toISOString())

      await api.delete(`/api/api-tokens/${token.id}`).expect(204)
      const r = await v1('/stops').expect(401)
      expect(r.body.message).toBe('API Token 无效或已吊销')
      await api.delete(`/api/api-tokens/${token.id}`).expect(404)
      expect((await api.get('/api/api-tokens').expect(200)).body).toEqual([])
    })

    it('修改密码不影响 Token', async () => {
      await api.post('/api/auth/password').send({ oldPassword: 'initial-pass-1', newPassword: 'another-pass-2' })
      await v1('/stops').expect(200)
    })
  })

  /* ---------------- AC-17 ---------------- */

  it('AC-17：带 updatedSince 只返回之后有变化的站点；吊销后调用失败', async () => {
    const a = await mkStop('人民广场')
    const b = await mkStop('火车站', '场站')
    const all = await page<{ id: string }>('/stops')
    expect(all.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort())
    await sleep(15)
    const since = new Date().toISOString()
    await sleep(15)
    await api
      .put(`/api/stops/${a.id}`)
      .send(stopBody(a, { remark: '改了备注' }))
      .expect(200)
    const inc = await page<{ id: string; remark: string; changedAt: string }>(
      `/stops?updatedSince=${encodeURIComponent(since)}`,
    )
    expect(inc.items.map((x) => x.id)).toEqual([a.id])
    expect(inc.items[0].remark).toBe('改了备注')
    expect(Date.parse(inc.items[0].changedAt)).toBeGreaterThan(Date.parse(since))
    // 带时区写法也可以
    const local = new Date(Date.parse(since) + 8 * 3600_000).toISOString().replace('Z', '+08:00')
    expect((await page<{ id: string }>(`/stops?updatedSince=${encodeURIComponent(local)}`)).items).toHaveLength(1)
    await api.delete(`/api/api-tokens/${token.id}`).expect(204)
    await v1(`/stops?updatedSince=${encodeURIComponent(since)}`).expect(401)
  })

  /* ---------------- 分页、游标与水位 ---------------- */

  describe('游标与水位', () => {
    it('翻页过程中修改已读过的对象，不漏任何对象；被改的对象在本轮末尾再出现', async () => {
      const ids: string[] = []
      for (let i = 0; i < 5; i++) {
        ids.push((await mkStop(`站${i}`)).id)
        await sleep(3)
      }
      const p1 = await page<{ id: string }>('/stops?limit=2')
      expect(p1.items.map((x) => x.id)).toEqual(ids.slice(0, 2))
      expect(p1.nextCursor).toBeTruthy()
      // 修改第一页里的站点
      const s0 = (await api.get(`/api/stops/${ids[0]}`).expect(200)).body as StopDetail
      await api
        .put(`/api/stops/${s0.id}`)
        .send(stopBody(s0, { remark: '翻页时修改' }))
        .expect(200)
      const seen = [...p1.items.map((x) => x.id)]
      let cursor = p1.nextCursor
      const marks = new Set([p1.nextUpdatedSince])
      while (cursor) {
        const p = await page<{ id: string }>(`/stops?limit=2&cursor=${cursor}`)
        seen.push(...p.items.map((x) => x.id))
        marks.add(p.nextUpdatedSince)
        cursor = p.nextCursor
      }
      expect(new Set(seen)).toEqual(new Set(ids))
      expect(seen.at(-1)).toBe(ids[0])
      // 本轮各页的水位相同
      expect(marks.size).toBe(1)
    })

    it('游标不合法返回 400；limit 超出上限返回 400', async () => {
      const r = await v1('/stops?cursor=abc').expect(400)
      expect(r.body.code).toBe('VALIDATION_FAILED')
      await v1(`/stops?cursor=${Buffer.from('{"w":1}').toString('base64url')}`).expect(400)
      await v1('/stops?limit=501').expect(400)
      await v1('/lines?limit=101').expect(400)
      await v1('/sign-sets?limit=101').expect(400)
      await v1('/stops?updatedSince=昨天').expect(400)
    })

    it('水位：进行中的写事务开始时间之前 5 秒；提交后下一轮能取到', async () => {
      const s = await mkStop('长事务站')
      let mark = ''
      let xactStart = 0
      await t.prisma.$transaction(
        async (tx) => {
          await tx.stop.update({ where: { id: s.id }, data: { remark: '长事务里改的', rev: { increment: 1 } } })
          const [row] = await tx.$queryRaw<{ ms: number }[]>`
            SELECT (extract(epoch FROM xact_start) * 1000)::float8 AS ms FROM pg_stat_activity WHERE pid = pg_backend_pid()`
          xactStart = row.ms
          await sleep(1200)
          const p = await page<{ id: string }>('/stops')
          mark = p.nextUpdatedSince
          // 未提交的修改本轮看不到
          expect(p.items).toHaveLength(1)
        },
        { timeout: 30_000 },
      )
      expect(Date.parse(mark)).toBeLessThanOrEqual(Math.floor(xactStart) - 5000)
      const next = await page<{ id: string; remark: string }>(`/stops?updatedSince=${encodeURIComponent(mark)}`)
      expect(next.items.map((x) => [x.id, x.remark])).toEqual([[s.id, '长事务里改的']])
      // 没有写事务时水位 ≈ 当前时间 − 5 秒
      const idle = await page('/stops')
      expect(Date.now() - 5000 - Date.parse(idle.nextUpdatedSince)).toBeLessThan(3000)
    })
  })

  /* ---------------- 已删除对象 ---------------- */

  it('已删除对象：九种类型；type、updatedSince 与游标生效', async () => {
    const shelfType = (await api.post('/api/dicts').send({ category: 'shelfType', name: '单立柱' }).expect(201)).body
    const road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' }).expect(201)).body
    const city = (await api.post('/api/regions').send({ level: 'city', name: '示例市' }).expect(201)).body
    const company = (await api.post('/api/companies').send({ name: '一公司' }).expect(201)).body
    const cat = (await api.post('/api/landmark-categories').send({ name: '医院', defaultRadius: 300 }).expect(201)).body
    const lm = (
      await api
        .post('/api/landmarks')
        .send({ name: '人民医院', categoryId: cat.id, points: [{ lng: 120.2, lat: 30.25, radius: 300 }] })
        .expect(201)
    ).body
    const tpl = (
      await api.post('/api/shelf-templates').send({ name: '空模板', typeId: shelfType.id, boards: [] }).expect(201)
    ).body
    const s = await mkStop('人民广场')
    const x = await mkStop('火车站', '场站')
    const line = (
      await api
        .post('/api/lines')
        .send({
          name: '1路',
          number: 'L1',
          mode: 'oneway',
          routes: [{ kind: 'oneway', stops: [{ stopId: s.id }, { stopId: x.id }] }],
        })
        .expect(201)
    ).body.item as LineDetail

    await api.delete(`/api/lines/${line.id}`).expect(204)
    await api.delete(`/api/stops/${s.id}`).expect(204)
    await api.delete(`/api/landmarks/${lm.id}`).expect(204)
    await api.delete(`/api/landmark-categories/${cat.id}`).expect(204)
    await api.delete(`/api/shelf-templates/${tpl.id}`).expect(204)
    await api.delete(`/api/dicts/${road.id}`).expect(204)
    await sleep(15)
    const since = new Date().toISOString()
    await sleep(15)
    await api.delete(`/api/regions/${city.id}`).expect(204)
    await api.delete(`/api/companies/${company.id}`).expect(204)

    const all = await page<{ type: string; id: string; name: string; deletedAt: string }>('/deleted?limit=500')
    expect(all.items.map((d) => d.type).sort()).toEqual(
      [
        'busCompany',
        'dictItem',
        'landmark',
        'landmarkCategory',
        'line',
        'region',
        'shelfTemplate',
        'signSet',
        'stop',
      ].sort(),
    )
    expect(all.items.find((d) => d.type === 'stop')).toMatchObject({ id: s.id, name: '人民广场（东）' })
    expect(all.items.find((d) => d.type === 'signSet')?.id).toBe(s.signSet.id)
    expect(all.items.find((d) => d.type === 'region')).toMatchObject({ id: city.id, name: '示例市' })
    const keys = all.items.map((d) => `${d.deletedAt}|${d.id}`)
    expect([...keys].sort()).toEqual(keys)

    expect((await page<{ id: string }>('/deleted?type=dictItem')).items.map((d) => d.id)).toEqual([road.id])
    expect((await page<{ id: string }>('/deleted?type=line')).items.map((d) => d.id)).toEqual([line.id])
    const after = await page<{ id: string }>(`/deleted?updatedSince=${encodeURIComponent(since)}`)
    expect(after.items.map((d) => d.id).sort()).toEqual([city.id, company.id].sort())

    // 每页 2 条翻完，与一次取完相同
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const p: V1Page<{ id: string }> = await page(`/deleted?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...p.items.map((d) => d.id))
      cursor = p.nextCursor
    } while (cursor)
    expect(seen).toEqual(all.items.map((d) => d.id))
    // 已删除的对象返回 404
    await v1(`/stops/${s.id}`).expect(404)
    await v1(`/stops/${s.id}/sign-set`).expect(404)
    await v1(`/landmarks/${lm.id}`).expect(404)
  })

  /* ---------------- 契约 ---------------- */

  describe('契约', () => {
    it('OpenAPI 文档的路径集合与控制器路由一致', () => {
      const routes = new Set<string>()
      for (const C of [V1CoreController, V1ReferenceController, V1FileController, V1DocsController]) {
        const base = Reflect.getMetadata(PATH_METADATA, C) as string
        for (const name of Object.getOwnPropertyNames(C.prototype)) {
          const fn = (C.prototype as unknown as Record<string, unknown>)[name]
          if (name === 'constructor' || typeof fn !== 'function') continue
          const p = Reflect.getMetadata(PATH_METADATA, fn) as string | undefined
          if (p === undefined) continue
          expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET)
          routes.add(`/${base}/${p}`.replace(/:(\w+)/g, '{$1}'))
        }
      }
      const docs = ['/api/v1/openapi.json', '/api/v1/docs', '/api/v1/docs/init.js', '/api/v1/docs/{file}']
      for (const d of docs) expect(routes.delete(d)).toBe(true)
      expect([...routes].sort()).toEqual(V1_ENDPOINTS.map((e) => `/api/v1${e.path}`).sort())
      const doc = buildOpenApi('test')
      expect(Object.keys(doc.paths).sort()).toEqual(V1_ENDPOINTS.map((e) => e.path).sort())
    })

    it('每个接口的响应都能被对应模式严格解析', async () => {
      // 尽量让每个字段都有值
      for (const [owner, key, type] of [
        ['stop', 'area', 'text'],
        ['line', 'night', 'number'],
        ['routeStop', 'tags', 'textList'],
      ] as const)
        await api.post('/api/ext-fields').send({ owner, key, name: key, type }).expect(201)
      await api.post('/api/ext-fields').send({ owner: 'stop', key: 'off', name: '停用的', type: 'text' }).expect(201)
      const up = (await api.post('/api/uploads').attach('file', PNG, { filename: 'a.png', contentType: 'image/png' }))
        .body as { id: string }
      const dict = async (category: string, name: string) =>
        (await api.post('/api/dicts').send({ category, name }).expect(201)).body as { id: string }
      const shelfType = await dict('shelfType', '双立柱')
      const road = await dict('road', '解放路')
      await dict('fareSystem', '一票制')
      const city = (await api.post('/api/regions').send({ level: 'city', name: '示例市' }).expect(201)).body
      await api.post('/api/regions').send({ level: 'district', parentId: city.id, name: '中心区' }).expect(201)
      const company = (await api.post('/api/companies').send({ name: '一公司', logoId: up.id }).expect(201)).body
      const cat = (await api.post('/api/landmark-categories').send({ name: '医院', defaultRadius: 300 }).expect(201))
        .body
      const lm = (
        await api
          .post('/api/landmarks')
          .send({ name: '人民医院', categoryId: cat.id, points: [{ lng: 120.2, lat: 30.25, radius: 300 }] })
          .expect(201)
      ).body
      await api
        .post('/api/shelf-templates')
        .send({
          name: '三片',
          typeId: shelfType.id,
          imageId: up.id,
          boards: [
            {
              face: 'front',
              kind: 'sliced',
              width: 1200,
              height: 1800,
              slots: [{ no: 1, kind: 'route', width: 1200, height: 600 }],
            },
          ],
        })
        .expect(201)
      const a = await mkStop('人民广场', '东', {
        cityId: city.id,
        roadId: road.id,
        landmarkIds: [lm.id],
        photoIds: [up.id],
        ext: { area: '一片区' },
      })
      const b = await mkStop('火车站', '场站')
      const line = (
        await api
          .post('/api/lines')
          .send({
            name: '1路',
            number: 'L1',
            mode: 'twoway',
            companyId: company.id,
            ext: { night: 1 },
            routes: [
              { kind: 'up', stops: [{ stopId: a.id, times: ['07:00'], ext: { tags: ['首站'] } }, { stopId: b.id }] },
              { kind: 'down', stops: [{ stopId: b.id }, { stopId: a.id }] },
            ],
          })
          .expect(201)
      ).body.item as LineDetail
      // 站牌集：一块分片站牌放上行，一块整版站牌放下行；另有一条待编排
      const v = (await api.get(`/api/stops/${a.id}/sign-set`).expect(200)).body as SignSetView
      const sh = addShelf(v, { type: { id: shelfType.id, name: '双立柱' } })
      const whole = addBoard(sh.draft, sh.shelfId)
      const sliced = addBoard(whole.draft, sh.shelfId)
      const slicedDraft = updateBoard(sliced.draft, sliced.boardId, { kind: 'sliced' }).draft
      const slot = { draft: slicedDraft, slotId: findBoard(slicedDraft, sliced.boardId)!.board.slots[0].id }
      const upRoute = line.routes.find((r) => r.kind === 'up')!
      let d = placeOnBoard(
        slot.draft,
        { routeId: line.routes.find((r) => r.kind === 'down')!.id, pass: 1 },
        whole.boardId,
      )
      d = placeOnSlot(d, { routeId: upRoute.id, pass: 1 }, slot.slotId).draft
      await api
        .put(`/api/sign-sets/${v.id}`)
        .send({ rev: v.rev, reminder: '注意', shelves: d.shelves, schedules: d.schedules })
        .expect(200)
      await t.prisma.extField.updateMany({ where: { key: 'off' }, data: { enabled: false } })

      const ids: Record<string, string> = { id: a.id, stopId: a.id }
      for (const e of V1_ENDPOINTS) {
        if (!e.response) continue
        let path = e.path
        if (path === '/lines/{id}') path = `/lines/${line.id}`
        else if (path === '/landmarks/{id}') path = `/landmarks/${lm.id}`
        else if (path === '/landmark-categories/{id}') path = `/landmark-categories/${cat.id}`
        else path = path.replace(/\{(\w+)\}/g, (_, k: string) => ids[k])
        const res = await v1(path).expect(200)
        expect(res.headers['cache-control']).toBe('no-store')
        const r = e.response.safeParse(res.body)
        if (!r.success) throw new Error(`${path}：${r.error.message}`)
        // 已删除对象在本用例里为空，其余列表都要有数据，才算真正校验过
        if ('items' in res.body && e.path !== '/deleted')
          expect([path, res.body.items.length > 0]).toEqual([path, true])
      }
      const st = (await v1(`/stops/${a.id}`).expect(200)).body
      expect(st.ext).toEqual({ area: '一片区' })
      expect(st.photos).toEqual([{ id: up.id, url: `/api/v1/files/${up.id}` }])
      expect(st.landmarks).toEqual([{ id: lm.id, name: '人民医院' }])
      const ss = (await v1(`/stops/${a.id}/sign-set`).expect(200)).body
      expect(ss.counts).toEqual({ waiting: 0, placed: 2, hidden: 0, invalid: 0 })
      expect(ss.passages.map((p: { route: { kind: string }; places: unknown[] }) => [p.route.kind, p.places])).toEqual([
        ['up', [{ boardId: sliced.boardId, slotId: slot.slotId, order: null }]],
        ['down', [{ boardId: whole.boardId, slotId: null, order: 1 }]],
      ])
      const bs = (await v1(`/stops/${b.id}/sign-set`).expect(200)).body
      expect(bs.counts.waiting).toBe(2)
      expect(
        bs.passages.every((p: { status: string; places: unknown[] }) => p.status === 'waiting' && !p.places.length),
      ).toBe(true)
      const ln = (await v1(`/lines/${line.id}`).expect(200)).body
      expect(ln.routes.map((r: { kind: string }) => r.kind)).toEqual(['up', 'down'])
      expect(ln.routes[0].stops[0]).toMatchObject({ seq: 1, pass: 1, times: ['07:00'], ext: { tags: ['首站'] } })
    })
  })

  /* ---------------- 文件与文档 ---------------- */

  it('文件：/api/v1/files 用 Token 下载；内部 /api/uploads 不认 Token', async () => {
    const up = (await api.post('/api/uploads').attach('file', PNG, { filename: '照片.png', contentType: 'image/png' }))
      .body as { id: string }
    const res = await v1(`/files/${up.id}`).buffer(true).parse(binary).expect(200)
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, max-age=86400')
    await request(t.app.getHttpServer())
      .get(`/api/uploads/${up.id}`)
      .set('Authorization', `Bearer ${token.token}`)
      .expect(401)
    await v1('/files/00000000-0000-4000-8000-000000000000').expect(404)
  })

  it('OpenAPI 文档与文档页不需要 Token；只放行 swagger-ui 的几个文件', async () => {
    const server = t.app.getHttpServer()
    const doc = (await request(server).get('/api/v1/openapi.json').expect(200)).body
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.schemas.SignSet.properties.passages).toBeTruthy()
    expect(doc.paths['/stops'].get.parameters.map((p: { name: string }) => p.name)).toEqual([
      'updatedSince',
      'cursor',
      'limit',
    ])
    expect(doc.info.description).toContain('nextUpdatedSince')
    const html = await request(server).get('/api/v1/docs').expect(200)
    expect(html.text).toContain('swagger-ui-bundle.js')
    await request(server).get('/api/v1/docs/swagger-ui-bundle.js').expect(200)
    await request(server).get('/api/v1/docs/init.js').expect(200)
    await request(server).get('/api/v1/docs/package.json').expect(404)
    await request(server).get('/api/v1/docs/..%2F..%2Fpackage.json').expect(404)
  })
})
