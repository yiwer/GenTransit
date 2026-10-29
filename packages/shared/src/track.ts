// 走向轨迹：按站序调用高德驾车路径规划（站点依次作为途经点）算出，手动计算；
// 存为走向字段，不进修改快照（由站序派生，体积大）。坐标为 GCJ-02

export type LngLatPair = [number, number]

export interface RouteTrack {
  /** 按行驶顺序的坐标点（已抽稀） */
  points: LngLatPair[]
  /** 路程，米 */
  distance: number
  computedAt: string
  /** 计算之后站序或站点坐标变了：轨迹已过期，需要重新计算 */
  stale: boolean
}

/** 一次计算的结果：每个走向成功或失败的原因；成功的已保存 */
export interface LineTrackResult {
  results: { routeId: string; ok: boolean; message?: string }[]
}

/** 高德驾车路径规划每次最多 16 个途经点：一段最多 18 个站（起点 + 16 个途经点 + 终点） */
export const TRACK_SEGMENT_STOPS = 18

/** 去掉相邻的重复坐标（同一位置连续两站时高德会把途经点当成无效） */
export function dedupeAdjacent(pts: LngLatPair[]): LngLatPair[] {
  return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
}

/** 把站点坐标切成若干段，每段不超过 max 个点，相邻两段共用端点 */
export function trackSegments(pts: LngLatPair[], max = TRACK_SEGMENT_STOPS): LngLatPair[][] {
  const out: LngLatPair[][] = []
  for (let i = 0; i < pts.length - 1; i += max - 1) out.push(pts.slice(i, i + max))
  return out
}

/** 站序坐标的指纹：保存轨迹时记下，读取时和当前站序比较，不同就是已过期 */
export function trackKeyOf(pts: LngLatPair[]): string {
  const text = pts.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')
  // FNV-1a 的两个 32 位变体拼成 16 位十六进制，够用来判断是否变化
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}:${pts.length}`
}

const M_PER_DEG = 111320

/** 点到线段的距离（米，局部按等距投影近似） */
function offsetMeters(p: LngLatPair, a: LngLatPair, b: LngLatPair) {
  const k = Math.cos((a[1] * Math.PI) / 180)
  const px = (p[0] - a[0]) * k * M_PER_DEG
  const py = (p[1] - a[1]) * M_PER_DEG
  const bx = (b[0] - a[0]) * k * M_PER_DEG
  const by = (b[1] - a[1]) * M_PER_DEG
  const len2 = bx * bx + by * by
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0
  return Math.hypot(px - t * bx, py - t * by)
}

/** 轨迹抽稀（Douglas–Peucker）：去掉偏离折线不到 tolerance 米的点，保留首尾 */
export function simplifyTrack(points: LngLatPair[], tolerance = 2): LngLatPair[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let far = -1
    let max = tolerance
    for (let i = s + 1; i < e; i++) {
      const d = offsetMeters(points[i], points[s], points[e])
      if (d > max) {
        max = d
        far = i
      }
    }
    if (far > 0) {
      keep[far] = 1
      stack.push([s, far], [far, e])
    }
  }
  return points.filter((_, i) => keep[i])
}
