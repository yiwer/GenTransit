// 站架类型下拉（M7 计划 5.2 节）：每项带小剪影，按结构形式分组；站牌的面选项按站架类型限定
import {
  SHELF_FORMS,
  SHELF_FORM_LABEL,
  parseShelfSpec,
  shelfFaceLabel,
  shelfFaces,
  type BoardFace,
  type ShelfSpec,
  type ShelfTypeItem,
} from '@gentransit/shared'
import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { GhostSelect } from '@/components/gt/prop'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ShelfSilhouette, specOfType } from './shelf-art'

export function ShelfTypeSelect({
  value,
  types,
  onChange,
  fallbackName,
  label = '站架类型',
}: {
  value: string
  types: ShelfTypeItem[]
  onChange: (t: ShelfTypeItem) => void
  /** 当前值不在列表里时显示的名称 */
  fallbackName?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const cur = types.find((t) => t.id === value)
  const groups = SHELF_FORMS.map((f) => ({ form: f, items: types.filter((t) => t.form === f) })).filter(
    (g) => g.items.length,
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13.5px] ring-1 ring-transparent transition-colors hover:bg-surface-2 hover:ring-hairline-2 focus-visible:outline-2 focus-visible:outline-accent data-[state=open]:bg-surface-2 data-[state=open]:ring-hairline-2"
        >
          <ShelfSilhouette spec={specOfType(types, value)} className="h-6 w-7 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{cur?.name ?? fallbackName ?? '请选择'}</span>
          {cur && <span className="shrink-0 text-[11.5px] text-ink-3">{SHELF_FORM_LABEL[cur.form]}</span>}
          <ChevronDown size={13} className="shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[360px] w-[300px] overflow-auto p-1.5" role="listbox" aria-label={label}>
        {groups.map((g) => (
          <div key={g.form} className="mb-1 last:mb-0">
            <div className="eyebrow px-2 pb-0.5 pt-1.5">{SHELF_FORM_LABEL[g.form]}</div>
            {g.items.map((t) => {
              const on = t.id === value
              return (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    setOpen(false)
                    if (!on) onChange(t)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
                    on ? 'bg-accent-soft text-ink' : 'hover:bg-surface-2',
                  )}
                >
                  <ShelfSilhouette spec={parseShelfSpec(t.form, t.params)} className="h-8 w-9 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.needsReview && <span className="shrink-0 text-[10.5px] text-signal-ink">待核对</span>}
                  {on && <Check size={13} className="shrink-0 text-accent" />}
                </button>
              )
            })}
          </div>
        ))}
        {!groups.length && <div className="px-2 py-3 text-[12.5px] text-ink-3">还没有站架类型</div>}
      </PopoverContent>
    </Popover>
  )
}

/** 面的选项：只列出站架类型具有的面；当前值不在其中时也列出并标"不属于此类型" */
export function FaceSelect({
  spec,
  value,
  onChange,
  label = '面',
  className,
}: {
  spec: ShelfSpec
  value: BoardFace
  onChange: (f: BoardFace) => void
  label?: string
  className?: string
}) {
  const own = shelfFaces(spec)
  const stray = !own.includes(value)
  return (
    <GhostSelect
      aria-label={label}
      value={value}
      className={cn(stray && 'text-danger', className)}
      onChange={(e) => onChange(e.target.value as BoardFace)}
    >
      {own.map((f) => (
        <option key={f} value={f}>
          {shelfFaceLabel(spec.form, f)}
        </option>
      ))}
      {stray && <option value={value}>{shelfFaceLabel(spec.form, value)}（不属于此类型）</option>}
    </GhostSelect>
  )
}
