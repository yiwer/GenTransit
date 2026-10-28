// 站点宽表的列（5.3.2）：可选择显示列与调整列顺序，选择结果在本浏览器记住（F-COM-03）
import { formatExtValue, type ExtFieldDef, type StopListItem } from '@gentransit/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'
import { DirBadge } from '@/components/gt/symbols'
import { Button, IconButton } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/switch'
import { fmtDateTime, useStored } from '@/lib/utils'
import { Plates, regionText } from './shared'

export interface ColMeta {
  label: string
  width: string
}

export function stopColumns(ext: ExtFieldDef[]): ColumnDef<StopListItem>[] {
  const col = (
    id: string,
    label: string,
    width: string,
    cell: (s: StopListItem) => React.ReactNode,
  ): ColumnDef<StopListItem> => ({
    id,
    header: label,
    meta: { label, width } satisfies ColMeta,
    cell: ({ row }) => cell(row.original),
  })
  const dim = (v: string) => (v ? <span className="truncate">{v}</span> : <span className="text-ink-4">—</span>)
  return [
    col('name', '站名', 'minmax(180px,1.4fr)', (s) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-display text-[15.5px] font-semibold">{s.name}</span>
        <DirBadge dir={s.direction} size="sm" />
      </span>
    )),
    col('direction', '方位', '64px', (s) => s.direction),
    col('nameEn', '英文名', 'minmax(140px,1fr)', (s) => (
      <span className="truncate italic text-ink-2">{s.nameEn || '—'}</span>
    )),
    col('lines', '经过线路', 'minmax(180px,1.5fr)', (s) => <Plates lines={s.lines} max={6} />),
    col('lineCount', '线路数', '64px', (s) => <span className="tabular-nums">{s.lines.length}</span>),
    col('coord', '经纬度', '190px', (s) => (
      <span className="font-mono text-[12px] text-ink-2">
        {s.lng.toFixed(6)}, {s.lat.toFixed(6)}
      </span>
    )),
    col('region', '市区街道', 'minmax(150px,1fr)', (s) => dim(regionText(s))),
    col('road', '路段', 'minmax(100px,0.8fr)', (s) => dim(s.road?.name ?? '')),
    col('landmarks', '地标', 'minmax(120px,1fr)', (s) => dim(s.landmarks.map((l) => l.name).join('、'))),
    col('maintainer', '维护公司', 'minmax(120px,1fr)', (s) => dim(s.maintainer?.name ?? '')),
    col('remark', '备注', 'minmax(140px,1fr)', (s) => dim(s.remark)),
    col('updatedAt', '最近修改', '132px', (s) => (
      <span className="tabular-nums text-ink-3">{fmtDateTime(s.updatedAt).slice(2)}</span>
    )),
    ...ext.map((f) => col(`ext:${f.key}`, f.name, 'minmax(110px,0.8fr)', (s) => dim(formatExtValue(s.ext[f.key])))),
  ]
}

const DEFAULT_VISIBLE = ['name', 'region', 'road', 'lines', 'updatedAt']

export interface ColumnPrefs {
  order: string[]
  visible: string[]
}

/** 列偏好：顺序与可见列，记在本浏览器；新出现的列（如新建的扩展字段）默认隐藏、排在最后 */
export function useColumnPrefs(all: string[]) {
  const [prefs, setPrefs] = useStored<ColumnPrefs>('gt-stops-columns', { order: [], visible: DEFAULT_VISIBLE })
  const order = [...prefs.order.filter((id) => all.includes(id)), ...all.filter((id) => !prefs.order.includes(id))]
  const visible = new Set(prefs.visible.filter((id) => all.includes(id)))
  visible.add('name')
  return {
    order,
    visible,
    toggle: (id: string, on: boolean) =>
      setPrefs({ order, visible: on ? [...visible, id] : [...visible].filter((x) => x !== id) }),
    move: (id: string, d: -1 | 1) => {
      const i = order.indexOf(id)
      const j = i + d
      if (j < 0 || j >= order.length) return
      const next = [...order]
      ;[next[i], next[j]] = [next[j], next[i]]
      setPrefs({ order: next, visible: [...visible] })
    },
    reset: () => setPrefs({ order: [], visible: DEFAULT_VISIBLE }),
  }
}

export function ColumnPicker({
  columns,
  prefs,
}: {
  columns: ColumnDef<StopListItem>[]
  prefs: ReturnType<typeof useColumnPrefs>
}) {
  const label = (id: string) => (columns.find((c) => c.id === id)?.meta as ColMeta | undefined)?.label ?? id
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Columns3 size={14} /> 显示列
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[12px] font-medium text-ink-3">勾选显示，箭头调整顺序</span>
          <button type="button" className="text-[12px] text-accent hover:underline" onClick={prefs.reset}>
            恢复默认
          </button>
        </div>
        <ul className="max-h-[360px] overflow-auto">
          {prefs.order.map((id, i) => (
            <li key={id} className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-sunken">
              <Checkbox
                label={label(id)}
                checked={prefs.visible.has(id)}
                disabled={id === 'name'}
                onCheckedChange={(v) => prefs.toggle(id, v === true)}
                className="min-w-0 flex-1 py-1"
              />
              <IconButton
                label={`上移 ${label(id)}`}
                className="size-6"
                disabled={i === 0}
                onClick={() => prefs.move(id, -1)}
              >
                <ArrowUp size={12} />
              </IconButton>
              <IconButton
                label={`下移 ${label(id)}`}
                className="size-6"
                disabled={i === prefs.order.length - 1}
                onClick={() => prefs.move(id, 1)}
              >
                <ArrowDown size={12} />
              </IconButton>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
