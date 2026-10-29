// 站牌集列表（需求 5.5.4，M3 计划 4 节）：全宽表格，不分栏、不带地图（默认决定 9）。
// 筛选进 URL、可选择显示列、分页；"经过线路"用线路牌，"待编排""失效"用状态章，站架数配小号站架剪影。
// 单击站名打开预览抽屉；"编排"进编辑器；导出当前筛选结果
import { stopLabel, type SignSetListItem } from '@gentransit/shared'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ChevronDown, Download, Search, Signpost, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ColumnPicker, column, dim, useColumnPrefs, type ColMeta } from '@/components/gt/columns'
import { BreathingDot, EmptySearchArt } from '@/components/gt/lively'
import { Pagination, usePageParams } from '@/components/gt/pagination'
import { DictPicker, RegionPicker } from '@/components/gt/pickers'
import { DirBadge, StatusChip } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDict } from '@/features/common/data'
import { LineFilter } from '@/features/stops/StopListPage'
import { Plates, regionText } from '@/features/stops/shared'
import { withQuery } from '@/lib/api'
import { cn, fmtDateTime } from '@/lib/utils'
import { useBoardSizes, useSignSetList } from './data'
import { SignSetPreview } from './SignSetPreview'

const FILTER_KEYS = ['q', 'streetId', 'roadId', 'lineIds', 'shelfTypeIds', 'boardSize', 'pending'] as const
const SORTS = { name: '站名', '-pending': '待处理最多', '-updatedAt': '最近修改' } as const

function useFilters() {
  const [sp, setSp] = useSearchParams()
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >
  const sort = (sp.get('sort') ?? 'name') as keyof typeof SORTS
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
  return { f, sort, set, clear, active: FILTER_KEYS.filter((k) => f[k]).length }
}

/** 小号站架剪影：两根立柱托着一块牌 */
function ShelfGlyph() {
  return (
    <svg viewBox="0 0 22 18" width={22} height={18} aria-hidden="true" className="shrink-0">
      <rect x="4" y="2" width="14" height="9" rx="1.6" fill="var(--surface)" stroke="var(--ink-3)" strokeWidth="1.3" />
      <rect x="4" y="2" width="14" height="2.6" rx="1.2" fill="var(--plate)" />
      <path d="M7 11 V16 M15 11 V16 M3 16.5 H19" stroke="var(--ink-3)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function signSetColumns(open: (s: SignSetListItem) => void): ColumnDef<SignSetListItem>[] {
  const col = column<SignSetListItem>
  return [
    col('name', '站点', 'minmax(130px,1fr)', (s) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          open(s)
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-md text-left hover:text-accent"
        title="预览站牌集"
      >
        <span className="truncate font-display text-[14.5px] font-semibold">{s.stop.name}</span>
        <DirBadge dir={s.stop.direction} size="sm" />
      </button>
    )),
    col('lines', '经过线路', 'minmax(140px,1.4fr)', (s) => <Plates lines={s.lines} max={5} />),
    col('region', '市区街道', 'minmax(110px,1fr)', (s) => dim(regionText(s))),
    col('road', '路段', 'minmax(80px,0.6fr)', (s) => dim(s.road?.name ?? '')),
    col('shelves', '站架', 'minmax(130px,1fr)', (s) =>
      s.shelves ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <ShelfGlyph />
          <span className="tabular-nums text-ink">{s.shelves}</span>
          <span className="truncate text-ink-3">· {s.shelfTypes.map((t) => t.name).join('、')}</span>
        </span>
      ) : (
        <span className="text-ink-4">还没有站架</span>
      ),
    ),
    col('boards', '站牌', 'minmax(110px,0.8fr)', (s) =>
      s.boards ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="tabular-nums text-ink">{s.boards}</span>
          <span className="truncate font-mono text-[11.5px] text-ink-3">{s.boardSizes.join('、')}</span>
        </span>
      ) : (
        <span className="text-ink-4">—</span>
      ),
    ),
    col('waiting', '待编排', '84px', (s) =>
      s.waiting ? <StatusChip status="待编排" count={s.waiting} size="sm" /> : <span className="text-ink-4">0</span>,
    ),
    col('invalid', '失效', '72px', (s) =>
      s.invalid ? <StatusChip status="失效" count={s.invalid} size="sm" /> : <span className="text-ink-4">0</span>,
    ),
    col('updatedAt', '最近修改', '104px', (s) => (
      <span className="tabular-nums text-ink-3">{fmtDateTime(s.updatedAt).slice(2)}</span>
    )),
  ]
}

const DEFAULT_COLUMNS = ['name', 'lines', 'region', 'shelves', 'boards', 'waiting', 'invalid', 'updatedAt']

export function SignSetListPage() {
  const { f, sort, set, clear, active } = useFilters()
  const { page, size, setPage, setSize } = usePageParams()
  const nav = useNavigate()
  const [q, setQ] = useState(f.q)
  useEffect(() => setQ((cur) => (cur.trim() === f.q ? cur : f.q)), [f.q])
  const [preview, setPreview] = useState<string | null>(null)
  const list = useSignSetList({ ...f, sort, page, size })
  const shelfTypes = useDict('shelfType').data ?? []
  const sizes = useBoardSizes().data ?? []
  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const typeIds = f.shelfTypeIds ? f.shelfTypeIds.split(',') : []
  const more = [f.streetId, f.roadId, f.boardSize].filter(Boolean).length

  const columns = useMemo(() => signSetColumns((s) => setPreview(s.stop.id)), [])
  const prefs = useColumnPrefs(
    'gt-sign-sets-columns',
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
  const grid = visibleCols.map((c) => (c.columnDef.meta as ColMeta).width).join(' ') + ' 84px'
  const exportUrl = withQuery('/api/export/sign-sets', { ...f, sort })
  const chip = (on: boolean) =>
    cn(
      'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors',
      on
        ? 'bg-accent text-accent-ink ring-accent'
        : 'bg-surface text-ink-2 ring-hairline-2 hover:text-ink hover:ring-accent/40',
    )

  return (
    <div className="flex h-full flex-col">
      <div className="px-7 pb-3 pt-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-9">站牌集</h1>
            <p className="text-[13px] text-ink-3">
              {list.isSuccess ? `${total} 个站牌集${f.pending ? '待处理' : ''}` : '正在读取…'} ·
              每个站点一个，随站点创建
            </p>
          </div>
          <Button onClick={() => window.location.assign(exportUrl)}>
            <Download size={14} /> 导出当前结果
          </Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="relative w-[380px]">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input
              aria-label="搜索站牌集"
              placeholder="搜索站名、英文名、路段"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                set({ q: e.target.value.trim() || null })
              }}
              className="h-10 rounded-xl pl-9 text-[14px]"
            />
          </div>
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-3">
            排序
            <NativeSelect
              aria-label="排序"
              value={sort}
              onChange={(e) => set({ sort: e.target.value === 'name' ? null : e.target.value })}
              className="h-8 w-auto"
            >
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={Boolean(f.pending)}
            onClick={() => set({ pending: f.pending ? null : '1' })}
            className={chip(Boolean(f.pending))}
          >
            {!f.pending && <BreathingDot className="mr-0.5" />}
            只看待处理
          </button>
          <span className="mx-0.5 h-4 w-px bg-hairline-2" />
          <LineFilter
            value={f.lineIds ? f.lineIds.split(',') : []}
            onChange={(ids) => set({ lineIds: ids.join(',') || null })}
            chip={chip}
          />
          {shelfTypes.map((t) => {
            const on = typeIds.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set({ shelfTypeIds: (on ? typeIds.filter((x) => x !== t.id) : [...typeIds, t.id]).join(',') || null })
                }
                className={chip(on)}
              >
                {t.name}
              </button>
            )
          })}
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
                  <span className="text-[12px] text-ink-3">街道</span>
                  <RegionPicker
                    ghost={false}
                    creatable={false}
                    level="street"
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
                  <span className="text-[12px] text-ink-3">站牌尺寸</span>
                  <NativeSelect
                    aria-label="筛选站牌尺寸"
                    value={f.boardSize}
                    onChange={(e) => set({ boardSize: e.target.value || null })}
                  >
                    <option value="">全部</option>
                    {sizes.map((s) => (
                      <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>
                        {s.width}×{s.height}（{s.count} 块）
                      </option>
                    ))}
                  </NativeSelect>
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
          <span className="ml-auto">
            <ColumnPicker columns={columns} prefs={prefs} />
          </span>
        </div>
      </div>

      <div
        role="row"
        className="grid gap-3 border-y border-hairline bg-surface-2 px-7 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3"
        style={{ gridTemplateColumns: grid }}
      >
        {visibleCols.map((c) => (
          <span key={c.id} role="columnheader" className="truncate">
            {(c.columnDef.meta as ColMeta).label}
          </span>
        ))}
        <span />
      </div>
      <ul className="min-h-0 flex-1 overflow-auto" aria-label="站牌集列表">
        {table.getRowModel().rows.map((row) => {
          const s = row.original
          return (
            <li
              key={s.id}
              className="group grid items-center gap-3 border-b border-hairline px-7 py-2.5 text-[13px] transition-colors hover:bg-surface-2"
              style={{ gridTemplateColumns: grid }}
              aria-label={stopLabel(s.stop)}
            >
              {row.getVisibleCells().map((cell) => (
                <div key={cell.id} className="flex min-w-0 items-center">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
              <Button
                size="sm"
                variant={s.waiting + s.invalid ? 'primary' : 'secondary'}
                aria-label={`编排 ${stopLabel(s.stop)}`}
                onClick={() => nav(`/sign-sets/${s.stop.id}`)}
              >
                <Signpost size={13} /> 编排
              </Button>
            </li>
          )
        })}
        {list.isSuccess && items.length === 0 && (
          <li className="flex flex-col items-center px-8 py-14 text-center">
            <EmptySearchArt />
            <div className="mt-3 font-display text-[16px] font-semibold">
              {f.pending && active === 1 ? '所有站牌集都已编排妥当' : '没有符合条件的站牌集'}
            </div>
            {active > 0 && (
              <Button size="sm" className="mt-3" onClick={clear}>
                清空筛选
              </Button>
            )}
          </li>
        )}
      </ul>
      <Pagination page={page} size={size} total={total} onPage={setPage} onSize={setSize} unit="个" />
      <SignSetPreview stopId={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  )
}
