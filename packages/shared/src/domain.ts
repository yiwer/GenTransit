// 领域纯函数：排序、中文数字、距离、扩展字段取值校验
import type { ExtType } from './enums'

const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', { numeric: false })
const LINE_RE = /^([^\d]*)(\d+)(.*)$/

/** 中文按拼音序比较 */
export const comparePinyin = (a: string, b: string) => collator.compare(a, b)

/** 线路名自动排序（需求 5.5.6） */
export function compareLineName(a: string, b: string): number {
  if (!a) return b ? 1 : 0
  if (!b) return -1
  const ma = a.match(LINE_RE)
  const mb = b.match(LINE_RE)
  if (!ma && !mb) return collator.compare(a, b)
  if (ma && !mb) {
    const p = ma[1]
    if (!p) return -1
    if (p === b) return 1
    return collator.compare(p, b) || 1
  }
  if (!ma && mb) {
    const p = mb[1]
    if (!p) return 1
    if (p === a) return -1
    return collator.compare(a, p) || -1
  }
  const [, pa, na, sa] = ma!
  const [, pb, nb, sb] = mb!
  if (!pa && pb) return -1
  if (pa && !pb) return 1
  const pc = collator.compare(pa, pb)
  if (pc) return pc
  const nc = Number(na) - Number(nb)
  if (nc) return nc
  return collator.compare(sa, sb)
}

const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
/** 1–99 转中文数字，用于站架、站牌编号 */
export function cnNum(n: number): string {
  if (n <= 0) return String(n)
  if (n < 10) return CN[n]
  if (n < 20) return '十' + CN[n % 10]
  if (n < 100) return CN[Math.floor(n / 10)] + '十' + CN[n % 10]
  return String(n)
}

const EARTH_R = 6371008.8
/** 两点球面距离（米） */
export function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 坐标统一保留 6 位小数（约 0.1 米），避免浮点噪声影响有效修改判定 */
export const roundCoord = (v: number) => Math.round(v * 1e6) / 1e6

/** 站点显示名：站名（方位） */
export const stopLabel = (s: { name: string; direction: string }) => `${s.name}（${s.direction}）`

export interface ExtFieldDefLike {
  key: string
  name: string
  type: ExtType
  options: string[]
}

export type ExtCheck = { ok: true; value: unknown } | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** 按字段定义校验并规范化扩展字段取值；空值统一为 null */
export function checkExtValue(def: ExtFieldDefLike, raw: unknown): ExtCheck {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null }
  switch (def.type) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `「${def.name}」应为文本` }
      const v = raw.trim()
      if (v.length > 500) return { ok: false, error: `「${def.name}」不能超过 500 字` }
      return { ok: true, value: v || null }
    }
    case 'select': {
      if (typeof raw !== 'string' || !def.options.includes(raw))
        return { ok: false, error: `「${def.name}」只能从下拉选项中选择` }
      return { ok: true, value: raw }
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
      if (!Number.isFinite(n)) return { ok: false, error: `「${def.name}」应为数字` }
      return { ok: true, value: n }
    }
    case 'date': {
      if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(raw)))
        return { ok: false, error: `「${def.name}」应为日期（YYYY-MM-DD）` }
      return { ok: true, value: raw }
    }
    case 'time': {
      if (typeof raw !== 'string' || !TIME_RE.test(raw)) return { ok: false, error: `「${def.name}」应为时间（HH:mm）` }
      return { ok: true, value: raw }
    }
    case 'textList': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string'))
        return { ok: false, error: `「${def.name}」应为文本列表` }
      const v = (raw as string[]).map((x) => x.trim()).filter(Boolean)
      if (v.some((x) => x.length > 200)) return { ok: false, error: `「${def.name}」每项不能超过 200 字` }
      return { ok: true, value: v.length ? v : null }
    }
  }
}

/** 扩展字段取值的展示文本 */
export function formatExtValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join('、')
  return String(v)
}
