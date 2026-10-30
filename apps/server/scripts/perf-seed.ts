// M6 性能测量用的造数脚本（M6 计划第 6 节）：设计规模、站点铺成城市网格、线路沿网格游走、走向全部带轨迹，
// 另造一个 128 个走向左右经过的枢纽站。不进测试，手动对着临时库运行（库要先 prisma migrate deploy，且没有站点）：
//   DATABASE_URL=postgresql://... node --import tsx scripts/perf-seed.ts
// 不读取根目录 .env，避免误写开发库
import { randomUUID } from 'node:crypto'
import { dedupeAdjacent, trackKeyOf, type LngLatPair } from '@gentransit/shared'
import { Pool } from 'pg'
import { seedSchedules, seedSignSetShelves, type RawSql } from '../test/design-scale'

const COLS = 125
const ROWS = 160
const STEP_LNG = 0.0028
const STEP_LAT = 0.0024
const CENTER: LngLatPair = [120.2, 30.25]
const LINES = 3000
const ROUTE_STOPS = 30
const HUB_LINES = 60
/** 枢纽站在上下行里的位置（第 15 站） */
const HUB_SEQ = 15

/** mulberry32：32 位整数运算的伪随机数，固定种子每次造出同样的网络 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261030)
const int = (n: number) => Math.floor(rand() * n)
const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

/** 站点：125×160 网格，每个格点 ±30% 抖动 */
function buildStops() {
  return Array.from({ length: COLS * ROWS }, (_, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const lng = CENTER[0] + (col - (COLS - 1) / 2 + (rand() - 0.5) * 0.6) * STEP_LNG
    const lat = CENTER[1] + (row - (ROWS - 1) / 2 + (rand() - 0.5) * 0.6) * STEP_LAT
    return {
      id: randomUUID(),
      name: `站${i + 1}`,
      direction: ['东', '南', '西', '北'][i % 4],
      lng: round6(lng),
      lat: round6(lat),
    }
  })
}

/** 一个走向：在网格上随机游走 30 个不重复的格子，七成概率沿原方向；走进死角就换个起点重来 */
function walk(): number[] {
  for (;;) {
    let col = int(COLS)
    let row = int(ROWS)
    let dir = int(4)
    const seen = new Set([row * COLS + col])
    const cells = [row * COLS + col]
    while (cells.length < ROUTE_STOPS) {
      const first = rand() < 0.7 ? dir : int(4)
      const order = [first, ...[0, 1, 2, 3].filter((d) => d !== first).sort(() => rand() - 0.5)]
      const next = order.find((d) => {
        const c = col + DIRS[d][0]
        const r = row + DIRS[d][1]
        return c >= 0 && c < COLS && r >= 0 && r < ROWS && !seen.has(r * COLS + c)
      })
      if (next === undefined) break
      dir = next
      col += DIRS[dir][0]
      row += DIRS[dir][1]
      seen.add(row * COLS + col)
      cells.push(row * COLS + col)
    }
    if (cells.length === ROUTE_STOPS) return cells
  }
}

const M_PER_DEG = 111320

function meters(a: LngLatPair, b: LngLatPair) {
  const k = Math.cos((a[1] * Math.PI) / 180)
  return Math.hypot((b[0] - a[0]) * k * M_PER_DEG, (b[1] - a[1]) * M_PER_DEG)
}

/** 轨迹：相邻两站之间插 10 个点，加几米的扰动；trackKey 与服务端判断过期的算法相同，所以不过期 */
function trackOf(coords: LngLatPair[]) {
  const points: LngLatPair[] = []
  for (let i = 0; i < coords.length - 1; i++) {
    const [a, b] = [coords[i], coords[i + 1]]
    for (let k = 0; k < 10; k++) {
      const jitter = k === 0 ? 0 : 0.00004
      points.push([
        round6(a[0] + ((b[0] - a[0]) * k) / 10 + (rand() - 0.5) * jitter),
        round6(a[1] + ((b[1] - a[1]) * k) / 10 + (rand() - 0.5) * jitter),
      ])
    }
  }
  points.push(coords[coords.length - 1])
  let distance = 0
  for (let i = 1; i < points.length; i++) distance += meters(points[i - 1], points[i])
  return { points, distance: Math.round(distance), key: trackKeyOf(dedupeAdjacent(coords)) }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('请设置 DATABASE_URL（指向临时库）')
  const pool = new Pool({ connectionString: url })
  const db: RawSql = { $executeRawUnsafe: async (q) => (await pool.query(q)).rowCount ?? 0 }
  const started = Date.now()
  const log = (msg: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`)
  try {
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM "Stop"')
    if (rows[0].n > 0) throw new Error('库里已有站点；请对着空的临时库运行')

    const stops = buildStops()
    const lines = Array.from({ length: LINES }, (_, i) => {
      const n = i + 1
      const up = walk()
      return {
        id: randomUUID(),
        name: `${['', 'K', 'B', '夜'][n % 4]}${n}路`,
        number: `N-${n}`,
        status: n % 30 === 0 ? 'suspended' : 'running',
        up,
        down: [...up].reverse(),
      }
    })

    // 枢纽站：离网格中心最近、本来有 4 条线路经过的格点；再挑 60 条不经过它的线路，把上下行第 15 站都换成它，
    // 共 128 个走向经过
    const visits = new Map<number, number>()
    for (const l of lines) for (const c of new Set(l.up)) visits.set(c, (visits.get(c) ?? 0) + 1)
    const mid = Math.floor(ROWS / 2) * COLS + Math.floor(COLS / 2)
    const nearest = (n: number, except = -1) =>
      [...visits.entries()]
        .filter(([c, v]) => v === n && c !== except)
        .sort((a, b) => Math.abs(a[0] - mid) - Math.abs(b[0] - mid))[0][0]
    const hub = nearest(4)
    const candidates = lines.filter((l) => !l.up.includes(hub))
    for (let i = 0; i < HUB_LINES; i++) {
      const [l] = candidates.splice(int(candidates.length), 1)
      l.up[HUB_SEQ - 1] = hub
      l.down[HUB_SEQ - 1] = hub
    }
    stops[hub].name = '枢纽站'
    // 普通站：经过线路数等于中位数的格点里离网格中心最近的一个
    const counts = [...visits.values()].sort((a, b) => a - b)
    const plain = nearest(counts[Math.floor(counts.length / 2)], hub)
    stops[plain].name = '普通站'

    log(`写入站点 ${stops.length}`)
    await pool.query(
      `INSERT INTO "Stop" (id, name, direction, lng, lat, "updatedAt")
       SELECT u.*, now() FROM unnest($1::uuid[], $2::text[], $3::text[], $4::float8[], $5::float8[]) AS u`,
      [
        stops.map((s) => s.id),
        stops.map((s) => s.name),
        stops.map((s) => s.direction),
        stops.map((s) => s.lng),
        stops.map((s) => s.lat),
      ],
    )
    log('写入站牌集、站架、站牌')
    await seedSignSetShelves(db)

    log(`写入线路 ${lines.length}`)
    await pool.query(
      `INSERT INTO "Line" (id, name, number, mode, status, "updatedAt")
       SELECT u.id, u.name, u.number, 'twoway', u.status::"LineStatus", now()
       FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS u(id, name, number, status)`,
      [lines.map((l) => l.id), lines.map((l) => l.name), lines.map((l) => l.number), lines.map((l) => l.status)],
    )

    const routes = lines.flatMap((l) =>
      (['up', 'down'] as const).map((kind) => {
        const cells = kind === 'up' ? l.up : l.down
        const coords = cells.map((c) => [stops[c].lng, stops[c].lat] as LngLatPair)
        return { id: randomUUID(), lineId: l.id, kind, cells, track: trackOf(coords) }
      }),
    )
    log(`写入走向 ${routes.length}（带轨迹）与途经`)
    for (let i = 0; i < routes.length; i += 500) {
      const batch = routes.slice(i, i + 500)
      await pool.query(
        `INSERT INTO "Route" (id, "lineId", kind, track, "trackKey", "trackDistance", "trackAt", "updatedAt")
         SELECT u.id, u.line, u.kind::"RouteKind", u.track::jsonb, u.key, u.distance, now(), now()
         FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::int[])
           AS u(id, line, kind, track, key, distance)`,
        [
          batch.map((r) => r.id),
          batch.map((r) => r.lineId),
          batch.map((r) => r.kind),
          batch.map((r) => JSON.stringify(r.track.points)),
          batch.map((r) => r.track.key),
          batch.map((r) => r.track.distance),
        ],
      )
      const rs = batch.flatMap((r) => r.cells.map((c, k) => ({ route: r.id, stop: stops[c].id, seq: k + 1 })))
      await pool.query(
        `INSERT INTO "RouteStop" (id, "routeId", "stopId", seq, times, "updatedAt")
         SELECT gen_random_uuid(), u.route, u.stop, u.seq, '{}', now()
         FROM unnest($1::uuid[], $2::uuid[], $3::int[]) AS u(route, stop, seq)`,
        [rs.map((x) => x.route), rs.map((x) => x.stop), rs.map((x) => x.seq)],
      )
    }

    log('写入编排')
    await seedSchedules(db)
    await pool.query('ANALYZE')

    const { rows: stat } = await pool.query<Record<string, number>>(`
      SELECT (SELECT count(*) FROM "Stop")::int AS stops,
             (SELECT count(DISTINCT "stopId") FROM "RouteStop")::int AS "servedStops",
             (SELECT count(*) FROM "Line")::int AS lines,
             (SELECT count(*) FROM "Route")::int AS routes,
             (SELECT count(*) FROM "RouteStop")::int AS "routeStops",
             (SELECT count(*) FROM "Shelf")::int AS shelves,
             (SELECT count(*) FROM "Board")::int AS boards,
             (SELECT count(*) FROM "Schedule")::int AS schedules,
             (SELECT count(DISTINCT rs."routeId") FROM "RouteStop" rs JOIN "Stop" s ON s.id = rs."stopId"
               WHERE s.name = '枢纽站')::int AS "hubRoutes",
             (SELECT count(DISTINCT rs."routeId") FROM "RouteStop" rs JOIN "Stop" s ON s.id = rs."stopId"
               WHERE s.name = '普通站')::int AS "plainRoutes"`)
    log(`完成：${JSON.stringify(stat[0])}`)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
