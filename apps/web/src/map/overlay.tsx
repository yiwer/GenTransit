// 自绘 SVG 覆盖层：站点、选中涟漪、地标辐射圈、定位标记。高德底图与示意平面共用
import type { PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import type { MapCircle, MapPoint } from './types'

type Px = [number, number]

export interface OverlayProps {
  toPx: (lng: number, lat: number) => Px
  /** 1 米对应多少像素（用于辐射圈） */
  pxPerMeter: (lng: number, lat: number) => number
  points: MapPoint[]
  circles: MapCircle[]
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

export function MapOverlay(p: OverlayProps) {
  const emph = new Set(p.emphasizeIds ?? [])
  const hasEmph = emph.size > 0
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
            <circle
              cx={x}
              cy={y}
              r={sel ? 8 : em || hov ? 6 : 4.8}
              fill={sel ? 'var(--plate)' : 'var(--surface)'}
              stroke={sel || em ? 'var(--plate)' : 'var(--ink-2)'}
              strokeWidth={sel ? 3 : em ? 2.2 : 1.6}
            />
            {sel && <circle cx={x} cy={y} r={2.6} fill="var(--coral)" />}
            {(p.showLabels || sel || hov) && (
              <text
                x={x + 11}
                y={y - 8}
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
