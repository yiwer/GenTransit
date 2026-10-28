// PROTOTYPE — 高德底图 + 我们自己的 SVG 覆盖层。
// 底图只负责街道与平移缩放，并用滤镜调成暖纸色；站点、线路、涟漪、流动、定位标记仍由覆盖层绘制，保持设计语言一致。
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LANDMARKS, MAP_H, MAP_W, xyToLngLat, lngLatToXy } from '../data/mock'
import { cn } from '../ui'
import { loadAMap } from './amap'
import { FakeMap, type FakeMapProps } from './FakeMap'

type Pt = [number, number]
const M_PER_UNIT = (0.2 / MAP_W) * 111320 * Math.cos((30.25 * Math.PI) / 180) // 示意坐标 1 单位 ≈ 19 米

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])
  return dark
}

const STYLE = { light: 'amap://styles/whitesmoke', dark: 'amap://styles/dark' }
const TINT = {
  light: 'sepia(0.28) saturate(0.78) hue-rotate(-8deg) brightness(1.03) contrast(0.96)',
  dark: 'sepia(0.35) saturate(0.6) hue-rotate(-10deg) brightness(0.92)',
}

export function RealMap(props: FakeMapProps) {
  const { stops = [], selectedId, hoverId, onSelect, onHover, emphasizeIds, routes = [], marker, onPick, showLandmarks, landmarkIds, fit, className, overlay } = props
  const holder = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const AMapRef = useRef<any>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [hoverLocal, setHoverLocal] = useState<string | null>(null)
  const dark = useDark()
  const hov = hoverId ?? hoverLocal

  useEffect(() => {
    let dead = false
    let anim = false
    loadAMap()
      .then((AMap) => {
        if (dead || !holder.current) return
        AMapRef.current = AMap
        const map = new AMap.Map(holder.current, {
          viewMode: '2D',
          zoom: 13,
          center: [120.2, 30.25],
          mapStyle: document.documentElement.classList.contains('dark') ? STYLE.dark : STYLE.light,
          features: ['bg', 'road', 'building'], // 不显示 POI，避免和地标打架
          showLabel: true,
          resizeEnable: true,
        })
        map.addControl(new AMap.Scale({ position: 'LB' }))
        mapRef.current = map
        const bump = () => setTick((t) => t + 1)
        // 平移、缩放动画期间逐帧刷新覆盖层
        const loop = () => {
          if (!anim) return
          bump()
          requestAnimationFrame(loop)
        }
        const start = () => {
          if (anim) return
          anim = true
          loop()
        }
        const end = () => {
          anim = false
          bump()
        }
        map.on('movestart', start)
        map.on('zoomstart', start)
        map.on('dragstart', start)
        map.on('moveend', end)
        map.on('zoomend', end)
        map.on('dragend', end)
        map.on('mapmove', bump)
        map.on('resize', bump)
        map.on('click', (e: any) => {
          if (!pickRef.current) return
          const { x, y } = lngLatToXy(e.lnglat.getLng(), e.lnglat.getLat())
          pickRef.current(x, y)
        })
        map.on('complete', () => {
          setReady(true)
          bump()
        })
      })
      .catch((e) => !dead && setFailed(String(e?.message ?? e)))
    return () => {
      dead = true
      anim = false
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    mapRef.current?.setMapStyle(dark ? STYLE.dark : STYLE.light)
  }, [dark])

  // 视野：一个点放大到街道级，多个点适配范围
  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!ready || !map || !fit || !fit.points.length) return
    const lls = fit.points.map(([x, y]) => xyToLngLat(x, y))
    if (lls.length === 1) {
      map.setZoomAndCenter(16, [lls[0].lng, lls[0].lat])
      return
    }
    const lngs = lls.map((p) => p.lng)
    const lats = lls.map((p) => p.lat)
    const pad = Math.min(120, fit.pad ?? 60)
    map.setBounds(new AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]), false, [pad, pad, pad, pad])
  }, [ready, fit?.key])

  if (failed) {
    return <FakeMap {...props} overlay={<><div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-danger-soft px-3 py-1 text-[12px] text-danger shadow-float">高德底图加载失败，已退回示意地图：{failed}</div>{overlay}</>} />
  }

  const map = mapRef.current
  const toPx = (lng: number, lat: number): Pt => {
    const p = map.lngLatToContainer([lng, lat])
    return [p.getX ? p.getX() : p.x, p.getY ? p.getY() : p.y]
  }
  const xyPx = ([x, y]: Pt): Pt => {
    const { lng, lat } = xyToLngLat(x, y)
    return toPx(lng, lat)
  }
  const zoom = ready ? map.getZoom() : 13
  const showLabels = zoom >= 15.5
  const emph = new Set(emphasizeIds ?? [])
  const hasEmph = emph.size > 0
  const order = { faint: 0, normal: 1, strong: 2 }
  const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  const startMarkerDrag = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const AMap = AMapRef.current
    const el = wrap.current!
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const ll = map.containerToLngLat(new AMap.Pixel(ev.clientX - r.left, ev.clientY - r.top))
      const { x, y } = lngLatToXy(ll.getLng(), ll.getLat())
      pickRef.current?.(x, y)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={wrap} className={cn('overflow-hidden bg-[var(--map-land)]', !/(^|\s)(absolute|fixed)(\s|$)/.test(className ?? '') && 'relative', className)}>
      {/* 高德会给容器加 .amap-container（position: relative），所以尺寸必须写在内联样式里 */}
      <div ref={holder} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: dark ? TINT.dark : TINT.light }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-3">正在加载高德底图…</div>
      )}
      {ready && (
        <svg className={cn('pointer-events-none absolute inset-0 size-full', onPick && 'cursor-crosshair')} aria-hidden="true">
          {showLandmarks &&
            LANDMARKS.filter((l) => !landmarkIds || landmarkIds.includes(l.id)).map((l) => {
              const ll = xyToLngLat(l.x, l.y)
              const [cx, cy] = toPx(ll.lng, ll.lat)
              const dLng = (l.radius * M_PER_UNIT) / (111320 * Math.cos((ll.lat * Math.PI) / 180))
              const r = toPx(ll.lng + dLng, ll.lat)[0] - cx
              return (
                <g key={l.id}>
                  <circle cx={cx} cy={cy} r={r} fill="var(--sage)" fillOpacity={0.06} stroke="var(--sage)" strokeOpacity={0.5} strokeDasharray="2 5" strokeWidth={1.3} strokeLinecap="round" />
                  <path d={`M ${cx} ${cy - 5} C ${cx + 0.6} ${cy - 0.6}, ${cx + 0.6} ${cy - 0.6}, ${cx + 5} ${cy} C ${cx + 0.6} ${cy + 0.6}, ${cx + 0.6} ${cy + 0.6}, ${cx} ${cy + 5} C ${cx - 0.6} ${cy + 0.6}, ${cx - 0.6} ${cy + 0.6}, ${cx - 5} ${cy} C ${cx - 0.6} ${cy - 0.6}, ${cx - 0.6} ${cy - 0.6}, ${cx} ${cy - 5} Z`} fill="var(--sage)" />
                  <text x={cx + 8} y={cy + 4} fontSize={11.5} fontWeight={600} fill="var(--sage)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">{l.name}</text>
                </g>
              )
            })}

          {[...routes].sort((a, b) => order[a.tone] - order[b.tone]).map((rt) => {
            const pts = rt.points.map(xyPx)
            return (
              <g key={rt.id}>
                {rt.tone === 'strong' && <polyline points={ptsAttr(pts)} fill="none" stroke="var(--surface)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />}
                <polyline
                  points={ptsAttr(pts)}
                  fill="none"
                  stroke="var(--plate)"
                  strokeOpacity={rt.tone === 'strong' ? 1 : rt.tone === 'normal' ? 0.6 : 0.3}
                  strokeWidth={rt.tone === 'strong' ? 4.5 : rt.tone === 'normal' ? 3 : 2}
                  strokeDasharray={rt.tone === 'faint' ? '1 5' : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {rt.flow && <polyline points={ptsAttr(pts)} fill="none" stroke="var(--coral)" strokeWidth={4.5} strokeDasharray="8 52" strokeLinecap="round" strokeLinejoin="round" className="gt-flow" />}
              </g>
            )
          })}

          {stops.map((s) => {
            const [x, y] = toPx(s.lng, s.lat)
            const sel = s.id === selectedId
            const isHov = s.id === hov
            const em = emph.has(s.id)
            const faded = hasEmph && !em && !sel
            return (
              <g
                key={s.id}
                className={cn('pointer-events-auto', onSelect && 'cursor-pointer')}
                opacity={faded ? 0.45 : 1}
                onClick={() => onSelect?.(s.id)}
                onMouseEnter={() => (onHover ? onHover(s.id) : setHoverLocal(s.id))}
                onMouseLeave={() => (onHover ? onHover(null) : setHoverLocal(null))}
              >
                {sel && (
                  <>
                    <circle cx={x} cy={y} r={18} fill="var(--coral)" className="gt-ripple" />
                    <circle cx={x} cy={y} r={18} fill="var(--coral)" className="gt-ripple" style={{ animationDelay: '1.1s' }} />
                  </>
                )}
                <circle cx={x} cy={y} r={sel ? 8 : em || isHov ? 6 : 4.8} fill={sel ? 'var(--plate)' : 'var(--surface)'} stroke={sel || em ? 'var(--plate)' : 'var(--ink-2)'} strokeWidth={sel ? 3 : em ? 2.2 : 1.6} />
                {sel && <circle cx={x} cy={y} r={2.6} fill="var(--coral)" />}
                {(showLabels || sel || isHov) && (
                  <text x={x + 11} y={y - 8} fontSize={sel ? 14 : 12.5} fontWeight={sel ? 700 : 600} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} paintOrder="stroke" style={{ fontFamily: 'var(--font-display)' }}>
                    {s.name}
                    <tspan fill="var(--ink-3)" fontWeight={400}>（{s.direction}）</tspan>
                  </text>
                )}
              </g>
            )
          })}

          {marker &&
            (() => {
              const [x, y] = xyPx([marker.x, marker.y])
              return (
                <g className="pointer-events-auto cursor-move" onPointerDown={startMarkerDrag}>
                  <circle cx={x} cy={y} r={22} fill="var(--coral)" className="gt-ripple" />
                  <ellipse cx={x} cy={y + 1} rx={6.5} ry={2.4} fill="var(--ink)" fillOpacity={0.28} />
                  <path d={`M ${x} ${y} l -10.5 -16.5 a 12 12 0 1 1 21 0 z`} fill="var(--plate)" stroke="var(--surface)" strokeWidth={2} strokeLinejoin="round" />
                  <circle cx={x} cy={y - 22} r={4.2} fill="var(--coral)" />
                </g>
              )
            })()}
        </svg>
      )}

      <div className="absolute right-3 top-3 z-10 flex flex-col overflow-hidden rounded-xl bg-surface/95 shadow-float ring-1 ring-hairline backdrop-blur">
        <button aria-label="放大" className="flex size-8 items-center justify-center text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={15} />
        </button>
        <button aria-label="缩小" className="flex size-8 items-center justify-center border-t border-hairline text-ink-2 hover:bg-sunken hover:text-ink" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={15} />
        </button>
        <button
          aria-label="复位视野"
          className="flex size-8 items-center justify-center border-t border-hairline text-ink-2 hover:bg-sunken hover:text-ink"
          onClick={() => {
            const AMap = AMapRef.current
            if (!AMap || !mapRef.current) return
            const a = xyToLngLat(0, MAP_H)
            const b = xyToLngLat(MAP_W, 0)
            mapRef.current.setBounds(new AMap.Bounds([a.lng, a.lat], [b.lng, b.lat]), false, [40, 40, 40, 40])
          }}
        >
          <LocateFixed size={15} />
        </button>
      </div>
      {overlay}
    </div>
  )
}
