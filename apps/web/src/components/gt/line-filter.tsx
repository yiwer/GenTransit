// "经过线路"筛选（站点列表、站牌集列表共用）：线路牌多选，取并集。
// 候选用轻量的线路选项接口，打开弹出层才加载，输入时防抖查询；已选线路的名称按 ID 单独取，
// 不受候选范围限制，线路多时选中靠后的线路也能显示名称（M6）
import type { LineOptions } from '@gentransit/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RoutePlate } from '@/components/gt/symbols'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'

/** 弹出层里最多列出这么多条候选，其余靠输入线路名缩小范围 */
const PICKER_SIZE = 100

export function LineFilter({
  value,
  onChange,
  chip,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  chip: (on: boolean) => string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  const options = useQuery({
    queryKey: ['lines', 'options', { q: term }],
    queryFn: () => get<LineOptions>('/api/lines/options', { q: term, size: PICKER_SIZE }),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const ids = [...value].sort().join(',')
  const chosen = useQuery({
    queryKey: ['lines', 'options', { ids }],
    queryFn: () => get<LineOptions>('/api/lines/options', { ids }),
    enabled: value.length > 0,
    placeholderData: keepPreviousData,
  })
  const names = (chosen.data?.items ?? []).filter((l) => value.includes(l.id))
  const items = options.data?.items ?? []
  const more = (options.data?.total ?? 0) - items.length
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
          placeholder="搜索线路名、管理编号"
          className="mb-1.5 h-8 w-full rounded-lg bg-sunken px-2.5 text-[13.5px] focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <ul className="flex max-h-[280px] flex-wrap gap-1.5 overflow-auto p-1">
          {items.map((l) => {
            const on = value.includes(l.id)
            return (
              <li key={l.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  title={l.name}
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
          {options.isSuccess && !items.length && (
            <li className="w-full py-3 text-center text-[12.5px] text-ink-3">没有线路</li>
          )}
          {more > 0 && (
            <li className="w-full px-0.5 pt-1 text-[12px] text-ink-3">还有 {more} 条，输入线路名缩小范围</li>
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
