// 属性表：阅读与编辑共用一个版面。标签在左、取值在右；输入框平时像文字，悬停或聚焦才显出边框
import { AlertTriangle } from 'lucide-react'
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import { CARET } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const PropId = createContext<string | undefined>(undefined)

export function Prop({
  label,
  children,
  hint,
  required,
  align = 'center',
  className,
}: {
  label: ReactNode
  children: ReactNode
  hint?: ReactNode
  required?: boolean
  align?: 'center' | 'start'
  className?: string
}) {
  const id = useId()
  return (
    <div
      className={cn(
        'grid grid-cols-[112px_1fr] gap-3 border-b border-hairline py-2 last:border-0',
        align === 'center' ? 'items-center' : 'items-start',
        className,
      )}
    >
      <label htmlFor={id} className={cn('text-[13px] text-ink-3', align === 'start' && 'pt-1.5')}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      <div className="min-w-0">
        <PropId.Provider value={id}>{children}</PropId.Provider>
        {hint && <div className="mt-1 text-[12px] text-ink-4">{hint}</div>}
      </div>
    </div>
  )
}

/** 属性行里的第一个控件自动与标签关联 */
export const usePropId = (own?: string) => {
  const ctx = useContext(PropId)
  return own ?? ctx
}

const ghost =
  'h-8 rounded-lg bg-transparent px-2 text-[14px] text-ink ring-1 ring-transparent placeholder:text-ink-4 transition-[background,box-shadow] hover:bg-sunken focus:bg-surface focus:outline-none focus:ring-accent disabled:opacity-50 aria-invalid:ring-danger/50'
// 默认向两侧伸出 8px，让文字与标签列对齐；调用方给了宽度就按调用方的
const bleed = (className?: string) => !/(^|\s)w-/.test(className ?? '') && '-mx-2 w-[calc(100%+16px)]'

export function GhostInput({ className, id, ...p }: ComponentProps<'input'>) {
  const pid = usePropId(id)
  return <input id={pid} {...p} className={cn(ghost, bleed(className), className)} />
}

export function GhostSelect({ className, children, id, style, ...p }: ComponentProps<'select'>) {
  const pid = usePropId(id)
  return (
    <select
      id={pid}
      {...p}
      className={cn(
        ghost,
        'appearance-none bg-[length:15px] bg-[position:right_8px_center] bg-no-repeat pr-7',
        bleed(className),
        className,
      )}
      style={{ backgroundImage: CARET, ...style }}
    >
      {children}
    </select>
  )
}

export function GhostTextarea({ className, id, ...p }: ComponentProps<'textarea'>) {
  const pid = usePropId(id)
  return (
    <textarea
      id={pid}
      {...p}
      className={cn(ghost, 'h-auto min-h-[64px] py-1.5 leading-relaxed', bleed(className), className)}
    />
  )
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" className="mt-1 flex items-center gap-1 text-[12px] text-danger">
      <AlertTriangle size={12} /> {children}
    </div>
  )
}

/** 只读取值：空值显示为 — */
export function Val({ children, mono }: { children: ReactNode; mono?: boolean }) {
  const empty = children === null || children === undefined || children === ''
  return <span className={cn(mono && 'font-mono text-[12.5px]', empty && 'text-ink-4')}>{empty ? '—' : children}</span>
}
