// PROTOTYPE — 示意地图（代替高德底图）：暖纸街区底图、线路走向与流动、选中站点涟漪；拖动平移、滚轮缩放、点选、拖动标记
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LANDMARKS, MAP_H, MAP_W, PARKS, RIVER, ROADS } from '../data/mock'
import type { Stop } from '../data/types'
import { cn } from '../ui'

type VB = { x: number; y: number; w: number; h: number }
type Pt = [number, number]

export interface MapRoute {
  id: string
  points: Pt[]
  tone: 'strong' | 'normal' | 'faint'
  flow?: boolean
}

export interface FakeMapProps {
  stops?: Stop[]
  selectedId?: string | null
  hoverId?: string | null
  onSelect?: (id: string) => void
  onHover?: (id: string | null) => void
  emphasizeIds?: string[]
  routes?: MapRoute[]
  marker?: { x: number; y: number } | null
  onPick?: (x: number, y: number) => void
  showLandmarks?: boolean
  /** 只显示这些地标；不传则显示全部 */
  landmarkIds?: string[]
  fit?: { key: string; points: Pt[]; pad?: number } | null
  className?: string
  overlay?: ReactNode
}

// 主干道之间的街区，给底图一点纸面纹理
const XS = [0, 180, 420, 640, 1000]
const YS = [0, 60, 160, 300, 420, 530]
const BLOCKS: { x: number; y: number; w: number; h: number }[] = []
for (let i = 0; i < XS.length - 1; i++)
  for (let j = 0; j < YS.length - 1; j++) {
    const inset = 11
    const b = { x: XS[i] + inset, y: YS[j] + inset, w: XS[i + 1] - XS[i] - inset * 2, h: YS[j + 1] - YS[j] - inset * 2 }
    const hitsPark = PARKS.some((p) => p.x < b.x + b.w && p.x + p.w > b.x && p.y < b.y + b.h && p.y + p.h > b.y)
    if (!hitsPark) BLOCKS.push(b)
  }

const ptsAttr = (pts: Pt[]) => pts.map((p) => p.join(',')).join(' ')

export function FakeMap({ stops = [], selectedId, hoverId, onSelect, onHover, emphasizeIds, routes = [], marker, onPick, showLandmarks, landmarkIds, fit, className, overlay }: FakeMapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [vb, setVb] = useState<VB>({ x: 0, y: 0, w: MAP_W, h: MAP_H })
  const drag = useRef<{ kind: 'pan' | 'marker'; sx: number; sy: number; vb: VB; moved: boolean } | null>(null)
  const [hoverLocal, setHoverLocal] = useState<string | null>(null)
  const [box, setBox] = useState({ w: 800, h: 500 })
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 800, h: el.clientHeight || 500 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const hov = hoverId ?? hoverLocal

  useEffect(() => {
    if (!fit || !fit.points.length) return
    const xs = fit.points.map((p) => p[0])
    const ys = fit.points.map((p) => p[1])
    const pad = fit.pad ?? 70
    let x0 = Math.min(...xs) - pad
    let x1 = Math.max(...xs) + pad
    let y0 = Math.min(...ys) - pad
    let y1 = Math.max(...ys) + pad
    // 至少保留一定视野，单点时不放得过大
    const minW = 320
    if (x1 - x0 < minW) {
      const c = (x0 + x1) / 2
      x0 = c - minW / 2
      x1 = c + minW / 2
    }
    const minH = minW * (MAP_H / MAP_W)
    if (y1 - y0 < minH) {
      const c = (y0 + y1) / 2
      y0 = c - minH / 2
      y1 = c + minH / 2
    }
    setVb({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }, [fit?.key])

  const toSvg = (cx: number, cy: number) => {
    const svg = svgRef.current!
    const pt = svg.createSVGPoint()
    pt.x = cx
    pt.y = cy
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse())
    return { x: p.x, y: p.y }
  }

  const zoom = (f: number, cx?: number, cy?: number) =>
    setVb((v) => {
      const w = Math.max(140, Math.min(MAP_W * 1.4, v.w * f))
      const h = (w / v.w) * v.h
      const ox = cx ?? v.x + v.w / 2
      const oy = cy ?? v.y + v.h / 2
      return { x: ox - ((ox - v.x) / v.w) * w, y: oy - ((oy - v.y) / v.h) * h, w, h }
    })

  const onWheel = (e: React.WheelEvent) => {
    const p = toSvg(e.clientX, e.clientY)
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y)
  }
  const onDown = (e: React.PointerEvent, kind: 'pan' | 'marker') => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { kind, sx: e.clientX, sy: e.clientY, vb, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true
    if (d.kind === 'pan') {
      const svg = svgRef.current!
      const scale = Math.max(d.vb.w / svg.clientWidth, d.vb.h / svg.clientHeight)
      setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.sx) * scale, y: d.vb.y - (e.clientY - d.sy) * scale })
    } else if (onPick) {
      const p = toSvg(e.clientX, e.clientY)
      onPick(p.x, p.y)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && d.kind === 'pan' && !d.moved && onPick) {
      const p = toSvg(e.clientX, e.clientY)
      onPick(p.x, p.y)
    }
  }

  const k = vb.w / MAP_W // 底图比例：道路、公园随缩放变粗变细
  const px = Math.max(vb.w / box.w, vb.h / box.h) // 屏幕比例：标记与文字保持固定像素大小
  const showLabels = vb.w < 560
  const emph = new Set(emphasizeIds ?? [])
  const hasEmph = emph.size > 0
  const order = { faint: 0, normal: 1, strong: 2 }
  const sortedRoutes = [...routes].sort((a, b) => order[a.tone] - order[b.tone])

  return (
    <div className={cn('overflow-hidden bg-[var(--map-land)]', !/(^|\s)(absolute|fixed)(\s|$)/.test(className ?? '') && 'relative', className)}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn('size-full touch-none select-none', onPick ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
        style={{ transition: drag.current ? 'none' : undefined }}
        onWheel={onWheel}
        onPointerDown={(e) => onDown(e, 'pan')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        role="img"
        aria-label="示意地图"
      >
        <rect x={-800} y={-800} width={MAP_W + 1600} height={MAP_H + 1600} fill="var(--map-land)" />
        {BLOCKS.map((b, i) => (
          <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={7} fill="var(--map-block)" />
        ))}
        <polygon points={ptsAttr(RIVER as Pt[])} fill="var(--map-water)" />
        <path d="M 40 590 q 30 -8 60 0 t 60 0 M 520 600 q 30 -8 60 0 t 60 0 M 780 586 q 30 -8 60 0 t 60 0" fill="none" stroke="var(--surface)" strokeOpacity="0.5" strokeWidth={1.5} strokeLinecap="round" />
        {PARKS.map((p) => (
          <g key={p.name}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={12} fill="var(--map-park)" />
            <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 4 * px} textAnchor="middle" fontSize={11 * px} fill="var(--sage)" fontWeight={500}>{p.name}</text>
          </g>
        ))}
        {ROADS.map((r) => (
          <polyline key={r.name + 'c'} points={ptsAttr(r.points as Pt[])} fill="none" stroke="var(--map-casing)" strokeWidth={(r.major ? 14 : 10) * Math.max(k, 0.45)} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {ROADS.map((r) => (
          <polyline key={r.name} points={ptsAttr(r.points as Pt[])} fill="none" stroke={r.major ? 'var(--map-road-major)' : 'var(--map-road)'} strokeWidth={(r.major ? 11 : 7.5) * Math.max(k, 0.45)} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {ROADS.map((r) => {
          const [a, b] = [r.points[0], r.points[r.points.length - 1]]
          const horiz = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])
          const lx = horiz ? 64 : a[0] + 7 * px
          const ly = horiz ? a[1] + (r.points.length > 2 ? 24 : -9) * px : 44
          return (
            <text key={r.name + 't'} x={lx} y={ly} fontSize={10.5 * px} letterSpacing={1.5 * px} fill="var(--map-label)" transform={horiz ? undefined : `rotate(90 ${lx} ${ly})`}>
              {r.name}
            </text>
          )
        })}
        {showLandmarks &&
          LANDMARKS.filter((l) => !landmarkIds || landmarkIds.includes(l.id)).map((l) => (
            <g key={l.id}>
              <circle cx={l.x} cy={l.y} r={l.radius} fill="var(--sage)" fillOpacity={0.045} stroke="var(--sage)" strokeOpacity={0.4} strokeDasharray={`${2 * px} ${5 * px}`} strokeWidth={1.2 * px} strokeLinecap="round" />
              <path d={`M ${l.x} ${l.y - 5 * px} C ${l.x + 0.6 * px} ${l.y - 0.6 * px}, ${l.x + 0.6 * px} ${l.y - 0.6 * px}, ${l.x + 5 * px} ${l.y} C ${l.x + 0.6 * px} ${l.y + 0.6 * px}, ${l.x + 0.6 * px} ${l.y + 0.6 * px}, ${l.x} ${l.y + 5 * px} C ${l.x - 0.6 * px} ${l.y + 0.6 * px}, ${l.x - 0.6 * px} ${l.y + 0.6 * px}, ${l.x - 5 * px} ${l.y} C ${l.x - 0.6 * px} ${l.y - 0.6 * px}, ${l.x - 0.6 * px} ${l.y - 0.6 * px}, ${l.x} ${l.y - 5 * px} Z`} fill="var(--sage)" />
              <text x={l.x + 8 * px} y={l.y + 3.5 * px} fontSize={10.5 * px} fill="var(--sage)" fontWeight={600}>{l.name}</text>
            </g>
          ))}

        {/* 线路：先画淡的，再画强调的；强调线路带珊瑚色流动，指示行驶方向 */}
        {sortedRoutes.map((rt) => (
          <g key={rt.id} pointerEvents="none">
            {rt.tone === 'strong' && <polyline points={ptsAttr(rt.points)} fill="none" stroke="var(--surface)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            <polyline
              points={ptsAttr(rt.points)}
              fill="none"
              stroke="var(--plate)"
              strokeOpacity={rt.tone === 'strong' ? 1 : rt.tone === 'normal' ? 0.55 : 0.22}
              strokeWidth={rt.tone === 'strong' ? 4 : rt.tone === 'normal' ? 2.5 : 2}
              strokeDasharray={rt.tone === 'faint' ? '1 5' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ transition: 'stroke-opacity 0.4s var(--spring)' }}
            />
            {rt.flow && (
              <polyline points={ptsAttr(rt.points)} fill="none" stroke="var(--coral)" strokeWidth={4} strokeDasharray="8 52" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="gt-flow" />
            )}
          </g>
        ))}

        {stops.map((s) => {
          const sel = s.id === selectedId
          const isHov = s.id === hov
          const em = emph.has(s.id)
          const faded = hasEmph && !em && !sel
          return (
            <g
              key={s.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSelect?.(s.id)}
              onMouseEnter={() => (onHover ? onHover(s.id) : setHoverLocal(s.id))}
              onMouseLeave={() => (onHover ? onHover(null) : setHoverLocal(null))}
              className={onSelect ? 'cursor-pointer' : ''}
              opacity={faded ? 0.45 : 1}
              style={{ transition: 'opacity 0.35s var(--spring)' }}
            >
              {sel && (
                <>
                  <circle cx={s.x} cy={s.y} r={16 * px} fill="var(--coral)" className="gt-ripple" />
                  <circle cx={s.x} cy={s.y} r={16 * px} fill="var(--coral)" className="gt-ripple" style={{ animationDelay: '1.1s' }} />
                </>
              )}
              <circle cx={s.x} cy={s.y} r={(sel ? 7.5 : em || isHov ? 5.8 : 4.6) * px} fill={sel ? 'var(--plate)' : 'var(--surface)'} stroke={sel || em ? 'var(--plate)' : 'var(--ink-2)'} strokeWidth={(sel ? 3 : em ? 2.2 : 1.6) * px} style={{ transition: 'r 0.35s var(--bounce)' }} />
              {sel && <circle cx={s.x} cy={s.y} r={2.4 * px} fill="var(--coral)" />}
              {(showLabels || sel || isHov) && (
                <text x={s.x + 10 * px} y={s.y - 8 * px} fontSize={(sel ? 13 : 11.5) * px} fontWeight={sel ? 700 : 500} fill="var(--ink)" stroke="var(--map-land)" strokeWidth={3.5 * px} paintOrder="stroke" style={{ fontFamily: 'var(--font-display)' }}>
                  {s.name}
                  <tspan fill="var(--ink-3)" fontWeight={400}>（{s.direction}）</tspan>
                </text>
              )}
            </g>
          )
        })}

        {marker && (
          <g onPointerDown={(e) => onDown(e, 'marker')} className="cursor-move">
            <circle cx={marker.x} cy={marker.y} r={20 * px} fill="var(--coral)" className="gt-ripple" />
            <ellipse cx={marker.x} cy={marker.y + 1 * px} rx={6 * px} ry={2.2 * px} fill="var(--ink)" fillOpacity={0.25} />
            <path d={`M ${marker.x} ${marker.y} l ${-9.5 * px} ${-15 * px} a ${11 * px} ${11 * px} 0 1 1 ${19 * px} 0 z`} fill="var(--plate)" stroke="var(--surface)" strokeWidth={1.8 * px} strokeLinejoin="round" />
            <circle cx={marker.x} cy={marker.y - 20 * px} r={3.8 * px} fill="var(--coral)" />
          </g>
        )}
      </svg>

      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl bg-surface/95 shadow-float ring-1 ring-hairline backdrop-blur">
        <button aria-label="放大" className="flex size-8 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => zoom(1 / 1.4)}>
          <Plus size={15} />
        </button>
        <button aria-label="缩小" className="flex size-8 items-center justify-center border-t border-hairline text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => zoom(1.4)}>
          <Minus size={15} />
        </button>
        <button aria-label="复位视野" className="flex size-8 items-center justify-center border-t border-hairline text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => setVb({ x: 0, y: 0, w: MAP_W, h: MAP_H })}>
          <LocateFixed size={15} />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-2.5 right-3 rounded-md bg-surface/80 px-1.5 py-0.5 text-[11px] text-ink-3">示意地图 · 正式版为高德底图</div>
      {overlay}
    </div>
  )
}

/** 由站点序列得到示意地图上的折线 */
export const routePoints = (stopIds: string[], stops: Stop[]): Pt[] =>
  stopIds.map((id) => stops.find((s) => s.id === id)).filter(Boolean).map((s) => [s!.x, s!.y] as Pt)
