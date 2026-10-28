// PROTOTYPE — 「导向」设计语言的基础组件。正式项目用 shadcn/ui 按同一套令牌重建
import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import type { ScheduleStatus } from '../lib/domain'
import { SealCheck } from './lively'

export const cn = clsx

/* ---------- 按钮 ---------- */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'signal'
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' }>(
  function Button({ variant = 'secondary', size = 'md', className, ...p }, ref) {
    return (
      <button
        ref={ref}
        {...p}
        className={cn(
          'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background,box-shadow,color] duration-150 disabled:pointer-events-none disabled:opacity-40',
          size === 'md' && 'h-8 px-3 text-[13.5px]',
          size === 'sm' && 'h-7 px-2.5 text-[12.5px]',
          size === 'lg' && 'h-10 px-4 text-[14.5px]',
          variant === 'primary' && 'bg-accent text-accent-ink shadow-xs hover:bg-accent-hover',
          variant === 'secondary' && 'bg-surface text-ink shadow-xs ring-1 ring-hairline-2 hover:bg-surface-2 hover:ring-accent/35',
          variant === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
          variant === 'subtle' && 'bg-sunken text-ink hover:bg-hairline-2',
          variant === 'signal' && 'bg-signal text-ink shadow-xs hover:brightness-95',
          variant === 'danger' && 'bg-surface text-danger ring-1 ring-danger/30 hover:bg-danger-soft',
          className,
        )}
      />
    )
  },
)

export function IconButton({ label, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} {...p} className={cn('inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-35', className)}>
      {children}
    </button>
  )
}

/* ---------- 输入 ---------- */

const fieldBase =
  'h-8 rounded-lg bg-sunken px-2.5 text-[13.5px] text-ink ring-1 ring-transparent placeholder:text-ink-4 transition-[background,box-shadow] hover:ring-hairline-2 focus:bg-surface focus:outline-none focus:ring-accent disabled:opacity-50'
// 调用方给了宽度类就不再加 w-full
const field = (className?: string) => cn(fieldBase, !/(^|\s)w-/.test(className ?? '') && 'w-full', className)

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={field(className)} />
})

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={field(cn('h-auto min-h-[72px] py-2 leading-relaxed', className))} />
}

const CARET = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236d6b64' stroke-width='2'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")"
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...p} className={field(cn('appearance-none bg-[length:15px] bg-[right_7px_center] bg-no-repeat pr-7', className))} style={{ backgroundImage: CARET }}>
      {children}
    </select>
  )
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13.5px] text-ink">
      <span className={cn('flex size-4 items-center justify-center rounded-[5px] ring-1 transition-colors', checked ? 'bg-accent ring-accent' : 'bg-surface ring-hairline-2')}>
        {checked && <Check size={11} strokeWidth={3} className="text-accent-ink" />}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {label}
    </label>
  )
}

export function Field({ label, required, hint, error, children, className }: { label: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[12.5px] font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {error ? <span className="text-[12px] text-danger">{error}</span> : hint ? <span className="text-[12px] text-ink-4">{hint}</span> : null}
    </label>
  )
}

/** 属性行：阅读与编辑共用一个版面 */
export function Prop({ label, children, hint, required, align = 'center' }: { label: ReactNode; children: ReactNode; hint?: ReactNode; required?: boolean; align?: 'center' | 'start' }) {
  return (
    <div className={cn('grid grid-cols-[112px_1fr] gap-3 border-b border-hairline py-2 last:border-0', align === 'center' ? 'items-center' : 'items-start')}>
      <div className={cn('text-[13px] text-ink-3', align === 'start' && 'pt-1.5')}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </div>
      <div className="min-w-0">
        {children}
        {hint && <div className="mt-1 text-[12px] text-ink-4">{hint}</div>}
      </div>
    </div>
  )
}

/** 属性表里的输入：平时像文字，悬停/聚焦才显出输入框 */
export const GhostInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function GhostInput({ className, ...p }, ref) {
  return (
    <input
      ref={ref}
      {...p}
      className={cn(
        'h-8 rounded-lg bg-transparent px-2 text-[14px] text-ink ring-1 ring-transparent placeholder:text-ink-4 transition-[background,box-shadow] hover:bg-sunken focus:bg-surface focus:outline-none focus:ring-accent',
        // 默认向两侧伸出 8px，让文字与标签列对齐；调用方给了宽度就按调用方的
        !/(^|\s)w-/.test(className ?? '') && '-mx-2 w-[calc(100%+16px)]',
        className,
      )}
    />
  )
})

export function GhostSelect({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cn('h-8 appearance-none rounded-lg bg-transparent bg-[length:15px] bg-[right_8px_center] bg-no-repeat px-2 pr-7 text-[14px] text-ink ring-1 ring-transparent hover:bg-sunken focus:bg-surface focus:outline-none focus:ring-accent', !/(^|\s)w-/.test(className ?? '') && '-mx-2 w-[calc(100%+16px)]', className)}
      style={{ backgroundImage: CARET }}
    >
      {children}
    </select>
  )
}

/* ---------- 版面 ---------- */

export function SectionTitle({ children, count, extra, className }: { children: ReactNode; count?: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex h-7 items-center gap-2', className)}>
      <h3 className="text-[13px] font-semibold tracking-wide text-ink">{children}</h3>
      {count !== undefined && <span className="text-[12.5px] tabular-nums text-ink-3">{count}</span>}
      {extra && <div className="ml-auto flex items-center gap-1">{extra}</div>}
    </div>
  )
}

export function Card({ title, extra, children, className, id, pad = true }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; id?: string; pad?: boolean }) {
  return (
    <section id={id} className={cn('rounded-2xl bg-surface shadow-xs ring-1 ring-hairline', className)}>
      {title && (
        <header className="flex h-12 items-center justify-between px-5">
          <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
          {extra}
        </header>
      )}
      <div className={cn(pad && (title ? 'px-5 pb-5' : 'p-5'))}>{children}</div>
    </section>
  )
}

/* ---------- 识别符号 ---------- */

/** 线路牌：全站线路名的统一呈现 */
export function RoutePlate({ name, size = 'md', state = 'normal', className }: { name: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; state?: 'normal' | 'suspended' | 'invalid' | 'ghost'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-plate font-semibold leading-none tracking-[0.01em]',
        size === 'xs' && 'h-[18px] min-w-[26px] rounded-[3px] px-1 text-[11.5px]',
        size === 'sm' && 'h-5 min-w-[30px] rounded-[4px] px-1.5 text-[12.5px]',
        size === 'md' && 'h-6 min-w-[36px] rounded-[5px] px-1.5 text-[14.5px]',
        size === 'lg' && 'h-9 min-w-[52px] rounded-[7px] px-2.5 text-[21px]',
        size === 'xl' && 'h-14 min-w-[76px] rounded-[10px] px-3.5 text-[34px] font-bold',
        state === 'normal' && 'bg-plate text-plate-ink',
        state === 'suspended' && 'text-ink-3 line-through decoration-1 ring-1 ring-inset ring-ink-4 [ring-style:dashed]',
        state === 'invalid' && 'bg-danger-soft text-danger line-through decoration-1 ring-1 ring-inset ring-danger/40',
        state === 'ghost' && 'text-ink ring-1 ring-inset ring-hairline-2',
        className,
      )}
    >
      {name}
    </span>
  )
}

/** 方位章：像站牌上的方向标 */
export function DirBadge({ dir, size = 'md' }: { dir: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-ink ring-[1.5px] ring-inset ring-ink/80',
        size === 'sm' && 'h-[18px] min-w-[18px] px-0.5 text-[11px]',
        size === 'md' && 'h-[22px] min-w-[22px] px-1 text-[12.5px]',
        size === 'lg' && 'h-8 min-w-8 px-1.5 text-[16px]',
      )}
    >
      {dir}
    </span>
  )
}

const ST: Record<ScheduleStatus, string> = {
  待编排: 'bg-signal-soft text-signal-ink ring-1 ring-inset ring-signal/60',
  已编排: 'bg-sage-soft text-sage ring-1 ring-inset ring-sage/35',
  隐藏: 'text-ink-3 border border-dashed border-ink-4',
  失效: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/35',
}
const ST_DOT: Record<ScheduleStatus, string> = { 待编排: 'bg-signal gt-breathe', 已编排: 'bg-sage', 隐藏: 'border border-ink-3 bg-transparent', 失效: 'bg-danger' }

export const statusClass = (s: ScheduleStatus) => ST[s]
export const statusDot = (s: ScheduleStatus) => ST_DOT[s]

export function StatusChip({ status, count, size = 'md' }: { status: ScheduleStatus; count?: number; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full font-medium', size === 'md' ? 'h-6 px-2.5 text-[12.5px]' : 'h-5 px-2 text-[11.5px]', ST[status])}>
      <span className={cn('size-1.5 rounded-full', ST_DOT[status])} />
      {status}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  )
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full bg-sunken px-2 text-[11.5px] font-medium text-ink-2', className)}>{children}</span>
}

export function LineName({ name, className }: { name: string; className?: string }) {
  return <RoutePlate name={name} size="sm" className={className} />
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg bg-sunken p-0.5', size === 'md' ? 'h-8' : 'h-7')}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-xs' : 'text-ink-3 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 浮层 ---------- */

export function useClickAway<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open, onClose])
  return ref
}

export function Popover({ trigger, children, align = 'left', width = 220 }: { trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useClickAway<HTMLDivElement>(open, close)
  return (
    <div ref={ref} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={cn('absolute top-full z-40 mt-1.5 rounded-xl bg-surface p-1 shadow-pop ring-1 ring-hairline', align === 'right' ? 'right-0' : 'left-0')} style={{ width }}>
          {children(close)}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ children, onClick, danger, disabled, hint }: { children: ReactNode; onClick?: () => void; danger?: boolean; disabled?: boolean; hint?: ReactNode }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] disabled:opacity-40', danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-sunken')}
    >
      <span className="flex items-center gap-2">{children}</span>
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </button>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-2 text-[11.5px] font-medium text-ink-3">{children}</div>
}

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open, onClose])
}

export function Drawer({ open, onClose, title, children, footer, width = 440 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEsc(open, onClose)
  if (!open) return null
  // 挂到 body：避免被带 backdrop-filter / transform 的祖先困住
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end p-2">
      <div className="absolute inset-0 bg-ink/15 backdrop-blur-[2px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline" style={{ width }}>
        <header className="flex h-14 shrink-0 items-center justify-between px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="flex-1 overflow-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  )
}

export function Dialog({ open, onClose, title, children, footer, width = 460 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEsc(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-ink/20 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative max-h-full overflow-auto rounded-2xl bg-surface shadow-pop ring-1 ring-hairline" style={{ width }}>
        <header className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <h2 className="text-[16px] font-semibold leading-6">{title}</h2>
          <IconButton label="关闭" className="-mr-2 -mt-1" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="px-6 pb-5 text-[13.5px] leading-relaxed text-ink-2">{children}</div>
        {footer && <footer className="flex justify-end gap-2 bg-surface-2 px-6 py-3.5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}

type Toast = { id: number; text: ReactNode; tone: 'ok' | 'info' | 'warn' }
const ToastCtx = createContext<(text: ReactNode, tone?: Toast['tone']) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback((text: ReactNode, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random()
    setList((xs) => [...xs, { id, text, tone }])
    setTimeout(() => setList((xs) => xs.filter((t) => t.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-16 right-5 z-[60] flex flex-col items-end gap-2">
        {list.map((t) => (
          <div key={t.id} className="gt-rise pointer-events-auto flex max-w-[420px] items-center gap-2 rounded-2xl bg-ink py-2 pl-2.5 pr-4 text-[13.5px] text-paper shadow-pop">
            {t.tone === 'ok' ? <SealCheck size={22} /> : <span className={cn('mx-1 size-2 shrink-0 rounded-full', t.tone === 'warn' ? 'bg-signal gt-breathe' : 'bg-paper/60')} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-3 ring-1 ring-hairline">{children}</kbd>
}
