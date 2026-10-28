// 分页（F-COM-12）：页码与每页条数写进 URL（?page=&size=）；筛选变化时由筛选方去掉 page，回到第 1 页
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@gentransit/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { cn } from '@/lib/utils'

export function usePageParams(defaultSize = DEFAULT_PAGE_SIZE) {
  const [sp, setSp] = useSearchParams()
  const sizeRaw = Number(sp.get('size'))
  const size = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : defaultSize
  const page = Math.max(1, Math.floor(Number(sp.get('page'))) || 1)
  const write = (p: number, s: number) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (p > 1) n.set('page', String(p))
        else n.delete('page')
        if (s !== defaultSize) n.set('size', String(s))
        else n.delete('size')
        return n
      },
      { replace: true },
    )
  return { page, size, setPage: (p: number) => write(p, size), setSize: (s: number) => write(1, s) }
}

/** 页码序列：首页、末页、当前页前后各一页，其余用省略号 */
export function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}

export function Pagination({
  page,
  size,
  total,
  onPage,
  onSize,
  unit = '条',
  sizes = [...PAGE_SIZES],
  compact,
}: {
  page: number
  size: number
  total: number
  onPage: (p: number) => void
  onSize: (s: number) => void
  unit?: string
  sizes?: number[]
  compact?: boolean
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  const cur = Math.min(page, pages)
  const from = total ? (cur - 1) * size + 1 : 0
  const to = Math.min(total, cur * size)
  const go = (p: number) => onPage(Math.min(pages, Math.max(1, p)))
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] tabular-nums transition-colors'
  return (
    <nav aria-label="分页" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[12.5px] tabular-nums text-ink-3">
        {total ? (
          <>
            第{' '}
            <b className="font-semibold text-ink-2">
              {from}–{to}
            </b>{' '}
            {unit}，共 {total} {unit}
          </>
        ) : (
          `共 0 ${unit}`
        )}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          aria-label="上一页"
          disabled={cur <= 1}
          onClick={() => go(cur - 1)}
          className={cn(btn, 'text-ink-2 hover:bg-sunken disabled:opacity-35 disabled:hover:bg-transparent')}
        >
          <ChevronLeft size={15} />
        </button>
        {!compact &&
          pageList(cur, pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-ink-4">
                …
              </span>
            ) : (
              <button
                type="button"
                key={p}
                aria-current={p === cur ? 'page' : undefined}
                onClick={() => go(p)}
                className={cn(
                  btn,
                  p === cur ? 'bg-accent font-semibold text-accent-ink shadow-xs' : 'text-ink-2 hover:bg-sunken',
                )}
              >
                {p}
              </button>
            ),
          )}
        {compact && (
          <span className="px-1.5 text-[13px] tabular-nums text-ink-2">
            {cur} / {pages}
          </span>
        )}
        <button
          type="button"
          aria-label="下一页"
          disabled={cur >= pages}
          onClick={() => go(cur + 1)}
          className={cn(btn, 'text-ink-2 hover:bg-sunken disabled:opacity-35 disabled:hover:bg-transparent')}
        >
          <ChevronRight size={15} />
        </button>
        <label className="relative ml-1.5 flex h-8 items-center rounded-lg pl-2.5 pr-7 text-[12.5px] text-ink-2 ring-1 ring-hairline-2 hover:ring-accent/40">
          每页 {size}
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            className="absolute right-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m7 10 5 5 5-5" />
          </svg>
          <select
            aria-label="每页条数"
            value={size}
            onChange={(e) => onSize(Number(e.target.value))}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                每页 {s} {unit}
              </option>
            ))}
          </select>
        </label>
      </div>
    </nav>
  )
}
