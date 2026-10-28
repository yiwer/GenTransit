// 站序表：拖拽把手排序（dnd-kit），键盘 Alt+↑/↓ 移动；行内删除；第 2 次起标出第几次途经；路径站扩展字段行内编辑
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { passIndices, type ExtFieldDef } from '@gentransit/shared'
import { GripVertical, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { DirBadge, Tag } from '@/components/gt/symbols'
import { IconButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { StopRow } from './draft'

export function moveRow(rows: StopRow[], index: number, delta: -1 | 1): StopRow[] {
  const to = index + delta
  if (to < 0 || to >= rows.length) return rows
  return arrayMove(rows, index, to)
}

function ExtCell({ def, value, onChange }: { def: ExtFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const cls =
    'h-7 w-full rounded-md bg-transparent px-1.5 text-[12.5px] text-ink ring-1 ring-transparent hover:bg-sunken focus:bg-surface focus:outline-none focus:ring-accent'
  if (def.type === 'select')
    return (
      <select
        aria-label={def.name}
        className={cls}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    )
  const text = Array.isArray(value) ? value.join('、') : value == null ? '' : String(value)
  return (
    <input
      aria-label={def.name}
      className={cls}
      type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'time' ? 'time' : 'text'}
      value={text}
      placeholder="—"
      onChange={(e) => {
        const v = e.target.value
        if (!v) return onChange(null)
        if (def.type === 'number') return onChange(Number(v))
        if (def.type === 'textList') return onChange(v.split(/[、,，]/).map((x) => x.trim()))
        onChange(v)
      }}
    />
  )
}

function Row({
  row,
  index,
  pass,
  selected,
  onSelect,
  onRemove,
  onMove,
  onExt,
  extDefs,
  grid,
}: {
  row: StopRow
  index: number
  pass: number
  selected: boolean
  onSelect: () => void
  onRemove: () => void
  onMove: (d: -1 | 1) => void
  onExt: (key: string, v: unknown) => void
  extDefs: ExtFieldDef[]
  grid: string
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.key,
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      onMove(e.key === 'ArrowUp' ? -1 : 1)
    }
  }
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, gridTemplateColumns: grid }}
      tabIndex={0}
      aria-label={`第 ${index + 1} 站 ${row.stop.name}（${row.stop.direction}）`}
      aria-selected={selected}
      data-testid="stop-row"
      onClick={onSelect}
      onKeyDown={onKey}
      className={cn(
        'grid items-center gap-2 border-b border-hairline px-2 py-1 text-[13px] outline-none last:border-0 focus-visible:bg-accent-soft/40',
        selected && 'bg-accent-soft/60',
        isDragging && 'relative z-10 bg-surface shadow-pop',
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`拖动排序 ${row.stop.name}`}
        className="flex size-6 cursor-grab items-center justify-center rounded text-ink-4 hover:bg-sunken hover:text-ink active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <span className="text-right text-[12px] tabular-nums text-ink-3">{index + 1}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-display text-[14px] font-semibold">{row.stop.name}</span>
        <DirBadge dir={row.stop.direction} size="sm" />
        {pass > 1 && <Tag className="h-4 shrink-0 px-1.5 text-[10.5px]">第 {pass} 次</Tag>}
      </span>
      <span className="truncate text-[12px] tabular-nums text-ink-3" title={row.times.join('、')}>
        {row.times.length
          ? `${row.times[0]}${row.times.length > 1 ? ` … ${row.times.at(-1)}` : ''} · ${row.times.length} 班`
          : '—'}
      </span>
      {extDefs.map((d) => (
        <ExtCell key={d.key} def={d} value={row.ext[d.key]} onChange={(v) => onExt(d.key, v)} />
      ))}
      <IconButton
        label={`删除第 ${index + 1} 站 ${row.stop.name}`}
        className="size-7"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
      >
        <X size={14} />
      </IconButton>
    </li>
  )
}

export function StopTable({
  rows,
  onChange,
  selected,
  onSelect,
  extDefs = [],
}: {
  rows: StopRow[]
  onChange: (rows: StopRow[]) => void
  selected: string | null
  onSelect: (key: string | null) => void
  extDefs?: ExtFieldDef[]
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const pass = passIndices(rows.map((r) => r.stop.id))
  const grid = [
    '28px',
    '28px',
    'minmax(140px,1.6fr)',
    'minmax(110px,1fr)',
    ...extDefs.map(() => 'minmax(90px,0.8fr)'),
    '32px',
  ].join(' ')
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = rows.findIndex((r) => r.key === e.active.id)
    const to = rows.findIndex((r) => r.key === e.over!.id)
    onChange(arrayMove(rows, from, to))
  }
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-hairline">
      <div
        className="grid gap-2 border-b border-hairline bg-surface-2 px-2 py-1.5 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3"
        style={{ gridTemplateColumns: grid }}
      >
        <span />
        <span className="text-right">序</span>
        <span>站点</span>
        <span>到站时刻</span>
        {extDefs.map((d) => (
          <span key={d.key} className="truncate">
            {d.name}
          </span>
        ))}
        <span />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <ol aria-label="站序" className="max-h-[420px] overflow-auto">
            {rows.map((r, i) => (
              <Row
                key={r.key}
                row={r}
                index={i}
                pass={pass[i]}
                grid={grid}
                extDefs={extDefs}
                selected={selected === r.key}
                onSelect={() => onSelect(selected === r.key ? null : r.key)}
                onRemove={() => onChange(rows.filter((x) => x.key !== r.key))}
                onMove={(d) => onChange(moveRow(rows, i, d))}
                onExt={(k, v) => onChange(rows.map((x) => (x.key === r.key ? { ...x, ext: { ...x.ext, [k]: v } } : x)))}
              />
            ))}
            {rows.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-ink-3">
                还没有站点。用上面的搜索框添加，或粘贴两列文本。
              </li>
            )}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  )
}
