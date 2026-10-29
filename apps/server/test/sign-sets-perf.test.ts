import type { SignSetView } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

/**
 * 需求 7.1、M3 计划 3.2：设计规模（站点 2 万、线路 3000、站架 5 万、站牌 10 万，途经约 18 万）下
 * 站牌集列表（含"只看待处理"）、工作台汇总、编辑器读取与保存都在 1 秒内
 */
describe('站牌集性能（设计规模）', () => {
  let t: TestApp
  let api: Agent

  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    const sql = (q: TemplateStringsArray) => t.prisma.$executeRawUnsafe(q.join(''))
    await sql`
      INSERT INTO "Stop" (id, name, direction, lng, lat, "updatedAt")
      SELECT gen_random_uuid(), '站' || i, (ARRAY['东', '南', '西', '北'])[1 + i % 4], 120 + i * 0.00001, 30.2, now()
      FROM generate_series(1, 20000) AS i`
    await sql`INSERT INTO "SignSet" (id, "stopId", "updatedAt") SELECT gen_random_uuid(), id, now() FROM "Stop"`
    await sql`
      INSERT INTO "DictItem" (id, category, name, "updatedAt")
      VALUES (gen_random_uuid(), 'shelfType', '双立柱站架', now()), (gen_random_uuid(), 'shelfType', '候车亭灯箱', now())`
    // 每个站牌集 2～3 个站架（共约 5 万），每个站架 2 块整版站牌（约 10 万）
    await sql`
      INSERT INTO "Shelf" (id, "signSetId", "typeId", no, sort, "updatedAt")
      SELECT gen_random_uuid(), ss.id,
             (SELECT id FROM "DictItem" WHERE category = 'shelfType' ORDER BY name LIMIT 1 OFFSET n % 2), n, n - 1, now()
      FROM "SignSet" ss CROSS JOIN generate_series(1, 3) AS n
      WHERE n <= 2 + abs(hashtext(ss.id::text)) % 2`
    await sql`
      INSERT INTO "Board" (id, "shelfId", "signSetId", no, face, kind, width, height, sort, "updatedAt")
      SELECT gen_random_uuid(), sh.id, sh."signSetId", (sh.no - 1) * 2 + k, (ARRAY['front', 'back'])[k]::"BoardFace",
             'whole', (ARRAY[1200, 600])[k], 1800, k - 1, now()
      FROM "Shelf" sh CROSS JOIN generate_series(1, 2) AS k`
    // 3000 条双边线路，每个走向 30 站（途经 18 万）；其中 100 条停运
    await sql`
      INSERT INTO "Line" (id, name, number, mode, status, "updatedAt")
      SELECT gen_random_uuid(), (ARRAY['', 'K', 'B', '夜'])[1 + i % 4] || i || '路', 'N-' || i, 'twoway',
             (CASE WHEN i % 30 = 0 THEN 'suspended' ELSE 'running' END)::"LineStatus", now()
      FROM generate_series(1, 3000) AS i`
    await sql`
      INSERT INTO "Route" (id, "lineId", kind, "updatedAt")
      SELECT gen_random_uuid(), l.id, k.kind::"RouteKind", now() FROM "Line" l CROSS JOIN (VALUES ('up'), ('down')) AS k(kind)`
    await sql`
      WITH st AS (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM "Stop"),
           rr AS (SELECT id, abs(hashtext(id::text)) AS h FROM "Route")
      INSERT INTO "RouteStop" (id, "routeId", "stopId", seq, times, "updatedAt")
      SELECT gen_random_uuid(), rr.id, st.id, n, '{}', now()
      FROM rr CROSS JOIN generate_series(1, 30) AS n
      JOIN st ON st.rn = 1 + (rr.h + n * 613) % 20000`
    // 九成途经已放到各站牌集的一号牌；另有部分失效编排（不存在的第 9 次途经）
    await sql`
      WITH p AS (
        SELECT ss.id AS sid, rs."routeId",
               row_number() OVER (PARTITION BY rs."routeId", rs."stopId" ORDER BY rs.seq) AS pass
        FROM "RouteStop" rs JOIN "SignSet" ss ON ss."stopId" = rs."stopId"
      ),
      b AS (SELECT DISTINCT ON ("signSetId") id, "signSetId" FROM "Board" ORDER BY "signSetId", no)
      INSERT INTO "Schedule" (id, "signSetId", "routeId", pass, placement, "boardId", "order")
      SELECT gen_random_uuid(), p.sid, p."routeId", p.pass, 'board', b.id,
             row_number() OVER (PARTITION BY b.id ORDER BY p."routeId", p.pass)
      FROM p JOIN b ON b."signSetId" = p.sid
      WHERE abs(hashtext(p."routeId"::text || p.sid::text)) % 10 <> 0`
    await sql`
      INSERT INTO "Schedule" (id, "signSetId", "routeId", pass, placement, "boardId", "order")
      SELECT gen_random_uuid(), "signSetId", "routeId", 9, 'board', "boardId", 1000
      FROM (SELECT DISTINCT ON ("signSetId") * FROM "Schedule" ORDER BY "signSetId", id) x
      WHERE abs(hashtext("signSetId"::text)) % 20 = 0`
    await sql`ANALYZE`
  }, 600_000)
  afterAll(() => t.close())

  const timed = async (url: string) => {
    await api.get(url).expect(200)
    const start = performance.now()
    const res = await api.get(url).expect(200)
    return { ms: performance.now() - start, body: res.body }
  }

  it('规模核对', async () => {
    const [row] = await t.prisma.$queryRaw<{ shelves: number; boards: number; rs: number; schedules: number }[]>`
      SELECT (SELECT count(*) FROM "Shelf")::int AS shelves, (SELECT count(*) FROM "Board")::int AS boards,
             (SELECT count(*) FROM "RouteStop")::int AS rs, (SELECT count(*) FROM "Schedule")::int AS schedules`
    console.log(`站架 ${row.shelves}，站牌 ${row.boards}，路径站 ${row.rs}，编排 ${row.schedules}`)
    expect(row.shelves).toBeGreaterThan(45000)
    expect(row.boards).toBeGreaterThan(90000)
    expect(row.rs).toBe(180000)
  })

  it.each([
    ['默认第一页', '/api/sign-sets'],
    ['每页 100 条，靠后的页', '/api/sign-sets?size=100&page=150'],
    ['只看待处理', '/api/sign-sets?pending=1'],
    ['按待处理数排序', '/api/sign-sets?sort=-pending&size=100'],
    ['只看待处理 + 站架类型 + 站牌尺寸', '/api/sign-sets?pending=1&boardSize=600x1800'],
    ['按站名搜索', `/api/sign-sets?q=${encodeURIComponent('站12')}`],
    ['工作台汇总', '/api/sign-sets/summary'],
    ['站牌尺寸下拉', '/api/sign-sets/board-sizes'],
  ])('%s < 1 秒', async (_, url) => {
    const { ms, body } = await timed(url)
    console.log(`${url} ${Math.round(ms)} ms`)
    expect(body).toBeTruthy()
    expect(ms).toBeLessThan(1000)
  })

  it('汇总的数字与列表一致', async () => {
    const s = (await api.get('/api/sign-sets/summary')).body
    const pending = (await api.get('/api/sign-sets?pending=1&size=1')).body
    expect(s.signSets).toBe(20000)
    expect(pending.total).toBe(s.pendingSets)
    expect(s.waiting).toBeGreaterThan(0)
    expect(s.invalid).toBeGreaterThan(0)
  })

  it('编辑器读取与保存 < 1 秒', async () => {
    const [{ stopId }] = await t.prisma.$queryRaw<{ stopId: string }[]>`
      SELECT ss."stopId"::text AS "stopId" FROM "SignSet" ss
      JOIN "Schedule" s ON s."signSetId" = ss.id GROUP BY ss."stopId" ORDER BY count(*) DESC LIMIT 1`
    const { ms, body } = await timed(`/api/stops/${stopId}/sign-set`)
    const v = body as SignSetView
    console.log(`编辑器读取 ${Math.round(ms)} ms（${v.schedules.length} 条编排、${v.passages.length} 个途经）`)
    expect(ms).toBeLessThan(1000)
    const start = performance.now()
    const r = await api
      .put(`/api/sign-sets/${v.id}`)
      .send({ rev: v.rev, reminder: '性能测试', shelves: v.shelves, schedules: v.schedules })
      .expect(200)
    const saveMs = performance.now() - start
    console.log(`保存 ${Math.round(saveMs)} ms`)
    expect(r.body.changed).toBe(true)
    expect(saveMs).toBeLessThan(1000)
  })
})
