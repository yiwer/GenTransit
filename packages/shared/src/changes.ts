// 站牌集"有变化"的口径（M4 计划 3.5 节）：线路快照的编排投影 = 状态 + 各走向的种类与有序站点 ID。
// 线路有快照写入时，按前后两份投影算出途经变了的站点，更新这些站点站牌集的 changedAt
import type { RouteKind } from './enums'
import { passIndices } from './line'

/** 只用到线路快照里与编排有关的部分 */
export interface LineProjectionSource {
  status: string
  routes: Partial<Record<RouteKind, { stops: { stop: { id: string } }[] }>>
}

const isSource = (v: unknown): v is LineProjectionSource =>
  typeof v === 'object' && v !== null && 'routes' in v && typeof (v as { routes: unknown }).routes === 'object'

/** 每个站点的途经集合 { 走向种类#第几次途经 }；不看线路状态 */
export function passagesByStop(snapshot: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!isSource(snapshot)) return out
  for (const [kind, route] of Object.entries(snapshot.routes ?? {})) {
    const ids = (route?.stops ?? []).map((s) => s.stop.id)
    const pass = passIndices(ids)
    ids.forEach((stopId, i) => {
      const set = out.get(stopId) ?? new Set<string>()
      set.add(`${kind}#${pass[i]}`)
      out.set(stopId, set)
    })
  }
  return out
}

const sameSet = (a: Set<string> | undefined, b: Set<string> | undefined) =>
  (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((x) => b?.has(x))

/**
 * 途经变了的站点。prev 为空表示新建，next 为空表示删除。
 * 线路状态变了（停运、恢复）：前后两份里出现过的站点全部算；否则只算途经集合前后不同的站点
 */
export function touchedStops(prev: unknown, next: unknown): string[] {
  const a = passagesByStop(prev)
  const b = passagesByStop(next)
  const statusOf = (s: unknown) => (isSource(s) ? s.status : null)
  const all = new Set([...a.keys(), ...b.keys()])
  if (!isSource(prev) || !isSource(next) || statusOf(prev) !== statusOf(next)) return [...all].sort()
  return [...all].filter((id) => !sameSet(a.get(id), b.get(id))).sort()
}
