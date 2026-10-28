// 引用选择器：字典项与行政区划。可搜索；没有匹配项时可以直接新增（F-COM-07）
import {
  DICT_CATEGORY_LABEL,
  REGION_LEVEL_LABEL,
  type DictCategory,
  type DictItem,
  type Ref,
  type Region,
  type RegionLevel,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Plus, X } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CARET } from '@/components/ui/input'
import { keys, useDict, useRegions } from '@/features/common/data'
import { isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { usePropId } from './prop'
import { useToast } from './toast'

interface PickerProps {
  value: string | null
  onChange: (id: string | null, item?: Ref) => void
  placeholder?: string
  disabled?: boolean
  /** 属性表里的幽灵样式；否则为普通输入框样式 */
  ghost?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  /** 是否允许直接新增（筛选条件里不允许） */
  creatable?: boolean
}

function RefPicker({
  items,
  value,
  onChange,
  placeholder = '未填写',
  disabled,
  ghost = true,
  className,
  id,
  createLabel,
  onCreate,
  'aria-label': ariaLabel,
}: PickerProps & {
  items: Ref[]
  createLabel?: string
  onCreate?: (name: string) => Promise<Ref | null>
}) {
  const pid = usePropId(id)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const current = items.find((i) => i.id === value)
  const term = q.trim()
  const list = useMemo(() => (term ? items.filter((i) => i.name.includes(term)) : items), [items, term])
  const canCreate = Boolean(onCreate && term && !items.some((i) => i.name === term))
  const options = [
    ...list.map((i) => ({ kind: 'item' as const, item: i })),
    ...(canCreate ? [{ kind: 'create' as const }] : []),
  ]

  const choose = (item: Ref | null) => {
    onChange(item?.id ?? null, item ?? undefined)
    setOpen(false)
    setQ('')
  }
  const create = async () => {
    if (!onCreate) return
    setBusy(true)
    try {
      const r = await onCreate(term)
      if (r) choose(r)
    } finally {
      setBusy(false)
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = options[idx]
      if (o?.kind === 'item') choose(o.item)
      else if (o?.kind === 'create') void create()
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQ('')
        setIdx(0)
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          id={pid}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          className={cn(
            'flex h-8 items-center rounded-lg bg-[length:15px] bg-[position:right_8px_center] bg-no-repeat pr-7 text-left text-[14px] ring-1 ring-transparent transition-[background,box-shadow] focus:outline-none focus-visible:ring-accent disabled:opacity-50',
            ghost
              ? '-mx-2 w-[calc(100%+16px)] bg-transparent px-2 hover:bg-sunken'
              : 'w-full bg-sunken px-2.5 text-[13.5px] hover:ring-hairline-2',
            open && 'bg-surface ring-accent',
            className,
          )}
          style={{ backgroundImage: CARET }}
        >
          <span className={cn('truncate', !current && 'text-ink-4')}>{current?.name ?? placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-1.5">
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setIdx(0)
          }}
          onKeyDown={onKey}
          placeholder={onCreate ? '搜索或输入新名称' : '搜索'}
          aria-label="搜索选项"
          className="mb-1 h-8 w-full rounded-lg bg-sunken px-2.5 text-[13.5px] text-ink placeholder:text-ink-4 focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <ul role="listbox" className="max-h-[260px] overflow-auto">
          {value && !term && (
            <li>
              <button
                type="button"
                onClick={() => choose(null)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-3 hover:bg-sunken"
              >
                <X size={13} /> 清除
              </button>
            </li>
          )}
          {options.map((o, i) =>
            o.kind === 'item' ? (
              <li key={o.item.id} role="option" aria-selected={o.item.id === value}>
                <button
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => choose(o.item)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]',
                    i === idx ? 'bg-sunken' : '',
                  )}
                >
                  {o.item.name}
                  {o.item.id === value && <Check size={14} className="text-accent" />}
                </button>
              </li>
            ) : (
              <li key="create">
                <button
                  type="button"
                  disabled={busy}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => void create()}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] text-accent',
                    i === idx ? 'bg-accent-soft' : '',
                  )}
                >
                  <Plus size={14} /> 新增{createLabel}「{term}」
                </button>
              </li>
            ),
          )}
          {options.length === 0 && <li className="px-2 py-3 text-center text-[12.5px] text-ink-3">没有选项</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** 字典字段：可直接新增字典项 */
export function DictPicker({ category, creatable = true, ...p }: PickerProps & { category: DictCategory }) {
  const dict = useDict(category)
  const qc = useQueryClient()
  const toast = useToast()
  return (
    <RefPicker
      {...p}
      items={dict.data ?? []}
      createLabel={DICT_CATEGORY_LABEL[category]}
      onCreate={
        !creatable
          ? undefined
          : async (name) => {
              try {
                const item = await post<DictItem>('/api/dicts', { category, name })
                await qc.invalidateQueries({ queryKey: keys.dicts })
                toast(`已新增${DICT_CATEGORY_LABEL[category]}「${name}」`)
                return item
              } catch (e) {
                toast(isApiError(e) ? e.message : '新增失败', 'error')
                return null
              }
            }
      }
    />
  )
}

/** 行政区划字段：按上级过滤（parentId 为 undefined 时不过滤）；可直接新增 */
export function RegionPicker({
  level,
  parentId,
  creatable = true,
  ...p
}: PickerProps & { level: RegionLevel; parentId?: string | null }) {
  const regions = useRegions()
  const qc = useQueryClient()
  const toast = useToast()
  const items = (regions.data ?? []).filter(
    (r) => r.level === level && (level === 'city' || parentId === undefined || r.parentId === parentId),
  )
  const canCreate = creatable && (level === 'city' || Boolean(parentId))
  return (
    <RefPicker
      {...p}
      items={items}
      createLabel={REGION_LEVEL_LABEL[level]}
      onCreate={
        canCreate
          ? async (name) => {
              try {
                const r = await post<Region>('/api/regions', {
                  level,
                  parentId: level === 'city' ? null : parentId,
                  name,
                })
                await qc.invalidateQueries({ queryKey: keys.regions })
                toast(`已新增${REGION_LEVEL_LABEL[level]}「${name}」`)
                return r
              } catch (e) {
                toast(isApiError(e) ? e.message : '新增失败', 'error')
                return null
              }
            }
          : undefined
      }
    />
  )
}
