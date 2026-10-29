// 线路走向的配色与线型：每条线路一个颜色（按线路 id 散列），上行实线、下行空心线。
// 线路列表、线路详情、站点详情的地图，以及线路牌底部的色带共用，同一条线路处处同色
import { ROUTE_KIND_LABEL, type RouteKind } from '@gentransit/shared'

/** FNV-1a 32 位，再用 MurmurHash3 的 fmix32 打散：线路 id（UUIDv7）前缀相同，只差中间几位，单用 FNV 色相会扎堆 */
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** OKLCH 色相 10°～70°（珊瑚色一带）留给行驶方向的流动短划与选中涟漪，不分给线路 */
const SKIP_FROM = 10
const SKIP = 60

/** 线路颜色的色相（0～360，跳过珊瑚色一带）与亮度档（深 -1、浅 +1） */
export function lineHue(id: string): { hue: number; shade: -1 | 1 } {
  const h = hash(id)
  const hue = h % (360 - SKIP)
  return { hue: hue >= SKIP_FROM ? hue + SKIP : hue, shade: (h >>> 16) & 1 ? 1 : -1 }
}

/**
 * 线路颜色：色相按线路 id 散列，亮度分深浅两档（色相接近时多一层区分），彩度固定。
 * 亮度与彩度取主题变量 --route-l、--route-c（暗色主题更亮），在暖色、标准、卫星底图上都看得清
 */
export function lineColor(id: string): string {
  const { hue, shade } = lineHue(id)
  return `oklch(calc(var(--route-l) ${shade > 0 ? '+' : '-'} 5%) var(--route-c) ${hue})`
}

/** 下行、外环画空心线；上行、内环、单向、环线画实线 */
export const isReturnKind = (k: RouteKind) => k === 'down' || k === 'outer'

/** 图例里实线、空心线各代表哪些走向种类（只列出地图上实际有的） */
export function legendKinds(kinds: RouteKind[]) {
  const set = new Set(kinds)
  const pick = (ks: RouteKind[]) => ks.filter((k) => set.has(k)).map((k) => ROUTE_KIND_LABEL[k])
  return { solid: pick(['up', 'inner', 'oneway', 'loop']), hollow: pick(['down', 'outer']) }
}
