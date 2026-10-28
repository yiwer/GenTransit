// 宽表的列：可选择显示列与调整列顺序，选择结果在本浏览器记住（F-COM-03）
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, IconButton } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/switch'
import { useStored } from '@/lib/utils'

export interface ColMeta {
  label: string
  /** CSS grid 轨道宽度 */
  width: string
}

/** 定义一列：表头文字、宽度与单元格渲染 */
export const column = <T,>(id: string, label: string, width: string, cell: (row: T) => ReactNode): ColumnDef<T> => ({
  id,
  header: label,
  meta: { label, width } satisfies ColMeta,
  cell: ({ row }) => cell(row.original),
})

export const dim = (v: string) => (v ? <span className="truncate">{v}</span> : <span className="text-ink-4">—</span>)

export interface ColumnPrefs {
  order: string[]
  visible: string[]
}

/**
 * 列偏好：顺序与可见列，记在本浏览器；新出现的列（如新建的扩展字段）默认隐藏、排在最后。
 * 第一列（fixed）始终显示
 */
export function useColumnPrefs(storageKey: string, all: string[], defaults: string[], fixed = 'name') {
  const [prefs, setPrefs] = useStored<ColumnPrefs>(storageKey, { order: [], visible: defaults })
  const order = [...prefs.order.filter((id) => all.includes(id)), ...all.filter((id) => !prefs.order.includes(id))]
  const visible = new Set(prefs.visible.filter((id) => all.includes(id)))
  visible.add(fixed)
  return {
    order,
    visible,
    fixed,
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
    reset: () => setPrefs({ order: [], visible: defaults }),
  }
}

export function ColumnPicker<T>({
  columns,
  prefs,
}: {
  columns: ColumnDef<T>[]
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
                disabled={id === prefs.fixed}
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
