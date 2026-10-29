// 地图左上角（"收起地图"按钮下方）的线型图例；左下角留给高德 logo、版权与比例尺：实线、空心线各代表哪些走向，虚线表示还没算轨迹、按站点连线。
// 颜色区分线路，见各列表里线路牌底部的色带；图例只讲线型，用中性的墨色画示意
import type { ReactNode } from 'react'
import type { RouteKind } from '@gentransit/shared'
import { legendKinds } from './routeStyle'

/** 一小段走向线的示意，画法与地图上一致：白色描边、实线或空心线、虚线 */
export function LineSample({
  color = 'var(--ink-2)',
  hollow,
  dashed,
}: {
  color?: string
  hollow?: boolean
  dashed?: boolean
}) {
  const dash = dashed ? '5 3.5' : undefined
  const line = (stroke: string, width: number) => (
    <line
      x1={3}
      y1={5}
      x2={25}
      y2={5}
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={dash}
    />
  )
  return (
    <svg viewBox="0 0 28 10" width={28} height={10} aria-hidden="true" className="shrink-0">
      {line('var(--surface)', 8)}
      {line(color, 5.5)}
      {hollow && line('var(--surface)', 2.2)}
    </svg>
  )
}

/** dashedText：虚线一行的说明；站点详情的走向总是按站点连线（不带轨迹），不能说成"未算轨迹" */
export function RouteLegend({
  routes,
  dashedText = '虚线：未算轨迹，按站点连线',
}: {
  routes: { kind: RouteKind; road: boolean }[]
  dashedText?: string
}) {
  if (!routes.length) return null
  const { solid, hollow } = legendKinds(routes.map((r) => r.kind))
  const rows = [
    solid.length > 0 && { key: 'solid', node: <LineSample />, text: solid.join(' · ') },
    hollow.length > 0 && { key: 'hollow', node: <LineSample hollow />, text: hollow.join(' · ') },
    routes.some((r) => !r.road) && { key: 'stops', node: <LineSample dashed />, text: dashedText },
  ].filter(Boolean) as { key: string; node: ReactNode; text: string }[]
  return (
    <div
      data-testid="route-legend"
      className="pointer-events-none absolute left-3 top-14 z-10 flex flex-col gap-1 rounded-xl bg-surface/92 px-2.5 py-2 text-[11.5px] text-ink-2 shadow-float ring-1 ring-hairline backdrop-blur"
    >
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          {r.node}
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  )
}
