import {
  LINE_MODE_LABEL,
  LINE_STATUS_LABEL,
  ROUTE_KIND_LABEL,
  type LineDetail,
  type LineListItem,
  type LineStatus,
  type Page,
  type RouteKind,
  type TransferStop,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'

export const lineKey = (id: string) => ['lines', 'detail', id] as const

export const useLineList = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: ['lines', 'list', params],
    queryFn: () => get<Page<LineListItem>>('/api/lines', params),
    placeholderData: (prev) => prev,
  })

export const useLine = (id: string | undefined) =>
  useQuery({ queryKey: lineKey(id ?? ''), queryFn: () => get<LineDetail>(`/api/lines/${id}`), enabled: Boolean(id) })

export const useTransfers = (lineId: string, routeId: string | undefined) =>
  useQuery({
    queryKey: ['lines', 'transfers', lineId, routeId],
    queryFn: () => get<TransferStop[]>(`/api/lines/${lineId}/transfers`, { routeId }),
    enabled: Boolean(routeId),
  })

export const KIND_MARK: Record<RouteKind, string> = {
  up: '↑',
  down: '↓',
  inner: '⟳',
  outer: '⟲',
  loop: '⟳',
  oneway: '→',
}
export const kindText = (k: RouteKind) => `${KIND_MARK[k]} ${ROUTE_KIND_LABEL[k]}`

/** 起点 — 终点；单环线显示"环线" */
export function endpointsText(l: { mode: string; routes: { origin?: string; terminal?: string }[] }) {
  const r = l.routes[0]
  if (!r) return '还没有站序'
  if (l.mode === 'loop') return `环线 · ${r.origin}`
  return `${r.origin} — ${r.terminal}`
}

export function StatusPill({ status }: { status: LineStatus }) {
  const suspended = status === 'suspended'
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium',
        suspended ? 'text-ink-3 ring-1 ring-ink-4' : 'bg-sage-soft text-sage',
      )}
    >
      <span className={cn('size-1.5 rounded-full', suspended ? 'bg-ink-4' : 'bg-sage')} />
      {LINE_STATUS_LABEL[status]}
    </span>
  )
}

export const modeText = (m: keyof typeof LINE_MODE_LABEL) => LINE_MODE_LABEL[m]
