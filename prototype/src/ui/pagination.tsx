// PROTOTYPE — 分页：页码与每页条数写进 URL（?page=&size=），筛选变化时回到第 1 页
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from './index'

export function usePager<T>(items: T[], resetKey: string, defaultSize = 20) {
  const [sp, setSp] = useSearchParams()
  const size = Number(sp.get('size')) || defaultSize
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(pages, Math.max(1, Number(sp.get('page')) || 1))
  const write = (p: number, s: number) => {
    const n = new URLSearchParams(sp)
    p > 1 ? n.set('page', String(p)) : n.delete('page')
    s !== defaultSize ? n.set('size', String(s)) : n.delete('size')
    setSp(n, { replace: true })
  }
  // 筛选条件真的变了才回到第 1 页（比较前后值，不受严格模式重复执行副作用影响）
  const prevKey = useRef(resetKey)
  useEffect(() => {
    if (prevKey.current === resetKey) return
    prevKey.current = resetKey
    if (sp.get('page')) write(1, size)
  }, [resetKey])
  return {
    page,
    size,
    pages,
    total: items.length,
    slice: items.slice((page - 1) * size, page * size),
    setPage: (p: number) => write(Math.min(pages, Math.max(1, p)), size),
    setSize: (s: number) => write(1, s),
  }
}

/** 页码序列：首页、末页、当前页前后各一页，其余用省略号 */
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))
  const sorted = [...set].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] as number) > 1) out.push('…')
    out.push(p)
  })
  return out
}

export function Pagination({ pager, unit = '条', sizes = [20, 50, 100], compact }: { pager: ReturnType<typeof usePager>; unit?: string; sizes?: number[]; compact?: boolean }) {
  const { page, pages, size, total, setPage, setSize } = pager
  const from = total ? (page - 1) * size + 1 : 0
  const to = Math.min(total, page * size)
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] tabular-nums transition-colors'
  return (
    <nav aria-label="分页" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[12.5px] tabular-nums text-ink-3">
        {total ? (
          <>
            第 <b className="font-semibold text-ink-2">{from}–{to}</b> {unit}，共 {total} {unit}
          </>
        ) : (
          `共 0 ${unit}`
        )}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        <button aria-label="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)} className={cn(btn, 'text-ink-2 hover:bg-sunken disabled:opacity-35 disabled:hover:bg-transparent')}>
          <ChevronLeft size={15} />
        </button>
        {!compact &&
          pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-ink-4">…</span>
            ) : (
              <button
                key={p}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => setPage(p)}
                className={cn(btn, p === page ? 'bg-accent font-semibold text-accent-ink shadow-xs' : 'text-ink-2 hover:bg-sunken')}
              >
                {p}
              </button>
            ),
          )}
        {compact && (
          <span className="px-1.5 text-[13px] tabular-nums text-ink-2">
            {page} / {pages}
          </span>
        )}
        <button aria-label="下一页" disabled={page >= pages} onClick={() => setPage(page + 1)} className={cn(btn, 'text-ink-2 hover:bg-sunken disabled:opacity-35 disabled:hover:bg-transparent')}>
          <ChevronRight size={15} />
        </button>
        <label className="relative ml-1.5 flex h-8 items-center rounded-lg pl-2.5 pr-7 text-[12.5px] text-ink-2 ring-1 ring-hairline-2 hover:ring-accent/40">
          每页 {size}
          <svg viewBox="0 0 24 24" width="13" height="13" className="absolute right-2" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m7 10 5 5 5-5" />
          </svg>
          <select aria-label="每页条数" value={size} onChange={(e) => setSize(Number(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
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
