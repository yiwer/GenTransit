// "被引用不能删除"（BR-12）时列出的引用方
import { ROUTE_KIND_LABEL, stopLabel, type Referrer } from '@gentransit/shared'
import type { Tx } from '../prisma/prisma.service'

const LIMIT = 20

const stopRefs = (stops: { id: string; name: string; direction: string }[]): Referrer[] =>
  stops.map((s) => ({ type: '站点', id: s.id, name: stopLabel(s) }))

const STOP_SELECT = { id: true, name: true, direction: true } as const

export async function dictReferrers(db: Tx, id: string) {
  const where = {
    OR: [{ roadId: id }, { platformTypeId: id }, { safetyId: id }, { shelterTypeId: id }, { maintainerId: id }],
  }
  const [stops, stopTotal, lines, lineTotal] = await Promise.all([
    db.stop.findMany({ where, select: STOP_SELECT, take: LIMIT, orderBy: { name: 'asc' } }),
    db.stop.count({ where }),
    db.line.findMany({ where: { fareSystemId: id }, select: { id: true, name: true }, take: LIMIT }),
    db.line.count({ where: { fareSystemId: id } }),
  ])
  return {
    referrers: [...stopRefs(stops), ...lines.map((l) => ({ type: '线路', id: l.id, name: l.name }))],
    total: stopTotal + lineTotal,
  }
}

export async function regionReferrers(db: Tx, id: string) {
  const where = { OR: [{ cityId: id }, { districtId: id }, { streetId: id }] }
  const [children, childTotal, stops, stopTotal] = await Promise.all([
    db.region.findMany({ where: { parentId: id }, select: { id: true, name: true }, take: LIMIT }),
    db.region.count({ where: { parentId: id } }),
    db.stop.findMany({ where, select: STOP_SELECT, take: LIMIT, orderBy: { name: 'asc' } }),
    db.stop.count({ where }),
  ])
  return {
    referrers: [...children.map((c) => ({ type: '下级区划', id: c.id, name: c.name })), ...stopRefs(stops)],
    total: childTotal + stopTotal,
  }
}

export async function companyReferrers(db: Tx, id: string) {
  const [lines, total] = await Promise.all([
    db.line.findMany({ where: { companyId: id }, select: { id: true, name: true }, take: LIMIT }),
    db.line.count({ where: { companyId: id } }),
  ])
  return { referrers: lines.map((l) => ({ type: '线路', id: l.id, name: l.name })), total }
}

export async function landmarkReferrers(db: Tx, id: string) {
  const where = { landmarks: { some: { landmarkId: id } } }
  const [stops, total] = await Promise.all([
    db.stop.findMany({ where, select: STOP_SELECT, take: LIMIT, orderBy: { name: 'asc' } }),
    db.stop.count({ where }),
  ])
  return { referrers: stopRefs(stops), total }
}

export async function landmarkCategoryReferrers(db: Tx, id: string) {
  const [items, total] = await Promise.all([
    db.landmark.findMany({ where: { categoryId: id }, select: { id: true, name: true }, take: LIMIT }),
    db.landmark.count({ where: { categoryId: id } }),
  ])
  return { referrers: items.map((l) => ({ type: '地标', id: l.id, name: l.name })), total }
}

/** 引用站点的路径站：列出线路与走向（AC-09） */
export async function stopReferrers(db: Tx, id: string) {
  const routes = await db.route.findMany({
    where: { stops: { some: { stopId: id } } },
    select: { id: true, kind: true, line: { select: { id: true, name: true } } },
    orderBy: [{ line: { name: 'asc' } }, { kind: 'asc' }],
  })
  return {
    referrers: routes.map((r) => ({ type: '线路走向', id: r.id, name: `${r.line.name} ${ROUTE_KIND_LABEL[r.kind]}` })),
    total: routes.length,
  }
}
