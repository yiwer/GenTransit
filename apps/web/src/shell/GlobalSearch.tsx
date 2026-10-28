// 左侧栏全局搜索（Ctrl K）：M1 先只搜站点
import type { Page, StopListItem } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { DirBadge } from '@/components/gt/symbols'
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

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const nav = useNavigate()
  const term = q.trim()
  const res = useQuery({
    queryKey: ['stops', 'search', term],
    queryFn: () => get<Page<StopListItem>>('/api/stops', { q: term, size: 8 }),
    enabled: open && term.length > 0,
  })
  const items = term ? (res.data?.items ?? []) : []
  const go = (id: string) => {
    onOpenChange(false)
    setQ('')
    nav(`/stops/${id}`)
  }
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="gt-fade fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]" />
        <D.Content className="gt-rise fixed left-1/2 top-[18vh] z-50 w-[520px] -translate-x-1/2 overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline focus:outline-none">
          <D.Title className="sr-only">搜索站点</D.Title>
          <D.Description className="sr-only">输入站名或英文名，回车打开站点详情</D.Description>
          <div className="flex items-center gap-2 border-b border-hairline px-4">
            <Search size={16} className="text-ink-3" />
            <input
              autoFocus
              aria-label="搜索站点"
              value={q}
              placeholder="搜索站名、英文名"
              onChange={(e) => {
                setQ(e.target.value)
                setIdx(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setIdx((i) => Math.min(items.length - 1, i + 1))
                if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1))
                if (e.key === 'Enter' && items[idx]) go(items[idx].id)
              }}
              className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-4 focus:outline-none"
            />
          </div>
          <ul className="max-h-[360px] overflow-auto p-1.5">
            {items.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left',
                    i === idx ? 'bg-sunken' : 'hover:bg-sunken/60',
                  )}
                >
                  <span className="font-display text-[15px] font-semibold">{s.name}</span>
                  <DirBadge dir={s.direction} size="sm" />
                  <span className="ml-auto truncate text-[12px] text-ink-3">
                    {[s.road?.name, s.street?.name].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
            {term && res.isSuccess && items.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-ink-3">没有找到「{term}」</li>
            )}
            {!term && <li className="px-3 py-6 text-center text-[13px] text-ink-3">输入站名开始搜索，回车打开详情</li>}
          </ul>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
