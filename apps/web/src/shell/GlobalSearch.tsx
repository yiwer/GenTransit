// 左侧栏全局搜索（Ctrl K）：站点与线路
import type { LineListItem, Page, StopListItem } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { DirBadge, RoutePlate } from '@/components/gt/symbols'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'

export function useSearchHotkey(open: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])
}

type Hit = { kind: 'line'; item: LineListItem } | { kind: 'stop'; item: StopListItem }

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const nav = useNavigate()
  const term = q.trim()
  const stops = useQuery({
    queryKey: ['stops', 'search', term],
    queryFn: () => get<Page<StopListItem>>('/api/stops', { q: term, size: 8 }),
    enabled: open && term.length > 0,
  })
  const lines = useQuery({
    queryKey: ['lines', 'search', term],
    queryFn: () => get<Page<LineListItem>>('/api/lines', { q: term, size: 5 }),
    enabled: open && term.length > 0,
  })
  const hits: Hit[] = term
    ? [
        ...(lines.data?.items ?? []).map((item) => ({ kind: 'line' as const, item })),
        ...(stops.data?.items ?? []).map((item) => ({ kind: 'stop' as const, item })),
      ]
    : []
  const go = (h: Hit) => {
    onOpenChange(false)
    setQ('')
    nav(h.kind === 'line' ? `/lines/${h.item.id}` : `/stops/${h.item.id}`)
  }
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="gt-fade fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]" />
        <D.Content className="gt-rise fixed left-1/2 top-[18vh] z-50 w-[540px] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline focus:outline-none">
          <D.Title className="sr-only">搜索站点与线路</D.Title>
          <D.Description className="sr-only">输入站名或线路名，回车打开详情</D.Description>
          <div className="flex items-center gap-2 border-b border-hairline px-4">
            <Search size={16} className="text-ink-3" />
            <input
              autoFocus
              aria-label="搜索站点与线路"
              value={q}
              placeholder="搜索站名、线路名、管理编号"
              onChange={(e) => {
                setQ(e.target.value)
                setIdx(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setIdx((i) => Math.min(hits.length - 1, i + 1))
                if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1))
                if (e.key === 'Enter' && hits[idx]) go(hits[idx])
              }}
              className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none"
            />
          </div>
          <ul className="max-h-[380px] overflow-auto p-1.5">
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.item.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(h)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left',
                    i === idx ? 'bg-sunken' : 'hover:bg-sunken/60',
                  )}
                >
                  {h.kind === 'line' ? (
                    <>
                      <RoutePlate
                        name={h.item.name}
                        size="sm"
                        state={h.item.status === 'suspended' ? 'suspended' : 'normal'}
                      />
                      <span className="truncate font-display text-[14px] font-semibold">
                        {h.item.routes[0] ? `${h.item.routes[0].origin} — ${h.item.routes[0].terminal}` : ''}
                      </span>
                      <span className="ml-auto font-mono text-[12px] text-ink-3">{h.item.number}</span>
                    </>
                  ) : (
                    <>
                      <span className="font-display text-[15px] font-semibold">{h.item.name}</span>
                      <DirBadge dir={h.item.direction} size="sm" />
                      <span className="ml-auto truncate text-[12px] text-ink-3">
                        {[h.item.road?.name, h.item.street?.name].filter(Boolean).join(' · ')}
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
            {term && stops.isSuccess && lines.isSuccess && hits.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-ink-3">没有找到「{term}」</li>
            )}
            {!term && (
              <li className="px-3 py-6 text-center text-[13px] text-ink-3">输入站名或线路名开始搜索，回车打开详情</li>
            )}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
