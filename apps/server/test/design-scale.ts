import type { PrismaService } from '../src/prisma/prisma.service'

/**
 * 设计规模的数据（需求 7.1）：站点 2 万、线路 3000（100 条停运）、站架约 5 万、站牌约 10 万、途经 18 万，
 * 九成途经已编排，另有部分失效编排。站牌集性能测试与只读 API 性能测试共用
 */
export async function seedDesignScale(prisma: PrismaService) {
  const sql = (q: TemplateStringsArray) => prisma.$executeRawUnsafe(q.join(''))
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
}
