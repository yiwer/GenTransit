// 示意坐标平面：未配置高德或加载失败时的退回方案，端到端测试固定使用它（不依赖外网与密钥）。
// 经纬度按当前中心做等距投影；拖动平移、滚轮缩放、点击选点、拖动标记
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { MapOverlay, ZoomControls } from './overlay'
import { DEFAULT_CENTER, type LngLat, type MapProps } from './types'

const M_PER_DEG_LAT = 110574
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)
const GRID_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]

interface View {
  lng: number
  lat: number
  /** 每像素多少米 */
  mpp: number
}

function fitView(points: LngLat[], w: number, h: number): View {
  if (!points.length) return { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1], mpp: 12 }
  if (points.length === 1) return { lng: points[0][0], lat: points[0][1], mpp: 2 }
  const lngs = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spanX = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng(lat)
  const spanY = (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG_LAT
  const pad = 70
  const mpp = Math.max(spanX / Math.max(1, w - pad * 2), spanY / Math.max(1, h - pad * 2), 1.2)
  return { lng, lat, mpp }
}

export function PlaneMap({
  points = [],
  selectedId,
  hoverId,
  emphasizeIds,
  onSelect,
  onHover,
  onOpen,
  marker,
  onPick,
  circles = [],
  routes = [],
  fit,
  className,
  overlay,
  notice = '示意坐标平面 · 未配置高德底图',
}: MapProps & { notice?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  // 量到容器真实尺寸后再适配一次视野（首帧只能按估计尺寸）
  const [measured, setMeasured] = useState(false)
  const [view, setView] = useState<View>(() => fitView(fit?.points ?? [], 800, 600))
  const [hoverLocal, setHoverLocal] = useState<string | null>(null)
  const drag = useRef<{ kind: 'pan' | 'marker'; sx: number; sy: number; view: View; moved: boolean } | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const measure = () => {
      setBox({ w: el.clientWidth || 800, h: el.clientHeight || 600 })
      if (el.clientWidth) setMeasured(true)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // fit.key 变化时调整视野
  const fitKey = fit?.key
  useEffect(() => {
    if (fit) setView(fitView(fit.points, box.w, box.h))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, measured])

  const toPx = (lng: number, lat: number): [number, number] => [
    box.w / 2 + ((lng - view.lng) * mPerDegLng(view.lat)) / view.mpp,
    box.h / 2 - ((lat - view.lat) * M_PER_DEG_LAT) / view.mpp,
  ]
  const toLngLat = (x: number, y: number): LngLat => [
    view.lng + ((x - box.w / 2) * view.mpp) / mPerDegLng(view.lat),
    view.lat - ((y - box.h / 2) * view.mpp) / M_PER_DEG_LAT,
  ]
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const zoomAt = (f: number, x = box.w / 2, y = box.h / 2) =>
    setView((v) => {
      const mpp = Math.max(0.25, Math.min(400, v.mpp * f))
      // 缩放时保持光标下的位置不动
      const dx = (x - box.w / 2) * (v.mpp - mpp)
      const dy = (y - box.h / 2) * (v.mpp - mpp)
      return { mpp, lng: v.lng + dx / mPerDegLng(v.lat), lat: v.lat - dy / M_PER_DEG_LAT }
    })

  // 滚轮缩放需要非被动监听才能阻止页面滚动
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const onDown = (e: ReactPointerEvent, kind: 'pan' | 'marker') => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { kind, sx: e.clientX, sy: e.clientY, view, moved: false }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true
    if (d.kind === 'pan') {
      if (!d.moved) return
      setView({
        ...d.view,
        lng: d.view.lng - ((e.clientX - d.sx) * d.view.mpp) / mPerDegLng(d.view.lat),
        lat: d.view.lat + ((e.clientY - d.sy) * d.view.mpp) / M_PER_DEG_LAT,
      })
    } else {
      const [x, y] = local(e)
      const [lng, lat] = toLngLat(x, y)
      pickRef.current?.(lng, lat)
    }
  }
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'pan' && !d.moved && pickRef.current) {
      const [x, y] = local(e)
      const [lng, lat] = toLngLat(x, y)
      pickRef.current(lng, lat)
    }
  }

  // 网格：间距取 80–200 像素之间的整米数
  const step = GRID_STEPS.find((s) => s / view.mpp >= 80) ?? GRID_STEPS[GRID_STEPS.length - 1]
  const [lng0, lat1] = toLngLat(0, 0)
  const [lng1, lat0] = toLngLat(box.w, box.h)
  const stepLng = step / mPerDegLng(view.lat)
  const stepLat = step / M_PER_DEG_LAT
  const vLines: number[] = []
  for (let g = Math.ceil(lng0 / stepLng) * stepLng; g <= lng1; g += stepLng) vLines.push(g)
  const hLines: number[] = []
  for (let g = Math.ceil(lat0 / stepLat) * stepLat; g <= lat1; g += stepLat) hLines.push(g)
  const scaleLabel = step >= 1000 ? `${step / 1000} 公里` : `${step} 米`

  return (
    <div
      ref={wrap}
      data-testid="plane-map"
      className={cn(
        'touch-none select-none overflow-hidden bg-[var(--map-land)]',
        onPick ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing',
        !/(^|\s)(absolute|fixed)(\s|$)/.test(className ?? '') && 'relative',
        className,
      )}
      onPointerDown={(e) => onDown(e, 'pan')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="application"
      aria-label="示意地图"
    >
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <pattern id="gt-plane-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--map-casing)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#gt-plane-dots)" opacity={0.6} />
        {vLines.map((g) => {
          const x = toPx(g, view.lat)[0]
          return <line key={`v${g}`} x1={x} x2={x} y1={0} y2={box.h} stroke="var(--map-casing)" strokeWidth={1} />
        })}
        {hLines.map((g) => {
          const y = toPx(view.lng, g)[1]
          return <line key={`h${g}`} x1={0} x2={box.w} y1={y} y2={y} stroke="var(--map-casing)" strokeWidth={1} />
        })}
        {/* 坐标刻度：避开左下角的比例尺 */}
        {vLines
          .filter((g) => toPx(g, view.lat)[0] > 130)
          .map((g) => (
            <text
              key={`vt${g}`}
              x={toPx(g, view.lat)[0] + 4}
              y={box.h - 34}
              fontSize={10}
              fill="var(--map-label)"
              fontFamily="var(--font-mono)"
            >
              {g.toFixed(4)}
            </text>
          ))}
        {hLines
          .filter((g) => toPx(view.lng, g)[1] < box.h - 56)
          .map((g) => (
            <text
              key={`ht${g}`}
              x={6}
              y={toPx(view.lng, g)[1] - 4}
              fontSize={10}
              fill="var(--map-label)"
              fontFamily="var(--font-mono)"
            >
              {g.toFixed(4)}
            </text>
          ))}
      </svg>
      <MapOverlay
        toPx={toPx}
        pxPerMeter={() => 1 / view.mpp}
        points={points}
        circles={circles}
        routes={routes}
        selectedId={selectedId}
        hoverId={hoverId ?? hoverLocal}
        emphasizeIds={emphasizeIds}
        showLabels={view.mpp < 2.5}
        onSelect={onSelect}
        onOpen={onOpen}
        onHover={onHover ?? setHoverLocal}
        marker={marker}
        onMarkerDown={(e) => onDown(e, 'marker')}
      />
      <ZoomControls
        onIn={() => zoomAt(1 / 1.4)}
        onOut={() => zoomAt(1.4)}
        onReset={() =>
          setView(fitView(fit?.points.length ? fit.points : points.map((p) => [p.lng, p.lat]), box.w, box.h))
        }
      />
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-ink-3">
        <span className="flex flex-col items-start">
          <span className="h-1 border-x border-b border-ink-3" style={{ width: step / view.mpp }} />
          <span className="mt-0.5 tabular-nums">{scaleLabel}</span>
        </span>
      </div>
      <div className="pointer-events-none absolute bottom-2.5 right-3 rounded-md bg-surface/80 px-1.5 py-0.5 text-[11px] text-ink-3">
        {notice}
      </div>
      {overlay}
    </div>
  )
}
