// 线路详情里当前走向的"轨迹"一行：状态（未计算、已计算、站序已变需重新计算）与"计算轨迹"按钮。
// 轨迹按站序调用高德驾车路线规划，由服务端用 AMAP_API_KEY 计算；只在这里手动触发，一次算这条线路的全部走向
import type { LineDetail, LineTrackResult, RouteDetail } from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { useAppConfig } from '@/features/auth/auth'
import { isApiError, post } from '@/lib/api'
import { cn, fmtDateTime } from '@/lib/utils'
import { kindText, lineKey } from './shared'

type State = 'none' | 'fresh' | 'stale'

/** 手绘的小路线：已计算时是鼠尾草色实线，过期时赭石色，没算过是虚线 */
function TrackGlyph({ state }: { state: State }) {
  const color = state === 'fresh' ? 'var(--sage)' : state === 'stale' ? 'var(--signal)' : 'var(--ink-4)'
  return (
    <svg viewBox="0 0 36 24" width={36} height={24} aria-hidden="true" className="shrink-0">
      <path
        d="M4 18 C 10 18, 10 6, 18 6 S 26 18, 32 18"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray={state === 'none' ? '1.5 4' : undefined}
      />
      <circle cx="4" cy="18" r="3" fill="var(--plate)" stroke="var(--surface)" strokeWidth={1.5} />
      <circle cx="18" cy="6" r="2.4" fill="var(--surface)" stroke="var(--plate)" strokeWidth={1.5} />
      <circle cx="32" cy="18" r="3" fill="var(--plate)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  )
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} 公里` : `${m} 米`)

export function RouteTrackStrip({ line, route }: { line: LineDetail; route: RouteDetail }) {
  const config = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const t = route.track
  const state: State = !t ? 'none' : t.stale ? 'stale' : 'fresh'
  const enabled = Boolean(config.data?.routeTrack)

  const run = async () => {
    setBusy(true)
    try {
      const r = await post<LineTrackResult & { item: LineDetail }>(`/api/lines/${line.id}/track`)
      qc.setQueryData(lineKey(line.id), r.item)
      await qc.invalidateQueries({ queryKey: ['lines', 'list'] })
      const kindOf = (id: string) => line.routes.find((x) => x.id === id)?.kind
      const failed = r.results.filter((x) => !x.ok)
      if (!failed.length) toast(`已计算 ${r.results.length} 个走向的轨迹`)
      else
        toast(
          failed.map((x) => `${kindOf(x.routeId) ? kindText(kindOf(x.routeId)!) : '走向'}：${x.message}`).join('；'),
          'error',
        )
    } catch (e) {
      toast(isApiError(e) ? e.message : '计算轨迹失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="route-track"
      data-state={state}
      className={cn(
        'mb-4 flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1',
        state === 'stale' ? 'bg-signal-soft/60 ring-signal/30' : 'bg-surface-2 ring-hairline',
      )}
    >
      <TrackGlyph state={state} />
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-ink-3">轨迹</div>
        <div className="truncate text-[13.5px]">
          {state === 'none' && <span className="text-ink-2">还没有计算，地图按站点连线</span>}
          {state === 'fresh' && t && (
            <span>
              <b className="font-semibold">{km(t.distance)}</b>
              <span className="text-ink-3"> · {fmtDateTime(t.computedAt)} 计算</span>
            </span>
          )}
          {state === 'stale' && <span className="text-signal-ink">站序或站点位置变了，轨迹已过期，地图按站点连线</span>}
        </div>
      </div>
      <Button
        size="sm"
        variant={state === 'fresh' ? 'secondary' : 'primary'}
        disabled={!enabled || busy}
        onClick={() => void run()}
        title={
          enabled
            ? '按站序调用高德驾车路线规划，计算这条线路全部走向的轨迹'
            : '服务端没有配置高德 Web 服务 Key（AMAP_API_KEY），不能计算轨迹'
        }
      >
        {busy ? <OrbitLoader size={14} /> : <RefreshCw size={13} />}
        {busy ? '正在计算…' : state === 'none' ? '计算轨迹' : '重新计算'}
      </Button>
    </div>
  )
}
