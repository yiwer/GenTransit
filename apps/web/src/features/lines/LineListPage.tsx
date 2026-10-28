// 线路列表（5.4.2）：列表 + 地图分栏；线路名一律以线路牌显示；悬停或单击一行时地图上强调该线路的走向（F-COM-13）
import {
  LINE_DIFF_SPEC,
  LINE_MODE_LABEL,
  LINE_MODES,
  LINE_STATUS_LABEL,
  ROUTE_KIND_LABEL,
  TICKET_TYPE_LABEL,
  formatExtValue,
  type ExtFieldDef,
  type LineListItem,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ArrowUpRight, Download, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ColumnPicker, column, dim, useColumnPrefs, type ColMeta } from '@/components/gt/columns'
import { DeletedList } from '@/components/gt/deleted'
import { EmptySearchArt } from '@/components/gt/lively'
import { Pagination, usePageParams } from '@/components/gt/pagination'
import { SplitView } from '@/components/gt/split-view'
import { RoutePlate } from '@/components/gt/symbols'
import { Button, IconButton } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/dropdown-menu'
import { Input, NativeSelect } from '@/components/ui/input'
import { useCompanies, useExtFields } from '@/features/common/data'
import { ImportDrawer } from '@/features/import/ImportDrawer'
import { get, withQuery } from '@/lib/api'
import { cn, fmtDateTime } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import type { MapRoute } from '@/map/types'
import { StatusPill, endpointsText, kindText, useLineList } from './shared'

const FILTER_KEYS = ['q', 'mode', 'status', 'companyId', 'stopId'] as const

function useFilters() {
  const [sp, setSp] = useSearchParams()
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >
  const tab = sp.get('tab') === 'deleted' ? 'deleted' : 'active'
  const sort = sp.get('sort') ?? 'auto'
  const set = (patch: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        p.delete('page')
        return p
      },
      { replace: true },
    )
  const clear = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))
  return { f, tab, sort, set, clear, active: FILTER_KEYS.filter((k) => f[k]).length }
}

function lineColumns(ext: ExtFieldDef[]): ColumnDef<LineListItem>[] {
  const col = column<LineListItem>
  return [
    col('name', '线路名', 'minmax(96px,0.6fr)', (l) => (
      <RoutePlate name={l.name} state={l.status === 'suspended' ? 'suspended' : 'normal'} />
    )),
    col('number', '管理编号', '110px', (l) => <span className="font-mono text-[12.5px] text-ink-2">{l.number}</span>),
    col('nameEn', '英文名', 'minmax(120px,0.8fr)', (l) => (
      <span className="truncate italic text-ink-2">{l.nameEn || '—'}</span>
    )),
    col('mode', '模式', '64px', (l) => LINE_MODE_LABEL[l.mode]),
    col('status', '状态', '80px', (l) => <StatusPill status={l.status} />),
    col('endpoints', '起终点', 'minmax(180px,1.5fr)', (l) => (
      <span className="truncate font-display font-semibold">{endpointsText(l)}</span>
    )),
    col('counts', '各走向站数', 'minmax(130px,1fr)', (l) => (
      <span className="truncate text-ink-2">
        {l.routes.map((r) => `${ROUTE_KIND_LABEL[r.kind]} ${r.count}`).join(' · ')}
      </span>
    )),
    col('company', '公交公司', 'minmax(120px,1fr)', (l) => dim(l.company?.name ?? '')),
    col('ticketType', '售票类型', '84px', (l) => dim(l.ticketType ? TICKET_TYPE_LABEL[l.ticketType] : '')),
    col('fareSystem', '票制', '84px', (l) => dim(l.fareSystem?.name ?? '')),
    col('fare', '票价', '84px', (l) => dim(l.fare)),
    col('updatedAt', '最近修改', '132px', (l) => (
      <span className="tabular-nums text-ink-3">{fmtDateTime(l.updatedAt).slice(2)}</span>
    )),
    ...ext.map((x) => col(`ext:${x.key}`, x.name, 'minmax(110px,0.8fr)', (l) => dim(formatExtValue(l.ext[x.key])))),
  ]
}

const DEFAULT_COLUMNS = ['name', 'endpoints', 'counts', 'company', 'status', 'updatedAt']

export function LineListPage() {
  const { f, tab, sort, set, clear, active } = useFilters()
  const { page, size, setPage, setSize } = usePageParams()
  const nav = useNavigate()
  const [q, setQ] = useState(f.q)
  useEffect(() => setQ((cur) => (cur.trim() === f.q ? cur : f.q)), [f.q])
  const list = useLineList({ ...f, sort, page, size })
  const companies = useCompanies()
  const ext = useExtFields('line')
  const stopName = useQuery({
    queryKey: ['stops', 'name', f.stopId],
    queryFn: () => get<{ name: string; direction: string }>(`/api/stops/${f.stopId}`),
    enabled: Boolean(f.stopId),
  })
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const selRow = items.find((l) => l.id === sel)
  const focus = hover ?? sel
  const open = (id: string) => nav(`/lines/${id}`)

  const columns = useMemo(() => lineColumns((ext.data ?? []).filter((x) => x.enabled)), [ext.data])
  const prefs = useColumnPrefs(
    'gt-lines-columns',
    columns.map((c) => c.id!),
    DEFAULT_COLUMNS,
  )
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnOrder: prefs.order,
      columnVisibility: Object.fromEntries(columns.map((c) => [c.id!, prefs.visible.has(c.id!)])),
    },
  })
  const visibleCols = table.getVisibleLeafColumns()
  const grid = visibleCols.map((c) => (c.columnDef.meta as ColMeta).width).join(' ') + ' 40px'

  const routes: MapRoute[] = items.flatMap((l) =>
    l.routes.map((r) => ({
      id: r.id,
      points: r.path,
      tone: focus ? (l.id === focus ? 'strong' : 'faint') : 'normal',
      flow: l.id === focus && l.status === 'running',
    })),
  )
  const allPoints = items.flatMap((l) => l.routes.flatMap((r) => r.path))
  const exportUrl = withQuery('/api/export/lines', { ...f, sort })

  const map = (
    <MapView
      className="absolute inset-0"
      routes={routes}
      fit={
        selRow
          ? { key: selRow.id, points: selRow.routes.flatMap((r) => r.path) }
          : { key: `page-${page}-${size}-${JSON.stringify(f)}-${items.length}`, points: allPoints }
      }
      overlay={
        selRow && (
          <LineCard
            l={selRow}
            onClose={() => setSel(null)}
            onOpen={() => open(selRow.id)}
            onEdit={() => nav(`/lines/${selRow.id}/edit`)}
          />
        )
      }
    />
  )

  const chip = (on: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors',
      on
        ? 'bg-accent text-accent-ink ring-accent'
        : 'bg-surface text-ink-2 ring-hairline-2 hover:text-ink hover:ring-accent/40',
    )

  return (
    <>
      <SplitView
        storageKey="lines"
        defaultWidth={460}
        map={map}
        left={({ width }) => {
          const wide = width >= 760
          return (
            <div className="flex h-full flex-col">
              <div className="px-6 pb-3 pt-6">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h1 className="font-display text-[26px] font-semibold leading-9">
                      {tab === 'deleted' ? '已删除的线路' : '线路'}
                    </h1>
                    <p className="text-[13px] text-ink-3">
                      {tab === 'deleted'
                        ? '来自删除前最后一份快照，修改历史仍可查看'
                        : list.isSuccess
                          ? `${total} 条线路`
                          : '正在读取…'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Menu>
                      <MenuTrigger asChild>
                        <IconButton label="更多操作">
                          <MoreHorizontal size={17} />
                        </IconButton>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem onSelect={() => setImporting(true)}>
                          <Upload size={14} /> 导入线路
                        </MenuItem>
                        <MenuItem onSelect={() => window.location.assign(exportUrl)}>
                          <Download size={14} /> 导出当前结果
                        </MenuItem>
                        <MenuSeparator />
                        <MenuLabel>视图</MenuLabel>
                        <MenuItem onSelect={() => set({ tab: tab === 'deleted' ? null : 'deleted' })}>
                          <Trash2 size={14} /> {tab === 'deleted' ? '返回在用线路' : '已删除的线路'}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                    <Button variant="primary" onClick={() => nav('/lines/new')}>
                      <Plus size={15} /> 新建
                    </Button>
                  </div>
                </div>
                {tab === 'active' && (
                  <>
                    <div className="relative mt-4">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                      />
                      <Input
                        aria-label="搜索线路"
                        placeholder="搜索线路名、管理编号、英文名"
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value)
                          set({ q: e.target.value.trim() || null })
                        }}
                        className="h-10 rounded-xl pl-9 text-[14px]"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {LINE_MODES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={f.mode === m}
                          onClick={() => set({ mode: f.mode === m ? null : m })}
                          className={chip(f.mode === m)}
                        >
                          {LINE_MODE_LABEL[m]}
                        </button>
                      ))}
                      <span className="mx-0.5 h-4 w-px bg-hairline-2" />
                      <button
                        type="button"
                        aria-pressed={f.status === 'suspended'}
                        onClick={() => set({ status: f.status === 'suspended' ? null : 'suspended' })}
                        className={chip(f.status === 'suspended')}
                      >
                        只看{LINE_STATUS_LABEL.suspended}
                      </button>
                      <label className="relative">
                        <NativeSelect
                          aria-label="公交公司"
                          value={f.companyId}
                          onChange={(e) => set({ companyId: e.target.value || null })}
                          className="h-7 w-auto rounded-full bg-surface py-0 pl-2.5 text-[12.5px] ring-hairline-2"
                        >
                          <option value="">全部公司</option>
                          {(companies.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      {f.stopId && (
                        <span className={cn(chip(true), 'pr-1')}>
                          经过 {stopName.data ? `${stopName.data.name}（${stopName.data.direction}）` : '站点'}
                          <button
                            type="button"
                            aria-label="取消按站点筛选"
                            onClick={() => set({ stopId: null })}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-accent-hover"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      )}
                      {active > 0 && (
                        <button
                          type="button"
                          onClick={clear}
                          className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] text-ink-3 hover:text-ink"
                        >
                          <X size={13} /> 清空
                        </button>
                      )}
                      {wide && (
                        <span className="ml-auto">
                          <ColumnPicker columns={columns} prefs={prefs} />
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {tab === 'deleted' ? (
                <DeletedList type="line" spec={LINE_DIFF_SPEC} unit="线路" />
              ) : (
                <>
                  {wide && (
                    <div
                      role="row"
                      className="grid gap-4 border-y border-hairline bg-surface-2 px-6 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3"
                      style={{ gridTemplateColumns: grid }}
                    >
                      {visibleCols.map((c) => {
                        const sortable = c.id === 'name' || c.id === 'updatedAt'
                        const on = c.id === 'name' ? sort === 'auto' || sort === 'name' : sort.replace('-', '') === c.id
                        return (
                          <span key={c.id} role="columnheader" className="truncate">
                            {sortable ? (
                              <button
                                type="button"
                                className={cn('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')}
                                onClick={() =>
                                  set({
                                    sort: c.id === 'name' ? null : sort === '-updatedAt' ? 'updatedAt' : '-updatedAt',
                                  })
                                }
                              >
                                {(c.columnDef.meta as ColMeta).label}
                                {on && (sort === '-updatedAt' ? '↓' : '↑')}
                              </button>
                            ) : (
                              (c.columnDef.meta as ColMeta).label
                            )}
                          </span>
                        )
                      })}
                      <span />
                    </div>
                  )}
                  <ul
                    className={cn('min-h-0 flex-1 overflow-auto', !wide && 'border-t border-hairline')}
                    aria-label="线路列表"
                    onMouseLeave={() => setHover(null)}
                  >
                    {table.getRowModel().rows.map((row) => {
                      const l = row.original
                      const activeRow = sel === l.id
                      return (
                        <li key={l.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            aria-current={activeRow}
                            aria-label={l.name}
                            onClick={() => setSel(l.id)}
                            onDoubleClick={() => open(l.id)}
                            onKeyDown={(e) => e.key === 'Enter' && open(l.id)}
                            onMouseEnter={() => setHover(l.id)}
                            className={cn(
                              'group relative cursor-pointer border-b border-hairline px-6 py-3 transition-colors',
                              activeRow ? 'bg-accent-soft/60' : hover === l.id ? 'bg-surface-2' : '',
                              wide && 'grid items-center gap-4 py-2.5 text-[13px]',
                            )}
                            style={wide ? { gridTemplateColumns: grid } : undefined}
                          >
                            {activeRow && (
                              <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />
                            )}
                            {wide ? (
                              <>
                                {row.getVisibleCells().map((cell) => (
                                  <div key={cell.id} className="flex min-w-0 items-center">
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </div>
                                ))}
                                <OpenButton name={l.name} onOpen={() => open(l.id)} />
                              </>
                            ) : (
                              <div className="flex items-start gap-3">
                                <RoutePlate
                                  name={l.name}
                                  size="lg"
                                  state={l.status === 'suspended' ? 'suspended' : 'normal'}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate font-display text-[15.5px] font-semibold">
                                      {endpointsText(l)}
                                    </span>
                                    <span className="ml-auto">
                                      <OpenButton name={l.name} onOpen={() => open(l.id)} />
                                    </span>
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
                                    <span>{LINE_MODE_LABEL[l.mode]}</span>
                                    {l.company && <span>· {l.company.name}</span>}
                                    <span>
                                      · {l.routes.map((r) => `${ROUTE_KIND_LABEL[r.kind]} ${r.count} 站`).join('，')}
                                    </span>
                                    {l.status === 'suspended' && <StatusPill status="suspended" />}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </li>
                      )
                    })}
                    {list.isSuccess && items.length === 0 && (
                      <li className="flex flex-col items-center px-8 py-14 text-center">
                        <EmptySearchArt />
                        <p className="mt-2 font-display text-[16px] font-semibold">
                          {active ? '没有找到符合条件的线路' : '还没有线路'}
                        </p>
                        <p className="mt-1 text-[13px] text-ink-3">
                          {active ? '换个关键字，或者清空筛选再试。' : '点右上角「新建」，或从 Excel 导入。'}
                        </p>
                        {active > 0 && (
                          <Button className="mt-4" onClick={clear}>
                            清空筛选
                          </Button>
                        )}
                      </li>
                    )}
                  </ul>
                  <div className="shrink-0 border-t border-hairline bg-surface-2 px-6 py-2.5">
                    <Pagination
                      page={page}
                      size={size}
                      total={total}
                      onPage={setPage}
                      onSize={setSize}
                      unit="条"
                      compact={width < 440}
                    />
                  </div>
                </>
              )}
            </div>
          )
        }}
      />
      <ImportDrawer kind="line" open={importing} onOpenChange={setImporting} />
    </>
  )
}

function OpenButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`打开 ${name} 详情`}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className="flex size-7 items-center justify-center rounded-lg text-ink-3 opacity-0 hover:bg-sunken hover:text-ink focus:opacity-100 group-hover:opacity-100"
    >
      <ArrowUpRight size={15} />
    </button>
  )
}

function LineCard({
  l,
  onClose,
  onOpen,
  onEdit,
}: {
  l: LineListItem
  onClose: () => void
  onOpen: () => void
  onEdit: () => void
}) {
  return (
    <div
      key={l.id}
      className="gt-rise absolute bottom-10 right-4 z-10 w-[360px] rounded-2xl bg-surface p-4 shadow-pop ring-1 ring-hairline"
    >
      <div className="flex items-start gap-3">
        <RoutePlate name={l.name} size="lg" state={l.status === 'suspended' ? 'suspended' : 'normal'} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[17px] font-semibold">{endpointsText(l)}</div>
          <div className="mt-0.5 text-[12.5px] text-ink-3">
            {LINE_MODE_LABEL[l.mode]} · {l.company?.name ?? '未填写公司'}
          </div>
        </div>
        <IconButton label="关闭" className="-mr-1.5 -mt-1" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <ul className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3 text-[12.5px]">
        {l.routes.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="w-14 text-ink-2">{kindText(r.kind)}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.origin} → <span className="font-display font-semibold">{r.terminal}</span>
            </span>
            <span className="tabular-nums text-ink-3">{r.count} 站</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={onOpen}>
          查看详情 <ArrowUpRight size={14} />
        </Button>
        <Button onClick={onEdit}>
          <Pencil size={14} /> 编辑
        </Button>
      </div>
    </div>
  )
}
