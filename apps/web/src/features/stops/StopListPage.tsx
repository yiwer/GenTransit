// 站点列表（5.3.2）：列表 + 地图分栏。左栏窄时每行显示站名、方位章、经过线路；左栏不小于 760px 时切换为宽表。
// 地图只画当前页站点；单击定位并浮出摘要卡片，双击或回车进入详情，悬停时地图上临时强调（F-COM-13）
import {
  DIRECTIONS,
  STOP_DIFF_SPEC,
  type LineListItem,
  type Page,
  type StopListItem,
  type StopListQuery,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  ArrowUpRight,
  ChevronDown,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { DeletedList } from '@/components/gt/deleted'
import { EmptySearchArt } from '@/components/gt/lively'
import { Pagination, usePageParams } from '@/components/gt/pagination'
import { DictPicker, RegionPicker } from '@/components/gt/pickers'
import { SplitView } from '@/components/gt/split-view'
import { DirBadge, RoutePlate } from '@/components/gt/symbols'
import { Button, IconButton } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useExtFields, useSettings } from '@/features/common/data'
import { ImportDrawer } from '@/features/import/ImportDrawer'
import { get, withQuery } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import { ColumnPicker, useColumnPrefs, type ColMeta } from '@/components/gt/columns'
import { STOP_DEFAULT_COLUMNS, stopColumns } from './columns'
import { Plates, regionText, useStopList } from './shared'

const FILTER_KEYS = ['q', 'dir', 'lineIds', 'districtId', 'streetId', 'roadId', 'maintainerId'] as const

/** 筛选条件写入 URL（F-COM-02）；筛选变化时回到第 1 页（F-COM-12） */
function useFilters() {
  const [sp, setSp] = useSearchParams()
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >
  const tab = sp.get('tab') === 'deleted' ? 'deleted' : 'active'
  const sort = (sp.get('sort') ?? 'name') as StopListQuery['sort']
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
  const active = FILTER_KEYS.filter((k) => f[k]).length
  return { f, tab, sort, set, clear, active }
}

/** "经过线路"筛选：线路牌多选，取并集 */
export function LineFilter({
  value,
  onChange,
  chip,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  chip: (on: boolean) => string
}) {
  const [q, setQ] = useState('')
  const lines = useQuery({
    queryKey: ['lines', 'list', { q: q.trim(), size: 100, picker: true }],
    queryFn: () => get<Page<LineListItem>>('/api/lines', { q: q.trim(), size: 100 }),
  })
  const chosen = useQuery({
    queryKey: ['lines', 'list', { ids: value }],
    queryFn: () => get<Page<LineListItem>>('/api/lines', { size: 100 }),
    enabled: value.length > 0,
  })
  const names = (chosen.data?.items ?? []).filter((l) => value.includes(l.id))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={chip(value.length > 0)} aria-label="经过线路">
          {value.length ? (
            <span className="flex items-center gap-1">
              经过
              {names.slice(0, 3).map((l) => (
                <RoutePlate key={l.id} name={l.name} size="xs" />
              ))}
              {value.length > 3 && `+${value.length - 3}`}
            </span>
          ) : (
            '经过线路'
          )}
          <ChevronDown size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-2">
        <input
          autoFocus
          aria-label="搜索线路"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索线路名"
          className="mb-1.5 h-8 w-full rounded-lg bg-sunken px-2.5 text-[13.5px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <ul className="flex max-h-[280px] flex-wrap gap-1.5 overflow-auto p-1">
          {(lines.data?.items ?? []).map((l) => {
            const on = value.includes(l.id)
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  title={l.routes[0] ? `${l.routes[0].origin} — ${l.routes[0].terminal}` : l.name}
                  onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
                  className={cn(
                    'rounded-[5px] transition-transform',
                    on
                      ? 'scale-105 ring-2 ring-coral ring-offset-1 ring-offset-surface'
                      : 'opacity-80 hover:opacity-100',
                  )}
                >
                  <RoutePlate name={l.name} size="sm" state={l.status === 'suspended' ? 'suspended' : 'normal'} />
                </button>
              </li>
            )
          })}
          {lines.isSuccess && !lines.data.items.length && (
            <li className="w-full py-3 text-center text-[12.5px] text-ink-3">没有线路</li>
          )}
        </ul>
        {value.length > 0 && (
          <button
            type="button"
            className="mt-1 px-1 text-[12px] text-accent hover:underline"
            onClick={() => onChange([])}
          >
            清除线路筛选
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function FilterBar() {
  const { f, set, clear, active } = useFilters()
  const settings = useSettings()
  const more = [f.districtId, f.streetId, f.roadId, f.maintainerId].filter(Boolean).length
  const chip = (on: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors',
      on
        ? 'bg-accent text-accent-ink ring-accent'
        : 'bg-surface text-ink-2 ring-hairline-2 hover:text-ink hover:ring-accent/40',
    )
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {settings.data?.orientationMode !== 'code' &&
        DIRECTIONS.filter((d) => d !== '无').map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={f.dir === d}
            onClick={() => set({ dir: f.dir === d ? null : d })}
            className={chip(f.dir === d)}
          >
            {d}
          </button>
        ))}
      <span className="mx-0.5 h-4 w-px bg-hairline-2" />
      <LineFilter
        value={f.lineIds ? f.lineIds.split(',') : []}
        onChange={(ids) => set({ lineIds: ids.join(',') || null })}
        chip={chip}
      />
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={chip(more > 0)}>
            <SlidersHorizontal size={13} /> 更多筛选{more > 0 && ` ${more}`}
            <ChevronDown size={13} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-3">
          <div className="flex flex-col gap-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">区</span>
              <RegionPicker
                ghost={false}
                creatable={false}
                level="district"
                aria-label="筛选区"
                placeholder="全部"
                value={f.districtId || null}
                onChange={(id) => set({ districtId: id, streetId: null })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">街道</span>
              <RegionPicker
                ghost={false}
                creatable={false}
                level="street"
                parentId={f.districtId || undefined}
                aria-label="筛选街道"
                placeholder="全部"
                value={f.streetId || null}
                onChange={(id) => set({ streetId: id })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">路段</span>
              <DictPicker
                ghost={false}
                creatable={false}
                category="road"
                aria-label="筛选路段"
                placeholder="全部"
                value={f.roadId || null}
                onChange={(id) => set({ roadId: id })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink-3">维护公司</span>
              <DictPicker
                ghost={false}
                creatable={false}
                category="maintainer"
                aria-label="筛选维护公司"
                placeholder="全部"
                value={f.maintainerId || null}
                onChange={(id) => set({ maintainerId: id })}
              />
            </label>
          </div>
        </PopoverContent>
      </Popover>
      {active > 0 && (
        <button
          type="button"
          onClick={clear}
          className="ml-0.5 inline-flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] text-ink-3 hover:text-ink"
        >
          <X size={13} /> 清空
        </button>
      )}
    </div>
  )
}

export function StopListPage() {
  const { f, tab, sort, set, clear } = useFilters()
  const { page, size, setPage, setSize } = usePageParams()
  const nav = useNavigate()
  // 搜索框受控：清空筛选、浏览器后退时跟随 URL
  const [q, setQ] = useState(f.q)
  useEffect(() => setQ((cur) => (cur.trim() === f.q ? cur : f.q)), [f.q])
  const list = useStopList({ ...f, sort, page, size })
  const [importing, setImporting] = useState(false)
  const ext = useExtFields('stop')
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const selRow = items.find((s) => s.id === sel)
  const open = (id: string) => nav(`/stops/${id}`)

  const columns = useMemo(() => stopColumns((ext.data ?? []).filter((x) => x.enabled)), [ext.data])
  const prefs = useColumnPrefs(
    'gt-stops-columns',
    columns.map((c) => c.id!),
    STOP_DEFAULT_COLUMNS,
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

  const map = (
    <MapView
      className="absolute inset-0"
      points={items.map((s) => ({ id: s.id, lng: s.lng, lat: s.lat, label: s.name, sub: s.direction }))}
      selectedId={sel}
      hoverId={hover}
      onHover={setHover}
      onSelect={setSel}
      onOpen={open}
      fit={
        selRow
          ? { key: selRow.id, points: [[selRow.lng, selRow.lat]] }
          : {
              key: `page-${page}-${size}-${JSON.stringify(f)}-${items.length}`,
              points: items.map((s) => [s.lng, s.lat]),
            }
      }
      overlay={
        selRow && (
          <StopCard
            s={selRow}
            onClose={() => setSel(null)}
            onOpen={() => open(selRow.id)}
            onEdit={() => nav(`/stops/${selRow.id}/edit`)}
          />
        )
      }
    />
  )

  return (
    <>
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
                    <h1 className="font-display text-[26px] font-semibold leading-9">
                      {tab === 'deleted' ? '已删除的站点' : '站点'}
                    </h1>
                    <p className="text-[13px] text-ink-3">
                      {tab === 'deleted'
                        ? '来自删除前最后一份快照，修改历史仍可查看'
                        : list.isSuccess
                          ? `${total} 个站点`
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
                          <Upload size={14} /> 导入站点
                        </MenuItem>
                        <MenuItem
                          onSelect={() => window.location.assign(withQuery('/api/export/stops', { ...f, sort }))}
                        >
                          <Download size={14} /> 导出当前结果
                        </MenuItem>
                        <MenuSeparator />
                        <MenuLabel>视图</MenuLabel>
                        <MenuItem onSelect={() => set({ tab: tab === 'deleted' ? null : 'deleted' })}>
                          <Trash2 size={14} /> {tab === 'deleted' ? '返回在用站点' : '已删除的站点'}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                    <Button variant="primary" onClick={() => nav('/stops/new')}>
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
                        aria-label="搜索站点"
                        placeholder="搜索站名、英文名、路段"
                        value={q}
                        onChange={(e) => {
                          setQ(e.target.value)
                          set({ q: e.target.value.trim() || null })
                        }}
                        className="h-10 rounded-xl pl-9 text-[14px]"
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <FilterBar />
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
                <DeletedList type="stop" spec={STOP_DIFF_SPEC} unit="站点" />
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
                        const on = sort.replace('-', '') === c.id
                        return (
                          <span key={c.id} role="columnheader" className="truncate">
                            {sortable ? (
                              <button
                                type="button"
                                className={cn('inline-flex items-center gap-1 hover:text-ink', on && 'text-ink')}
                                onClick={() =>
                                  set({
                                    sort:
                                      c.id === 'name'
                                        ? sort === 'name'
                                          ? '-name'
                                          : null
                                        : sort === '-updatedAt'
                                          ? 'updatedAt'
                                          : '-updatedAt',
                                  })
                                }
                              >
                                {(c.columnDef.meta as ColMeta).label}
                                {on && (sort.startsWith('-') ? '↓' : '↑')}
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
                    aria-label="站点列表"
                    onMouseLeave={() => setHover(null)}
                  >
                    {table.getRowModel().rows.map((row) => {
                      const s = row.original
                      const active = sel === s.id
                      return (
                        <li key={s.id}>
                          <div
                            role="button"
                            tabIndex={0}
                            aria-current={active}
                            aria-label={`${s.name}（${s.direction}）`}
                            onClick={() => setSel(s.id)}
                            onDoubleClick={() => open(s.id)}
                            onKeyDown={(e) => e.key === 'Enter' && open(s.id)}
                            onMouseEnter={() => setHover(s.id)}
                            className={cn(
                              'group relative cursor-pointer border-b border-hairline px-6 py-3 transition-colors',
                              active ? 'bg-accent-soft/60' : hover === s.id ? 'bg-surface-2' : '',
                              wide && 'grid items-center gap-4 py-2.5 text-[13px]',
                            )}
                            style={wide ? { gridTemplateColumns: grid } : undefined}
                          >
                            {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                            {wide ? (
                              <>
                                {row.getVisibleCells().map((cell) => (
                                  <div key={cell.id} className="flex min-w-0 items-center">
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                  </div>
                                ))}
                                <OpenButton s={s} onOpen={() => open(s.id)} />
                              </>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <span className="truncate font-display text-[16px] font-semibold">{s.name}</span>
                                  <DirBadge dir={s.direction} size="sm" />
                                  <span className="ml-auto">
                                    <OpenButton s={s} onOpen={() => open(s.id)} />
                                  </span>
                                </div>
                                <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
                                  {[s.road?.name, s.street?.name ?? s.district?.name].filter(Boolean).join(' · ') ||
                                    '未填写位置信息'}
                                </div>
                                <div className="mt-2">
                                  <Plates lines={s.lines} max={7} />
                                </div>
                              </>
                            )}
                          </div>
                        </li>
                      )
                    })}
                    {list.isSuccess && items.length === 0 && (
                      <li className="flex flex-col items-center px-8 py-14 text-center">
                        <EmptySearchArt />
                        <p className="mt-2 font-display text-[16px] font-semibold">
                          {total === 0 && !Object.values(f).some(Boolean) ? '还没有站点' : '没有找到符合条件的站点'}
                        </p>
                        <p className="mt-1 text-[13px] text-ink-3">
                          {Object.values(f).some(Boolean)
                            ? '换个关键字，或者清空筛选再试。'
                            : '点右上角「新建」，在地图上点选位置即可。'}
                        </p>
                        {Object.values(f).some(Boolean) && (
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
                      unit="个"
                      compact={width < 440}
                    />
                  </div>
                </>
              )}
            </div>
          )
        }}
      />
      <ImportDrawer kind="stop" open={importing} onOpenChange={setImporting} />
    </>
  )
}

function OpenButton({ s, onOpen }: { s: StopListItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`打开 ${s.name} 详情`}
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

/** 地图右下角的摘要卡片 */
function StopCard({
  s,
  onClose,
  onOpen,
  onEdit,
}: {
  s: StopListItem
  onClose: () => void
  onOpen: () => void
  onEdit: () => void
}) {
  return (
    <div
      key={s.id}
      className="gt-rise absolute bottom-10 right-4 z-10 w-[360px] rounded-2xl bg-surface p-4 shadow-pop ring-1 ring-hairline"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-[19px] font-semibold">{s.name}</h3>
            <DirBadge dir={s.direction} />
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
            {[s.road?.name, regionText(s)].filter(Boolean).join(' · ') || '未填写位置信息'}
          </div>
        </div>
        <IconButton label="关闭" className="-mr-1.5 -mt-1" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="mt-3">
        <Plates lines={s.lines} max={10} />
      </div>
      <div className="mt-3 flex gap-2 border-t border-hairline pt-3">
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
