// PROTOTYPE — 线路列表：与站点列表同一套分栏；悬停时在地图上点亮走向
import { ArrowRight, ArrowUpRight, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDebug, useStore } from '../../data/store'
import { compareLineName } from '../../lib/domain'
import { MapView, routePoints } from '../../map/MapView'
import { SplitView } from '../../shell/SplitView'
import { Button, Input, RoutePlate, Tag, cn, useToast } from '../../ui'
import { EmptySearchArt } from '../../ui/lively'
import { Pagination, usePager } from '../../ui/pagination'
import { originOf, terminalOf } from '../shared'

export function LineListPage() {
  const { lines, stops } = useStore()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const status = sp.get('status') ?? ''
  const mode = sp.get('mode') ?? ''
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp)
    v ? p.set(k, v) : p.delete(k)
    setSp(p, { replace: true })
  }
  const nav = useNavigate()
  const toast = useToast()
  const [hover, setHover] = useState<string | null>(null)
  const list = useMemo(
    () =>
      lines
        .filter((l) => (!q || (l.name + l.number + l.company).toLowerCase().includes(q.toLowerCase())) && (!status || l.status === status) && (!mode || l.mode === mode))
        .sort((a, b) => compareLineName(a.name, b.name)),
    [lines, q, status, mode],
  )
  const pager = usePager(list, `${q}|${status}|${mode}`, 20)
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 页面: '线路列表', 筛选: { q, status, mode }, 结果数: list.length }), [q, status, mode, list.length])

  const hovered = lines.find((l) => l.id === hover)
  const routes = pager.slice.flatMap((l) =>
    l.routes.map((r, i) => ({
      id: r.id,
      points: routePoints(r.stopIds, stops),
      tone: (hover ? (l.id === hover ? (i === 0 ? 'strong' : 'normal') : 'faint') : 'faint') as 'strong' | 'normal' | 'faint',
      flow: l.id === hover && i === 0,
    })),
  )
  const chip = (on: boolean) => cn('inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors', on ? 'bg-accent text-accent-ink ring-accent' : 'bg-surface text-ink-2 ring-hairline-2 hover:text-ink')

  return (
    <SplitView
      storageKey="lines"
      defaultWidth={460}
      map={
        <MapView
          className="absolute inset-0"
          stops={stops.filter((s) => !s.deleted)}
          emphasizeIds={hovered ? hovered.routes.flatMap((r) => r.stopIds) : undefined}
          routes={routes}
        />
      }
      left={({ width }) => {
        const wide = width >= 760
        return (
          <div className="flex h-full flex-col">
            <div className="px-6 pb-3 pt-6">
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="font-display text-[26px] font-semibold leading-9">线路</h1>
                  <p className="text-[13px] text-ink-3">
                    {lines.length} 条线路 · {lines.filter((l) => l.status === '停运').length} 条停运
                  </p>
                </div>
                <Button variant="primary" onClick={() => toast('原型：线路表单不在 M0 范围', 'info')}>
                  <Plus size={15} /> 新建
                </Button>
              </div>
              <div className="relative mt-4">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input aria-label="搜索线路" placeholder="线路名、管理编号、公司" value={q} onChange={(e) => set('q', e.target.value)} className="h-10 rounded-xl pl-9 text-[14px]" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {['运营', '停运'].map((s) => (
                  <button key={s} aria-pressed={status === s} className={chip(status === s)} onClick={() => set('status', status === s ? '' : s)}>{s}</button>
                ))}
                <span className="mx-0.5 h-4 w-px bg-hairline-2" />
                {['双边', '单向', '单环'].map((m) => (
                  <button key={m} aria-pressed={mode === m} className={chip(mode === m)} onClick={() => set('mode', mode === m ? '' : m)}>{m}</button>
                ))}
                {(q || status || mode) && (
                  <button onClick={() => setSp(new URLSearchParams(), { replace: true })} className="inline-flex h-7 items-center gap-1 px-2 text-[12.5px] text-ink-3 hover:text-ink">
                    <X size={13} /> 清空
                  </button>
                )}
              </div>
            </div>
            {wide && (
              <div className="grid grid-cols-[110px_minmax(240px,2fr)_minmax(140px,1fr)_90px_90px] gap-4 border-y border-hairline bg-surface-2 px-6 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3">
                <span>线路</span>
                <span>首末站</span>
                <span>公司</span>
                <span>票价</span>
                <span>状态</span>
              </div>
            )}
            <ul className={cn('min-h-0 flex-1 overflow-auto', !wide && 'border-t border-hairline')} onMouseLeave={() => setHover(null)}>
              {pager.slice.map((l) => {
                const r0 = l.routes[0]
                const from = originOf(r0, stops)?.name
                const to = terminalOf(r0, stops)?.name
                const ring = l.mode === '单环'
                return (
                  <li key={l.id}>
                    <button
                      onMouseEnter={() => setHover(l.id)}
                      onFocus={() => setHover(l.id)}
                      onClick={() => nav(`/lines/${l.id}`)}
                      className={cn('group w-full border-b border-hairline px-6 py-3 text-left transition-colors hover:bg-surface-2', wide ? 'grid grid-cols-[110px_minmax(240px,2fr)_minmax(140px,1fr)_90px_90px] items-center gap-4' : 'flex items-center gap-3.5')}
                    >
                      <span className={cn(!wide && 'w-[64px] shrink-0')}>
                        <RoutePlate name={l.name} state={l.status === '停运' ? 'suspended' : 'normal'} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate font-display text-[15px] font-semibold">
                          {from}
                          <ArrowRight size={13} className="shrink-0 text-ink-4" />
                          {ring ? '环线' : to}
                        </span>
                        {!wide && (
                          <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                            {l.mode} · {l.company} · {r0.stopIds.length} 站
                          </span>
                        )}
                      </span>
                      {wide ? (
                        <>
                          <span className="truncate text-[13px] text-ink-2">{l.company}</span>
                          <span className="text-[13px] text-ink-2">{l.fare}</span>
                          <span>{l.status === '停运' ? <Tag>停运</Tag> : <span className="text-[13px] text-sage">运营</span>}</span>
                        </>
                      ) : (
                        <>
                          {l.status === '停运' && <Tag>停运</Tag>}
                          <ArrowUpRight size={15} className="shrink-0 text-ink-4 opacity-0 transition group-hover:opacity-100" />
                        </>
                      )}
                    </button>
                  </li>
                )
              })}
              {list.length === 0 && (
                <li className="flex flex-col items-center py-14 text-center">
                  <EmptySearchArt />
                  <p className="mt-2 font-display text-[16px] font-semibold">没有找到符合条件的线路</p>
                </li>
              )}
            </ul>
            <div className="shrink-0 border-t border-hairline bg-surface-2 px-6 py-2.5">
              <Pagination pager={pager} unit="条" sizes={[10, 20, 50]} compact={width < 440} />
            </div>
          </div>
        )
      }}
    />
  )
}
