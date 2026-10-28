// PROTOTYPE — 站点列表（定稿：地图优先分屏）。左栏可拖宽、有最小宽度；地图可收起，收起或拉宽后列表切换为宽表
import { ArrowUpRight, ChevronDown, Download, MoreHorizontal, Plus, Search, Signpost, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useDebug, useStore } from '../data/store'
import type { Stop } from '../data/types'
import { compareLineName, passagesAt, poolOf } from '../lib/domain'
import { MapView, routePoints } from '../map/MapView'
import { SplitView } from '../shell/SplitView'
import { Button, DirBadge, IconButton, Input, MenuItem, MenuLabel, Popover, RoutePlate, Select, StatusChip, cn, useToast } from '../ui'
import { BreathingDot, EmptySearchArt } from '../ui/lively'
import { Pagination, usePager } from '../ui/pagination'

interface Row {
  stop: Stop
  lines: { name: string; suspended: boolean }[]
  shelves: number
  boards: number
  wait: number
  bad: number
}

function useRows() {
  const { stops, lines, getSignSet } = useStore()
  return useMemo<Row[]>(
    () =>
      stops.map((stop) => {
        const names = new Map<string, boolean>()
        for (const l of lines) if (l.routes.some((r) => r.stopIds.includes(stop.id))) names.set(l.name, l.status === '停运')
        const ss = getSignSet(stop.id)
        const pool = poolOf(ss, passagesAt(stop.id, lines, stops))
        return {
          stop,
          lines: [...names].map(([name, suspended]) => ({ name, suspended })).sort((a, b) => compareLineName(a.name, b.name)),
          shelves: ss.shelves.length,
          boards: ss.shelves.reduce((n, s) => n + s.boards.length, 0),
          wait: pool.filter((p) => p.status === '待编排').length,
          bad: pool.filter((p) => p.status === '失效').length,
        }
      }),
    [stops, lines, getSignSet],
  )
}

function useFilters() {
  const [sp, setSp] = useSearchParams()
  const f = {
    q: sp.get('q') ?? '',
    dir: sp.get('dir') ?? '',
    street: sp.get('street') ?? '',
    road: sp.get('road') ?? '',
    line: sp.get('line') ?? '',
    maint: sp.get('maint') ?? '',
    todo: sp.get('todo') === '1',
    tab: (sp.get('tab') ?? 'active') as 'active' | 'deleted',
  }
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(sp)
    v ? p.set(k, v) : p.delete(k)
    setSp(p, { replace: true })
  }
  const clear = () => {
    const p = new URLSearchParams()
    if (sp.get('tab')) p.set('tab', sp.get('tab')!)
    setSp(p, { replace: true })
  }
  const active = ['q', 'dir', 'street', 'road', 'line', 'maint', 'todo'].filter((k) => sp.get(k)).length
  return { f, set, clear, active }
}

function applyFilters(rows: Row[], f: ReturnType<typeof useFilters>['f']) {
  return rows
    .filter(({ stop, lines, wait, bad }) => {
      if (f.tab === 'deleted' ? !stop.deleted : stop.deleted) return false
      if (f.q && !(stop.name + stop.nameEn + stop.road).toLowerCase().includes(f.q.toLowerCase())) return false
      if (f.dir && stop.direction !== f.dir) return false
      if (f.street && stop.street !== f.street) return false
      if (f.road && stop.road !== f.road) return false
      if (f.maint && stop.maintainer !== f.maint) return false
      if (f.line && !lines.some((l) => l.name === f.line)) return false
      if (f.todo && !(wait || bad)) return false
      return true
    })
    .sort((a, b) => a.stop.name.localeCompare(b.stop.name, 'zh-Hans-CN-u-co-pinyin') || a.stop.direction.localeCompare(b.stop.direction))
}

function Plates({ lines, max = 6 }: { lines: Row['lines']; max?: number }) {
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

function Todo({ r }: { r: Row }) {
  if (!r.wait && !r.bad) return null
  return (
    <span className="flex items-center gap-2 text-[12px] tabular-nums">
      {r.wait > 0 && (
        <span className="inline-flex items-center gap-1 text-signal-ink" title={`待编排 ${r.wait}`}>
          <BreathingDot /> {r.wait}
        </span>
      )}
      {r.bad > 0 && (
        <span className="inline-flex items-center gap-1 text-danger" title={`失效 ${r.bad}`}>
          <BreathingDot tone="danger" /> {r.bad}
        </span>
      )}
    </span>
  )
}

function FilterBar({ rows }: { rows: Row[] }) {
  const { f, set, clear, active } = useFilters()
  const all = rows.map((r) => r.stop)
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
  const lineNames = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.name)))].sort(compareLineName)
  const more = [f.street, f.road, f.maint].filter(Boolean).length
  const chip = (on: boolean) => cn('inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors', on ? 'bg-accent text-accent-ink ring-accent' : 'bg-surface text-ink-2 ring-hairline-2 hover:ring-accent/40 hover:text-ink')
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {['东', '南', '西', '北', '场站'].map((d) => (
        <button key={d} aria-pressed={f.dir === d} onClick={() => set('dir', f.dir === d ? '' : d)} className={chip(f.dir === d)}>
          {d}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px bg-hairline-2" />
      <label className={cn(chip(!!f.line), 'relative pr-6')}>
        {f.line || '经过线路'}
        <ChevronDown size={13} className="absolute right-2" />
        <select aria-label="经过线路" value={f.line} onChange={(e) => set('line', e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
          <option value="">全部线路</option>
          {lineNames.map((d) => <option key={d}>{d}</option>)}
        </select>
      </label>
      <button aria-pressed={f.todo} onClick={() => set('todo', f.todo ? '' : '1')} className={chip(f.todo)}>
        <BreathingDot className={f.todo ? 'hidden' : ''} /> 待处理
      </button>
      <Popover
        width={260}
        trigger={({ toggle }) => (
          <button onClick={toggle} className={chip(more > 0)}>
            <SlidersHorizontal size={13} /> 更多{more > 0 && ` ${more}`}
          </button>
        )}
      >
        {() => (
          <div className="flex flex-col gap-2.5 p-2">
            {[
              ['street', '街道', uniq(all.map((s) => s.street))],
              ['road', '路段', uniq(all.map((s) => s.road))],
              ['maint', '维护公司', uniq(all.map((s) => s.maintainer))],
            ].map(([k, label, opts]) => (
              <label key={k as string} className="flex flex-col gap-1">
                <span className="text-[12px] text-ink-3">{label as string}</span>
                <Select value={(f as any)[k as string]} onChange={(e) => set(k as string, e.target.value)}>
                  <option value="">全部</option>
                  {(opts as string[]).map((o) => <option key={o}>{o}</option>)}
                </Select>
              </label>
            ))}
          </div>
        )}
      </Popover>
      {active > 0 && (
        <button onClick={clear} className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] text-ink-3 hover:text-ink">
          <X size={13} /> 清空
        </button>
      )}
    </div>
  )
}

export function StopListPage() {
  const rows = useRows()
  const { f, set, clear } = useFilters()
  const list = applyFilters(rows, f)
  const pager = usePager(list, JSON.stringify(f), 20)
  const nav = useNavigate()
  const toast = useToast()
  const { lines, stops } = useStore()
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 页面: '站点列表', 筛选: f, 结果数: list.length, 选中: sel }), [JSON.stringify(f), list.length, sel])

  const total = rows.filter((r) => !r.stop.deleted).length
  const deleted = rows.filter((r) => r.stop.deleted).length
  const selRow = rows.find((r) => r.stop.id === sel)
  const selRoutes = selRow
    ? lines.flatMap((l) => l.routes.filter((r) => r.stopIds.includes(selRow.stop.id)).map((r) => ({ id: r.id, points: routePoints(r.stopIds, stops), tone: 'normal' as const })))
    : []

  const map = (
    <MapView
      className="absolute inset-0"
      stops={pager.slice.map((r) => r.stop)}
      selectedId={sel}
      hoverId={hover}
      onHover={setHover}
      onSelect={setSel}
      routes={selRoutes}
      fit={selRow ? { key: selRow.stop.id, points: [[selRow.stop.x, selRow.stop.y]], pad: 150 } : { key: 'all', points: [[0, 0], [1000, 640]], pad: 0 }}
      overlay={
        selRow && (
          <div key={selRow.stop.id} className="gt-rise absolute bottom-4 right-4 z-10 w-[360px] rounded-2xl bg-surface p-4 shadow-pop ring-1 ring-hairline">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-display text-[19px] font-semibold">{selRow.stop.name}</h3>
                  <DirBadge dir={selRow.stop.direction} />
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">
                  {selRow.stop.road} · {selRow.stop.street} · {selRow.stop.district}
                </div>
              </div>
              <IconButton label="关闭" className="-mr-1.5 -mt-1" onClick={() => setSel(null)}>
                <X size={15} />
              </IconButton>
            </div>
            <div className="mt-3">
              <Plates lines={selRow.lines} max={10} />
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3 text-[12.5px] text-ink-3">
              站牌集 {selRow.shelves} 架 · {selRow.boards} 牌
              {selRow.wait > 0 && <StatusChip status="待编排" count={selRow.wait} size="sm" />}
              {selRow.bad > 0 && <StatusChip status="失效" count={selRow.bad} size="sm" />}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" onClick={() => nav(`/stops/${selRow.stop.id}`)}>
                查看详情 <ArrowUpRight size={14} />
              </Button>
              {!selRow.stop.deleted && (
                <Button onClick={() => nav(`/sign-sets/${selRow.stop.id}`)}>
                  <Signpost size={14} /> 站牌集
                </Button>
              )}
            </div>
          </div>
        )
      }
    />
  )

  return (
    <SplitView
      storageKey="stops"
      defaultWidth={440}
      map={map}
      left={({ width }) => {
        const wide = width >= 760
        return (
          <div className="flex h-full flex-col">
            <div className="px-6 pb-3 pt-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h1 className="font-display text-[26px] font-semibold leading-9">{f.tab === 'deleted' ? '已删除的站点' : '站点'}</h1>
                  <p className="text-[13px] text-ink-3">
                    {f.tab === 'deleted' ? `${deleted} 个，修改历史仍可查看` : `${total} 个站点${list.length !== total ? `，筛出 ${list.length} 个` : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Popover
                    align="right"
                    width={200}
                    trigger={({ toggle }) => (
                      <IconButton label="更多操作" onClick={toggle}>
                        <MoreHorizontal size={17} />
                      </IconButton>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem onClick={() => { close(); toast('原型：导入流程（上传 → 三栏预览 → 确认）不在 M0', 'info') }}>
                          <Upload size={14} /> 导入站点
                        </MenuItem>
                        <MenuItem onClick={() => { close(); toast(`原型：将导出当前筛选的 ${list.length} 个站点`, 'info') }}>
                          <Download size={14} /> 导出当前结果
                        </MenuItem>
                        <MenuLabel>视图</MenuLabel>
                        <MenuItem onClick={() => { close(); set('tab', f.tab === 'deleted' ? '' : 'deleted') }} hint={f.tab === 'deleted' ? undefined : deleted || undefined}>
                          <Trash2 size={14} /> {f.tab === 'deleted' ? '返回在用站点' : '已删除的站点'}
                        </MenuItem>
                      </>
                    )}
                  </Popover>
                  <Button variant="primary" onClick={() => nav('/stops/new')}>
                    <Plus size={15} /> 新建
                  </Button>
                </div>
              </div>
              <div className="relative mt-4">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input aria-label="搜索站点" placeholder="搜索站名、英文名、路段" value={f.q} onChange={(e) => set('q', e.target.value)} className="h-10 rounded-xl pl-9 text-[14px]" />
              </div>
              <div className="mt-3">
                <FilterBar rows={rows} />
              </div>
            </div>

            {wide && (
              <div className="grid grid-cols-[minmax(200px,1.3fr)_minmax(160px,1fr)_minmax(220px,1.6fr)_150px_120px] gap-4 border-y border-hairline bg-surface-2 px-6 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3">
                <span>站点</span>
                <span>位置</span>
                <span>经过线路</span>
                <span>站牌集</span>
                <span>最近修改</span>
              </div>
            )}
            <ul className={cn('min-h-0 flex-1 overflow-auto', !wide && 'border-t border-hairline')} onMouseLeave={() => setHover(null)}>
              {pager.slice.map((r) => {
                const active = sel === r.stop.id
                const open = () => nav(`/stops/${r.stop.id}`)
                return (
                  <li key={r.stop.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-current={active}
                      onClick={() => setSel(r.stop.id)}
                      onDoubleClick={open}
                      onKeyDown={(e) => e.key === 'Enter' && open()}
                      onMouseEnter={() => setHover(r.stop.id)}
                      className={cn(
                        'group relative cursor-pointer border-b border-hairline px-6 py-3 transition-colors',
                        active ? 'bg-accent-soft/60' : hover === r.stop.id ? 'bg-surface-2' : '',
                        wide && 'grid grid-cols-[minmax(200px,1.3fr)_minmax(160px,1fr)_minmax(220px,1.6fr)_150px_120px] items-center gap-4',
                      )}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-[16px] font-semibold">{r.stop.name}</span>
                        <DirBadge dir={r.stop.direction} size="sm" />
                        {!wide && (
                          <span className="ml-auto flex items-center gap-2">
                            <Todo r={r} />
                            <button aria-label={`打开 ${r.stop.name} 详情`} onClick={(e) => { e.stopPropagation(); open() }} className="flex size-7 items-center justify-center rounded-lg text-ink-3 opacity-0 hover:bg-sunken hover:text-ink group-hover:opacity-100 focus:opacity-100">
                              <ArrowUpRight size={15} />
                            </button>
                          </span>
                        )}
                      </div>
                      <div className={cn('text-[12.5px] text-ink-3', !wide && 'mt-0.5')}>
                        {r.stop.road} · {r.stop.street}
                      </div>
                      <div className={cn(!wide && 'mt-2')}>
                        <Plates lines={r.lines} max={wide ? 8 : 7} />
                      </div>
                      {wide && (
                        <>
                          <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
                            {r.shelves} 架 / {r.boards} 牌 <Todo r={r} />
                          </div>
                          <div className="flex items-center justify-between text-[12.5px] tabular-nums text-ink-3">
                            {r.stop.updatedAt.slice(5)}
                            <button aria-label={`打开 ${r.stop.name} 详情`} onClick={(e) => { e.stopPropagation(); open() }} className="flex size-7 items-center justify-center rounded-lg opacity-0 hover:bg-sunken hover:text-ink group-hover:opacity-100 focus:opacity-100">
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
              {list.length === 0 && (
                <li className="flex flex-col items-center px-8 py-14 text-center">
                  <EmptySearchArt />
                  <p className="mt-2 font-display text-[16px] font-semibold">{f.tab === 'deleted' ? '还没有删除过站点' : '没有找到符合条件的站点'}</p>
                  <p className="mt-1 text-[13px] text-ink-3">{f.tab === 'deleted' ? '在站点详情里删除没有线路经过的站点，例如「体育中心」。' : '换个关键字，或者清空筛选再试。'}</p>
                  {f.tab !== 'deleted' && (
                    <Button className="mt-4" onClick={clear}>
                      清空筛选
                    </Button>
                  )}
                </li>
              )}
            </ul>
            <div className="shrink-0 border-t border-hairline bg-surface-2 px-6 py-2.5">
              <Pagination pager={pager} unit="个" sizes={[10, 20, 50, 100]} compact={width < 440} />
            </div>
          </div>
        )
      }}
    />
  )
}
