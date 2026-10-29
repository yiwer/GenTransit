// 自绘 SVG 覆盖层：线路走向、站点、选中涟漪、地标辐射圈、定位标记。高德底图与示意平面共用。
// 站名（方位）标注按 labels.ts 避让，互不重叠
import type { PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { layoutLabels, textWidth, type LabelInput } from './labels'
import type { MapCircle, MapPoint, MapRoute } from './types'

type Px = [number, number]

const TONE_ORDER = { faint: 0, normal: 1, strong: 2 }
const ptsAttr = (pts: Px[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

/** 箭头间距（像素，沿线量）：站点连线和密集的轨迹点都适用 */
const CHEVRON_GAP = 120

/** 沿折线每隔一段路程画一个指向行驶方向的小箭头；整条线太短时不画 */
function chevrons(pts: Px[]) {
  const out: { x: number; y: number; a: number }[] = []
  let next = CHEVRON_GAP / 2
  let walked = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const len = Math.hypot(x2 - x1, y2 - y1)
    while (len > 0 && walked + len >= next) {
      const t = (next - walked) / len
      out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, a: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI })
      next += CHEVRON_GAP
    }
    walked += len
  }
  return walked < 46 ? [] : out
}

/** 按屏幕像素去掉挤在一起的点（离上一个保留点不到 min 像素）：缩小看轨迹时点数少很多，画得快；首尾保留 */
function thin(pts: Px[], min = 1.5): Px[] {
  if (pts.length <= 2) return pts
  const out: Px[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = out[out.length - 1]
    if (Math.abs(pts[i][0] - x) + Math.abs(pts[i][1] - y) >= min) out.push(pts[i])
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * 线宽与右侧偏移随比例尺分三档（参考 SiteFlow 调度地图：缩放 ≥15、≥13、其余），这里按每像素米数判断，
 * 高德底图与示意平面通用（4.2、16.6 米约是示例市纬度上的 15、13 级）
 */
const band = (mpp: number) => (mpp <= 4.2 ? { w: 7, off: 6 } : mpp <= 16.6 ? { w: 6, off: 5 } : { w: 4.5, off: 4 })

/**
 * 折线整体向行驶方向的右侧平移 d 像素（只影响显示）：上下行走同一条路时并排显示，不叠在一起。
 * 拐角处取相邻两段平移后的交点，夹角太尖时直接连接两段端点
 */
function offsetLine(pts: Px[], d: number): Px[] {
  const segs: { a: Px; b: Px; ux: number; uy: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const len = Math.hypot(bx - ax, by - ay)
    if (len < 1e-6) continue
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    segs.push({ a: [ax - uy * d, ay + ux * d], b: [bx - uy * d, by + ux * d], ux, uy })
  }
  if (!segs.length) return pts
  const out: Px[] = [segs[0].a]
  for (let i = 1; i < segs.length; i++) {
    const p = segs[i - 1]
    const q = segs[i]
    const cross = p.ux * q.uy - p.uy * q.ux
    const dot = p.ux * q.ux + p.uy * q.uy
    if (dot > -0.5 && Math.abs(cross) > 1e-9) {
      const t = ((q.a[0] - p.a[0]) * q.uy - (q.a[1] - p.a[1]) * q.ux) / cross
      const m: Px = [p.a[0] + p.ux * t, p.a[1] + p.uy * t]
      if (Math.hypot(m[0] - p.b[0], m[1] - p.b[1]) <= 2 * d) {
        out.push(m)
        continue
      }
    } else if (Math.abs(cross) <= 1e-9 && dot > 0) {
      out.push(p.b)
      continue
    }
    out.push(p.b, q.a)
  }
  out.push(segs[segs.length - 1].b)
  return out
}

/**
 * 线路走向（参考 SiteFlow 调度地图的画法，每个走向一整条，不按站间分段）：
 * 白色描边 + 线路颜色，线上每隔一段画行驶方向箭头；下行、外环是空心线（中间留一道白芯，箭头改用线路颜色）。
 * 没有算出轨迹、只按站点连线的画虚线。突出的走向加粗并有流动的珊瑚色短划；淡显的整体降到 0.32 不透明度
 */
function Routes({ routes, toPx, mpp }: { routes: MapRoute[]; toPx: OverlayProps['toPx']; mpp: number }) {
  const b = band(mpp)
  return [...routes]
    .sort((x, y) => TONE_ORDER[x.tone] - TONE_ORDER[y.tone])
    .map((rt) => {
      const raw = thin(rt.points.map(([lng, lat]) => toPx(lng, lat)))
      if (raw.length < 2) return null
      const pts = offsetLine(raw, b.off)
      const attr = ptsAttr(pts)
      const strong = rt.tone === 'strong'
      const faint = rt.tone === 'faint'
      const w = strong ? b.w + 2 : b.w
      const dash = rt.road ? undefined : '10 7'
      const color = rt.color ?? 'var(--plate)'
      return (
        <g
          key={rt.id}
          data-testid={`map-route-${rt.id}`}
          data-tone={rt.tone}
          data-road={rt.road ? 'track' : 'stops'}
          data-hollow={rt.hollow ? 'true' : undefined}
          opacity={faint ? 0.32 : rt.road ? 1 : 0.85}
          style={{ transition: 'opacity 0.4s var(--spring)' }}
        >
          <polyline
            points={attr}
            fill="none"
            stroke="var(--surface)"
            strokeWidth={w + 3}
            strokeDasharray={dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={attr}
            fill="none"
            stroke={color}
            strokeWidth={w}
            strokeDasharray={dash}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {rt.hollow && (
            <polyline
              points={attr}
              fill="none"
              stroke="var(--surface)"
              strokeWidth={Math.max(1.6, w * 0.4)}
              strokeDasharray={dash}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {rt.flow && (
            <polyline
              points={attr}
              fill="none"
              stroke="var(--coral)"
              strokeWidth={Math.max(3, w - 2)}
              strokeDasharray="8 52"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="gt-flow"
            />
          )}
          {!faint &&
            chevrons(pts).map((c, i) => (
              <path
                key={i}
                d="M -2.5 -3 L 1.8 0 L -2.5 3"
                transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.a.toFixed(1)})`}
                fill="none"
                stroke={rt.hollow ? color : 'var(--surface)'}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
        </g>
      )
    })
}

export interface OverlayProps {
  toPx: (lng: number, lat: number) => Px
  /** 1 米对应多少像素（用于辐射圈） */
  pxPerMeter: (lng: number, lat: number) => number
  /** 当前每像素多少米：线路走向的线宽与偏移按它分档 */
  metersPerPx: number
  points: MapPoint[]
  circles: MapCircle[]
  routes?: MapRoute[]
  selectedId?: string | null
  hoverId?: string | null
  emphasizeIds?: string[]
  showLabels: boolean
  onSelect?: (id: string) => void
  onOpen?: (id: string) => void
  onHover?: (id: string | null) => void
  marker?: { lng: number; lat: number } | null
  onMarkerDown?: (e: ReactPointerEvent) => void
}

const sparkle = (cx: number, cy: number, r: number) =>
  `M ${cx} ${cy - r} C ${cx + 0.6} ${cy - 0.6}, ${cx + 0.6} ${cy - 0.6}, ${cx + r} ${cy} C ${cx + 0.6} ${cy + 0.6}, ${cx + 0.6} ${cy + 0.6}, ${cx} ${cy + r} C ${cx - 0.6} ${cy + 0.6}, ${cx - 0.6} ${cy + 0.6}, ${cx - r} ${cy} C ${cx - 0.6} ${cy - 0.6}, ${cx - 0.6} ${cy - 0.6}, ${cx} ${cy - r} Z`

/** 圆点半径：和下面画圆点的尺寸一致 */
const dotRadius = (s: MapPoint, sel: boolean, big: boolean) => (s.badge ? (sel ? 11 : 9) : sel ? 8.5 : big ? 7 : 5.5)
/** 圆点外侧的白边与阴影，标注避让时算进去 */
const DOT_RIM = 2

let displayFont: string | undefined
const fontFamily = () =>
  (displayFont ??= getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'serif')

/** 站名（方位）标注的框尺寸与避让布局；showLabels 为 false 时只标选中和悬停的站点 */
function labelLayout(p: OverlayProps, emph: Set<string>) {
  const inputs: LabelInput[] = []
  for (const s of p.points) {
    const sel = s.id === p.selectedId
    const hov = s.id === p.hoverId
    if (!p.showLabels && !sel && !hov) continue
    const [x, y] = p.toPx(s.lng, s.lat)
    const size = sel ? 14 : 12.5
    const w =
      textWidth(s.label, size, sel ? 700 : 600, fontFamily()) +
      (s.sub ? textWidth(`（${s.sub}）`, size, 400, fontFamily()) : 0)
    inputs.push({
      id: s.id,
      x,
      y,
      r: dotRadius(s, sel, emph.has(s.id) || hov) + DOT_RIM,
      w: w + LABEL_HALO * 2,
      h: size * LINE_BOX + LABEL_HALO,
      priority: sel ? 3 : hov ? 2 : emph.has(s.id) ? 1 : 0,
    })
  }
  return layoutLabels(inputs)
}

/** 标注描边光晕的宽度（框的左右各留这么多，上下各留一半） */
const LABEL_HALO = 2
/** 实测（浏览器里 SVG 文字的外框）：字框高 1.44 个字号，顶边在基线以上 1.12 个字号 */
const LINE_BOX = 1.44
const ASCENT = 1.12

export function MapOverlay(p: OverlayProps) {
  const emph = new Set(p.emphasizeIds ?? [])
  const hasEmph = emph.size > 0
  const labels = labelLayout(p, emph)
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-hidden" aria-hidden="true">
      {p.circles.map((c) => {
        const [cx, cy] = p.toPx(c.lng, c.lat)
        const r = c.radius * p.pxPerMeter(c.lng, c.lat)
        return (
          <g key={c.id} opacity={c.strong === false ? 0.45 : 1}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="var(--sage)"
              fillOpacity={c.strong ? 0.12 : 0.05}
              stroke="var(--sage)"
              strokeOpacity={c.strong ? 0.85 : 0.45}
              strokeDasharray="2 5"
              strokeWidth={c.strong ? 1.8 : 1.3}
              strokeLinecap="round"
            />
            <path d={sparkle(cx, cy, 5)} fill="var(--sage)" />
            <text
              x={cx + 8}
              y={cy + 4}
              fontSize={11.5}
              fontWeight={600}
              fill="var(--sage)"
              stroke="var(--surface)"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {c.label}
            </text>
          </g>
        )
      })}

      <Routes routes={p.routes ?? []} toPx={p.toPx} mpp={p.metersPerPx} />

      {p.points.map((s) => {
        const [x, y] = p.toPx(s.lng, s.lat)
        const sel = s.id === p.selectedId
        const hov = s.id === p.hoverId
        const em = emph.has(s.id)
        const faded = hasEmph && !em && !sel
        return (
          <g
            key={s.id}
            data-testid={`map-point-${s.id}`}
            className={cn('pointer-events-auto', (p.onSelect || p.onOpen) && 'cursor-pointer')}
            opacity={faded ? 0.45 : 1}
            style={{ transition: 'opacity 0.35s var(--spring)' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              p.onSelect?.(s.id)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              p.onOpen?.(s.id)
            }}
            onMouseEnter={() => p.onHover?.(s.id)}
            onMouseLeave={() => p.onHover?.(null)}
          >
            {sel && (
              <>
                <circle cx={x} cy={y} r={18} fill="var(--coral)" className="gt-ripple" />
                <circle
                  cx={x}
                  cy={y}
                  r={18}
                  fill="var(--coral)"
                  className="gt-ripple"
                  style={{ animationDelay: '1.1s' }}
                />
              </>
            )}
            <circle cx={x} cy={y} r={12} fill="transparent" />
            {s.badge ? (
              // 带序号的站点（线路表单、线路详情）
              <>
                <circle
                  cx={x}
                  cy={y}
                  r={dotRadius(s, sel, false)}
                  fill={sel ? 'var(--plate)' : 'var(--surface)'}
                  stroke="var(--plate)"
                  strokeWidth={sel ? 2.5 : 1.8}
                />
                <text
                  x={x}
                  y={y + 3.6}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={700}
                  fill={sel ? 'var(--plate-ink)' : 'var(--plate)'}
                  style={{ fontFamily: 'var(--font-plate)' }}
                >
                  {s.badge}
                </text>
              </>
            ) : (
              // 站点：墨绿实心圆点 + 白边 + 浅阴影，中心一个白芯（选中时换成珊瑚色），在暖纸、标准、卫星底图上都醒目
              <>
                <circle
                  cx={x}
                  cy={y + 1.2}
                  r={dotRadius(s, sel, em || hov) + 2.2}
                  fill="var(--ink)"
                  fillOpacity={0.2}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={dotRadius(s, sel, em || hov)}
                  fill="var(--plate)"
                  stroke="var(--surface)"
                  strokeWidth={sel ? 2.6 : 2.2}
                  style={{ transition: 'r 0.25s var(--spring)' }}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={sel ? 3.1 : dotRadius(s, sel, em || hov) * 0.34}
                  fill={sel ? 'var(--coral)' : 'var(--surface)'}
                />
              </>
            )}
            {labels.has(s.id) && (
              <text
                x={labels.get(s.id)!.left + LABEL_HALO}
                y={labels.get(s.id)!.top + LABEL_HALO / 2 + (sel ? 14 : 12.5) * ASCENT}
                fontSize={sel ? 14 : 12.5}
                fontWeight={sel ? 700 : 600}
                fill="var(--ink)"
                stroke="var(--surface)"
                strokeWidth={4}
                paintOrder="stroke"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {s.label}
                {s.sub && (
                  <tspan fill="var(--ink-3)" fontWeight={400}>
                    （{s.sub}）
                  </tspan>
                )}
              </text>
            )}
          </g>
        )
      })}

      {p.marker &&
        (() => {
          const [x, y] = p.toPx(p.marker.lng, p.marker.lat)
          return (
            <g data-testid="map-marker" className="pointer-events-auto cursor-move" onPointerDown={p.onMarkerDown}>
              <circle cx={x} cy={y} r={22} fill="var(--coral)" className="gt-ripple" />
              <ellipse cx={x} cy={y + 1} rx={6.5} ry={2.4} fill="var(--ink)" fillOpacity={0.28} />
              <path
                d={`M ${x} ${y} l -10.5 -16.5 a 12 12 0 1 1 21 0 z`}
                fill="var(--plate)"
                stroke="var(--surface)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              <circle cx={x} cy={y - 22} r={4.2} fill="var(--coral)" />
            </g>
          )
        })()}
    </svg>
  )
}

export function ZoomControls({ onIn, onOut, onReset }: { onIn: () => void; onOut: () => void; onReset: () => void }) {
  const btn = 'flex size-8 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink'
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl bg-surface/95 shadow-float ring-1 ring-hairline backdrop-blur">
      <button type="button" aria-label="放大" className={btn} onClick={onIn}>
        <svg
          viewBox="0 0 24 24"
          width={15}
          height={15}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button type="button" aria-label="缩小" className={cn(btn, 'border-t border-hairline')} onClick={onOut}>
        <svg
          viewBox="0 0 24 24"
          width={15}
          height={15}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M5 12h14" />
        </svg>
      </button>
      <button type="button" aria-label="复位视野" className={cn(btn, 'border-t border-hairline')} onClick={onReset}>
        <svg
          viewBox="0 0 24 24"
          width={15}
          height={15}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      </button>
    </div>
  )
}
