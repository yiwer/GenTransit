// 识别符号：线路牌、方位章、状态章与几个小部件
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type PlateState = 'normal' | 'suspended' | 'invalid' | 'ghost'

/** 线路牌：全站线路名的统一呈现 */
export function RoutePlate({
  name,
  size = 'md',
  state = 'normal',
  className,
}: {
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  state?: PlateState
  className?: string
}) {
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
        state === 'suspended' &&
          'text-ink-3 line-through decoration-1 outline-1 -outline-offset-1 outline-ink-4 outline-dashed',
        state === 'invalid' && 'bg-danger-soft text-danger line-through decoration-1 ring-1 ring-inset ring-danger/40',
        state === 'ghost' && 'text-ink ring-1 ring-inset ring-hairline-2',
        className,
      )}
    >
      {name}
    </span>
  )
}

/** 方位章：像站牌上的方向标；编码模式下显示编码 */
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

export type ScheduleStatus = '待编排' | '已编排' | '隐藏' | '失效'

const ST: Record<ScheduleStatus, string> = {
  待编排: 'bg-signal-soft text-signal-ink ring-1 ring-inset ring-signal/60',
  已编排: 'bg-sage-soft text-sage ring-1 ring-inset ring-sage/35',
  隐藏: 'text-ink-3 border border-dashed border-ink-4',
  失效: 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/35 line-through decoration-1',
}
const ST_DOT: Record<ScheduleStatus, string> = {
  待编排: 'bg-signal gt-breathe',
  已编排: 'bg-sage',
  隐藏: 'border border-ink-3 bg-transparent',
  失效: 'bg-danger',
}

/** 状态章：颜色永远配文字与形状 */
export function StatusChip({
  status,
  count,
  size = 'md',
}: {
  status: ScheduleStatus
  count?: number
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        size === 'md' ? 'h-6 px-2.5 text-[12.5px]' : 'h-5 px-2 text-[11.5px]',
        ST[status],
      )}
    >
      <span className={cn('size-1.5 rounded-full', ST_DOT[status])} />
      {status}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  )
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full bg-sunken px-2 text-[11.5px] font-medium text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-3 ring-1 ring-hairline">
      {children}
    </kbd>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  label?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-lg bg-sunken p-0.5', size === 'md' ? 'h-8' : 'h-7')}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-surface text-ink shadow-xs' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 区块小标题：标题 + 计数 + 右侧操作 */
export function SectionTitle({
  children,
  count,
  extra,
  className,
  id,
}: {
  children: ReactNode
  count?: ReactNode
  extra?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div className={cn('mb-2 flex h-7 items-center gap-2', className)}>
      <h3 id={id} className="text-[13px] font-semibold tracking-wide text-ink">
        {children}
      </h3>
      {count !== undefined && <span className="text-[12.5px] tabular-nums text-ink-3">{count}</span>}
      {extra && <div className="ml-auto flex items-center gap-1">{extra}</div>}
    </div>
  )
}

/** 页面标题区 */
export function PageHeader({
  title,
  sub,
  actions,
  children,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="px-7 pb-4 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-9">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
