// 对向站点的判定（BR-19、M5 计划 2.2）：同名、方位相对（方位模式下的东西南北），300 米内最近的一个；
// 编码模式、方位为"无""场站"时取同名的任意其他站点。站名走（name, direction）唯一索引的前缀，坐标先用包围盒预筛
import { OPPOSITE_MAX_M, type OrientationMode, type StopRef } from '@gentransit/shared'
import { Prisma } from '../generated/prisma/client'
import type { Tx } from '../prisma/prisma.service'

/** 两组经纬度列之间的球面距离（米），与共享包 distanceM 同一公式 */
export const distSql = (lng1: Prisma.Sql, lat1: Prisma.Sql, lng2: Prisma.Sql, lat2: Prisma.Sql) =>
  Prisma.sql`(2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(${lat2} - ${lat1}) / 2), 2) +
    cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians(${lng2} - ${lng1}) / 2), 2)))))`

/** 包围盒预筛的半宽（度）：纬度 0.003° ≈ 333 m；经度在北纬 50° 以内 0.0045° ≥ 320 m */
const BOX_LAT = 0.003
const BOX_LNG = 0.0045

/** ids 为空时判定全部站点 */
export async function oppositesOf(db: Tx, mode: OrientationMode, ids?: string[]): Promise<Map<string, StopRef>> {
  const dirMatch =
    mode === 'orientation'
      ? Prisma.sql`(CASE s.direction WHEN '东' THEN o.direction = '西' WHEN '西' THEN o.direction = '东'
                     WHEN '南' THEN o.direction = '北' WHEN '北' THEN o.direction = '南' ELSE true END)`
      : Prisma.sql`true`
  const dist = distSql(Prisma.sql`s.lng`, Prisma.sql`s.lat`, Prisma.sql`o.lng`, Prisma.sql`o.lat`)
  const rows = await db.$queryRaw<(StopRef & { srcId: string })[]>`
    SELECT DISTINCT ON (s.id) s.id::text AS "srcId", o.id::text AS id, o.name, o.direction, o.lng, o.lat
    FROM "Stop" s
    JOIN "Stop" o ON o.name = s.name AND o.id <> s.id
      AND o.lat BETWEEN s.lat - ${BOX_LAT} AND s.lat + ${BOX_LAT}
      AND o.lng BETWEEN s.lng - ${BOX_LNG} AND s.lng + ${BOX_LNG}
      AND ${dirMatch}
    WHERE ${ids ? Prisma.sql`s.id = ANY(${ids}::uuid[])` : Prisma.sql`true`}
      AND ${dist} <= ${OPPOSITE_MAX_M}
    ORDER BY s.id, ${dist}, o.id`
  return new Map(rows.map(({ srcId, ...o }) => [srcId, o]))
}
