// 站序编辑的工具：按站名联想添加站点；粘贴"站名 + 方位"两列文本批量匹配
import type { Page, StopListItem, StopMatchResult } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { DirBadge } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { get, isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { StopRef } from './draft'

/** 搜索站点并添加：回车加入高亮项 */
export function StopSearch({ onAdd, placeholder }: { onAdd: (s: StopRef) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  const res = useQuery({
    queryKey: ['stops', 'search', term],
    queryFn: () => get<Page<StopListItem>>('/api/stops', { q: term, size: 8 }),
    enabled: term.length > 0,
  })
  const items = term ? (res.data?.items ?? []) : []
  const add = (s: StopListItem) => {
    onAdd({ id: s.id, name: s.name, direction: s.direction, lng: s.lng, lat: s.lat })
    setQ('')
    setTerm('')
    setIdx(0)
  }
  return (
    <div className="relative min-w-0 flex-1">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      <input
        aria-label="添加站点"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setIdx(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setIdx((i) => Math.min(items.length - 1, i + 1))
          if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1))
          if (e.key === 'Enter' && items[idx]) {
            e.preventDefault()
            add(items[idx])
          }
          if (e.key === 'Escape') setQ('')
        }}
        className="h-8 w-full rounded-lg bg-sunken pl-8 pr-2.5 text-[13.5px] text-ink placeholder:text-ink-4 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {term && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-[260px] overflow-auto rounded-xl bg-surface p-1 shadow-pop ring-1 ring-hairline"
        >
          {items.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === idx}>
              <button
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => add(s)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]',
                  i === idx && 'bg-sunken',
                )}
              >
                <span className="font-display font-semibold">{s.name}</span>
                <DirBadge dir={s.direction} size="sm" />
                <span className="ml-auto truncate text-[12px] text-ink-3">
                  {[s.road?.name, s.street?.name].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
          {res.isSuccess && items.length === 0 && (
            <li className="px-2 py-3 text-center text-[12.5px] text-ink-3">没有找到「{term}」</li>
          )}
          {res.isPending && (
            <li className="flex items-center justify-center gap-2 px-2 py-3 text-[12.5px] text-ink-3">
              <OrbitLoader size={16} /> 搜索中…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** 解析粘贴的两列文本：制表符分隔；没有制表符时最后一段空白之后是方位 */
export function parsePairs(text: string): { name: string; direction: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.includes('\t')) {
        const [name, direction = ''] = l.split('\t').map((x) => x.trim())
        return { name, direction }
      }
      const m = /^(.*\S)\s+(\S+)$/.exec(l)
      return m ? { name: m[1], direction: m[2] } : { name: l, direction: '' }
    })
}

/** 粘贴两列文本：匹配到的预览后追加，匹配不到的逐条标红，不追加 */
export function PasteDialog({
  open,
  onOpenChange,
  onAppend,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onAppend: (stops: StopRef[]) => void
}) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<StopMatchResult[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => {
    onOpenChange(false)
    setText('')
    setResults(null)
    setError('')
  }
  const match = async () => {
    setBusy(true)
    setError('')
    try {
      setResults(await post<StopMatchResult[]>('/api/stops/match', { rows: parsePairs(text) }))
    } catch (e) {
      setError(isApiError(e) ? e.message : '匹配失败')
    } finally {
      setBusy(false)
    }
  }
  const matched = (results ?? []).filter((r) => r.stop)
  const unmatched = (results ?? []).filter((r) => !r.stop)
  const append = () => {
    onAppend(matched.map((r) => r.stop!))
    close()
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      title="粘贴站序"
      description="每行一个站：站名与方位之间用制表符（从 Excel 复制两列即可）或空格分隔"
      width={560}
      footer={
        results ? (
          <>
            <Button onClick={() => setResults(null)}>重新粘贴</Button>
            <Button variant="primary" disabled={!matched.length} onClick={append}>
              追加 {matched.length} 个站
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>取消</Button>
            <Button variant="primary" disabled={!text.trim() || busy} onClick={() => void match()}>
              匹配站点
            </Button>
          </>
        )
      }
    >
      {results ? (
        <>
          <p className="mb-2">
            匹配到 <b className="text-ink">{matched.length}</b> 个
            {unmatched.length > 0 && (
              <>
                ，<b className="text-danger">{unmatched.length}</b> 个没有匹配上（不会追加）
              </>
            )}
            。
          </p>
          <ol className="max-h-[320px] overflow-auto rounded-xl ring-1 ring-hairline" aria-label="匹配结果">
            {results.map((r) => (
              <li
                key={r.index}
                className={cn(
                  'flex items-center gap-2 border-b border-hairline px-3 py-1.5 text-[13px] last:border-0',
                  !r.stop && 'bg-danger-soft/60 text-danger',
                )}
              >
                <span className="w-6 text-right text-[12px] tabular-nums text-ink-3">{r.index + 1}</span>
                {r.stop ? <Check size={14} className="text-sage" /> : <X size={14} />}
                <span className="font-display font-semibold">{r.name}</span>
                {r.direction ? <DirBadge dir={r.direction} size="sm" /> : <span className="text-[12px]">缺少方位</span>}
                {!r.stop && <span className="ml-auto text-[12px]">没有这个站点</span>}
              </li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <Textarea
            aria-label="站名与方位"
            autoFocus
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'人民广场\t东\n解放路口\t南\n火车站\t场站'}
            className="font-mono text-[13px]"
          />
          {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
        </>
      )}
    </Dialog>
  )
}
