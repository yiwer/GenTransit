// 从其他站点复制站牌集（需求 5.5.3，BR-21，M5 计划 4.4）：搜索框为空时先列对向站、再列同名站；
// 选中后预览对方立面，并用与执行时相同的函数先算一遍"追加几个站架、带过几条编排"
import {
  DraftError,
  copySignSet,
  fmtDistance,
  type CopyResult,
  type OppositeMap,
  type Page,
  type PoolItem,
  type SignSetDraft,
  type SignSetView,
  type StopListItem,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { Copy, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { DirBadge } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { get, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { signSetKey } from './data'
import { SignSetGlance } from './SignSetPreview'

type Cand = { id: string; name: string; direction: string; distance?: number; tag?: string }

export function CopyFromDialog({
  open,
  onOpenChange,
  stop,
  draft,
  pool,
  initialId,
  onApply,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  stop: SignSetView['stop']
  draft: SignSetDraft
  pool: PoolItem[]
  /** 打开时直接选中的站点（新建对向站点后"照着原站复制"） */
  initialId?: string
  onApply: (r: CopyResult, from: string) => void
}) {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<string | null>(initialId ?? null)
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (open) setPicked(initialId ?? null)
  }, [open, initialId])
  const near = stop.lng != null && stop.lat != null ? `${stop.lng},${stop.lat}` : undefined

  // 建议：对向站，再加同名的其他站
  const suggest = useQuery({
    queryKey: ['stops', 'copy-suggest', stop.id],
    enabled: open,
    queryFn: async (): Promise<Cand[]> => {
      const [opp, same] = await Promise.all([
        post<OppositeMap>('/api/stops/opposites', { ids: [stop.id] }),
        get<Page<StopListItem>>('/api/stops', { q: stop.name, near, size: 10 }),
      ])
      const o = opp[stop.id]
      const list: Cand[] = o ? [{ ...o, tag: '对向站' }] : []
      for (const s of same.items)
        if (s.name === stop.name && s.id !== stop.id && s.id !== o?.id)
          list.push({ id: s.id, name: s.name, direction: s.direction, distance: s.distance, tag: '同名站' })
      return list
    },
  })
  const search = useQuery({
    queryKey: ['stops', 'copy-search', term, near],
    enabled: open && term.length > 0,
    queryFn: async () =>
      (await get<Page<StopListItem>>('/api/stops', { q: term, near, size: 8 })).items
        .filter((s) => s.id !== stop.id)
        .map((s): Cand => ({ id: s.id, name: s.name, direction: s.direction, distance: s.distance })),
  })
  const cands = term ? (search.data ?? []) : (suggest.data ?? [])
  const source = useQuery({
    queryKey: signSetKey(picked ?? ''),
    enabled: Boolean(open && picked),
    queryFn: () => get<SignSetView>(`/api/stops/${picked}/sign-set`),
  })

  let result: CopyResult | null = null
  let error = ''
  if (source.data) {
    try {
      result = copySignSet(draft, source.data, { sourceRoutes: source.data.routes, targetPool: pool })
    } catch (e) {
      if (e instanceof DraftError) error = e.message
      else throw e
    }
  }
  const empty = source.data && source.data.shelves.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={720}
      title="从其他站点复制站牌集"
      description="把对方的站架、站牌、插片结构追加到本站；线路在本站只有一次途经且还没排时，编排一并带过来"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={!result || Boolean(empty)}
            onClick={() => result && source.data && onApply(result, source.data.stop.name)}
          >
            <Copy size={14} /> 复制过来
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-4">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              aria-label="搜索站点"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="按站名搜索"
              className="h-8 w-full rounded-lg bg-sunken pl-8 pr-2.5 text-[13px] placeholder:text-ink-4 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          {!term && <div className="px-1 text-[11.5px] text-ink-3">建议</div>}
          <ul className="max-h-[300px] overflow-auto" role="listbox" aria-label="可复制的站点">
            {cands.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={picked === c.id}
                  onClick={() => setPicked(c.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
                    picked === c.id ? 'bg-accent-soft' : 'hover:bg-sunken',
                  )}
                >
                  {c.tag === '对向站' ? <OppositeMark /> : null}
                  <span className="truncate font-display font-semibold">{c.name}</span>
                  <DirBadge dir={c.direction} size="sm" />
                  <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">
                    {c.tag ?? (c.distance !== undefined ? fmtDistance(c.distance) : '')}
                  </span>
                </button>
              </li>
            ))}
            {(term ? search.isSuccess : suggest.isSuccess) && cands.length === 0 && (
              <li className="px-2 py-3 text-[12.5px] text-ink-3">
                {term ? `没有找到「${term}」` : '没有对向站或同名站，用上面的搜索框找'}
              </li>
            )}
          </ul>
        </div>
        <div className="min-h-[260px] rounded-xl bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] ring-1 ring-hairline">
          {!picked ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-ink-3">
              选一个站点预览它的站牌集
            </div>
          ) : !source.data ? (
            <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-ink-3">
              <OrbitLoader size={18} /> 正在读取…
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="max-h-[260px] overflow-auto">
                <SignSetGlance view={source.data} zoom="compact" />
              </div>
              <p className="mt-auto border-t border-hairline px-3 py-2 text-[12.5px]" data-testid="copy-estimate">
                {empty ? (
                  <span className="text-ink-3">这个站点还没有站架，没有可复制的内容</span>
                ) : error ? (
                  <span className="text-danger">{error}</span>
                ) : (
                  result && (
                    <>
                      将追加 <b>{result.shelves}</b> 个站架、<b>{result.boards}</b> 块站牌；带过 <b>{result.mapped}</b>{' '}
                      条编排
                      {result.skipped > 0 && (
                        <span className="text-ink-3">，{result.skipped} 条对不上本站的途经，不带</span>
                      )}
                    </>
                  )
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/** 一对相对的方位小章：表示对向站 */
function OppositeMark() {
  return (
    <svg viewBox="0 0 20 14" width={20} height={14} aria-label="对向站" className="shrink-0">
      <circle cx="5" cy="7" r="3.6" fill="none" stroke="var(--accent)" strokeWidth="1.4" />
      <circle cx="15" cy="7" r="3.6" fill="var(--accent)" />
      <path
        d="M8.6 4.6 Q10 2.8 11.4 4.6 M11.4 9.4 Q10 11.2 8.6 9.4"
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}
