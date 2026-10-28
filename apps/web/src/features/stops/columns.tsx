// 站点宽表的列（5.3.2）
import { formatExtValue, type ExtFieldDef, type StopListItem } from '@gentransit/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { column, dim } from '@/components/gt/columns'
import { DirBadge } from '@/components/gt/symbols'
import { fmtDateTime } from '@/lib/utils'
import { Plates, regionText } from './shared'

export function stopColumns(ext: ExtFieldDef[]): ColumnDef<StopListItem>[] {
  const col = column<StopListItem>
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

/** 站点宽表默认显示的列 */
export const STOP_DEFAULT_COLUMNS = ['name', 'region', 'road', 'lines', 'updatedAt']
