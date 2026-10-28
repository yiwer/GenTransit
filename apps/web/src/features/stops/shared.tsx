import {
  ROUTE_KIND_LABEL,
  type Page,
  type Ref,
  type StopDetail,
  type StopListItem,
  type StopListQuery,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { RoutePlate } from '@/components/gt/symbols'
import { get } from '@/lib/api'

export const stopKey = (id: string) => ['stops', 'detail', id] as const

export const useStopList = (params: Partial<StopListQuery>) =>
  useQuery({
    queryKey: ['stops', 'list', params],
    queryFn: () => get<Page<StopListItem>>('/api/stops', params),
    placeholderData: (prev) => prev,
  })

export const useStop = (id: string | undefined) =>
  useQuery({ queryKey: stopKey(id ?? ''), queryFn: () => get<StopDetail>(`/api/stops/${id}`), enabled: Boolean(id) })

/** 市 · 区 · 街道 */
export const regionText = (s: { city: Ref | null; district: Ref | null; street: Ref | null }) =>
  [s.city?.name, s.district?.name, s.street?.name].filter(Boolean).join(' · ')

export const KIND_MARK: Record<string, string> = { up: '↑', down: '↓', inner: '⟳', outer: '⟲', loop: '⟳', oneway: '→' }
export const kindLabel = (k: keyof typeof ROUTE_KIND_LABEL) => `${KIND_MARK[k] ?? ''} ${ROUTE_KIND_LABEL[k]}`

/** 经过线路的线路牌 */
export function Plates({ lines, max = 6 }: { lines: { name: string; suspended: boolean }[]; max?: number }) {
  if (!lines.length) return <span className="text-[12.5px] text-ink-4">没有线路经过</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      {lines.slice(0, max).map((l) => (
        <RoutePlate key={l.name} name={l.name} size="xs" state={l.suspended ? 'suspended' : 'normal'} />
      ))}
      {lines.length > max && <span className="text-[12px] text-ink-3">+{lines.length - max}</span>}
    </span>
  )
}
