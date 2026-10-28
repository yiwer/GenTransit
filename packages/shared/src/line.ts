// 线路领域规则（M2 计划第 2 节）：模式与走向、改模式的位置映射、第几次途经、到站时刻
import type { LineMode, RouteKind } from './enums'

/** 模式决定走向的数量与名称（按位置） */
export const MODE_ROUTE_KINDS: Record<LineMode, RouteKind[]> = {
  oneway: ['oneway'],
  twoway: ['up', 'down'],
  loop: ['loop'],
  doubleLoop: ['inner', 'outer'],
}

export const SERVICE_TYPES = ['scheduled', 'interval'] as const
export type ServiceType = (typeof SERVICE_TYPES)[number]
export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = { scheduled: '定时班车', interval: '发车间隔' }

export const TICKET_TYPES = ['attended', 'unattended'] as const
export type TicketType = (typeof TICKET_TYPES)[number]
export const TICKET_TYPE_LABEL: Record<TicketType, string> = { attended: '有人售票', unattended: '无人售票' }

export const LINE_STATUSES = ['running', 'suspended'] as const
export type LineStatus = (typeof LINE_STATUSES)[number]
export const LINE_STATUS_LABEL: Record<LineStatus, string> = { running: '运营', suspended: '停运' }

/** 已有走向按旧模式里的位置排序；不属于旧模式的排在最后 */
export function orderRouteKinds(kinds: RouteKind[], mode: LineMode): RouteKind[] {
  const order = MODE_ROUTE_KINDS[mode]
  const pos = (k: RouteKind) => (order.includes(k) ? order.indexOf(k) : order.length + kinds.indexOf(k))
  return [...kinds].sort((a, b) => pos(a) - pos(b))
}

/**
 * 改模式时按位置对应（默认决定 1）：第 i 个旧走向原地改名为第 i 个新走向并保留数据；
 * 多出来的旧走向删除（to 为 null），缺少的新走向新建（from 为 null）
 */
export function mapRoutesOnModeChange(
  existing: RouteKind[],
  oldMode: LineMode,
  newMode: LineMode,
): { from: RouteKind | null; to: RouteKind | null }[] {
  const from = orderRouteKinds(existing, oldMode)
  const to = MODE_ROUTE_KINDS[newMode]
  return Array.from({ length: Math.max(from.length, to.length) }, (_, i) => ({
    from: from[i] ?? null,
    to: to[i] ?? null,
  }))
}

/** 第几次途经：本走向中该站点第几次出现（从 1 起） */
export function passIndices(stopIds: string[]): number[] {
  const seen = new Map<string, number>()
  return stopIds.map((id) => {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    return n
  })
}

/* ---------------- 到站时刻 ---------------- */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const fromMin = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`
}

/** 把 7:5、07:05、0705 之类规整为 HH:mm；不合法返回 null */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().replace('：', ':')
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s)
  if (!m) return null
  const t = `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`
  return TIME_RE.test(t) ? t : null
}

/**
 * 时刻按先后排列：允许跨过一次午夜（夜班线路如 23:50 → 00:10），
 * 也就是整列里"变小"最多出现一次；相等视为不合法（重复时刻）
 */
export function timesInOrder(times: string[]): boolean {
  let wraps = 0
  for (let i = 1; i < times.length; i++) {
    const d = toMin(times[i]) - toMin(times[i - 1])
    if (d === 0) return false
    if (d < 0 && ++wraps > 1) return false
  }
  return true
}

export type TimesParse = { ok: true; times: string[] } | { ok: false; error: string }

/** 解析到站时刻：英文逗号、中文逗号、顿号、分号或空白分隔都接受（默认决定 10） */
export function parseTimes(text: string): TimesParse {
  const parts = text
    .split(/[,，、;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  const times: string[] = []
  for (const p of parts) {
    const t = normalizeTime(p)
    if (!t) return { ok: false, error: `时刻「${p}」格式不对，应为 HH:mm` }
    times.push(t)
  }
  if (!timesInOrder(times)) return { ok: false, error: '时刻没有按先后排列' }
  return { ok: true, times }
}

export const formatTimes = (times: string[]) => times.join(',')

/** 首班到末班按发车间隔展开 */
export function expandSchedule(first: string, last: string, everyMinutes: number): string[] {
  if (!TIME_RE.test(first) || !TIME_RE.test(last) || everyMinutes <= 0) return []
  let end = toMin(last)
  const start = toMin(first)
  if (end < start) end += 1440
  const out: string[] = []
  for (let m = start; m <= end && out.length < 500; m += everyMinutes) out.push(fromMin(m))
  return out
}

/**
 * 按间隔填充：给定首站各班时刻与站间用时（分钟，长度 = 站数 - 1；统一用时就传同一个数），
 * 依次推算后续各站的时刻
 */
export function fillByInterval(firstTimes: string[], segmentMinutes: number[], stopCount: number): string[][] {
  const offsets = [0]
  for (let i = 1; i < stopCount; i++)
    offsets.push(offsets[i - 1] + (segmentMinutes[i - 1] ?? segmentMinutes.at(-1) ?? 0))
  return offsets.map((off) => firstTimes.map((t) => fromMin(toMin(t) + off)))
}
