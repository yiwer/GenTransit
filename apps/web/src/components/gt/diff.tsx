// 字段级差异：旧值删除线陶土色，新值鼠尾草色；列表类内容显示增、删、移动、修改
import type { DiffEntry, DiffItemOp } from '@gentransit/shared'
import { cn } from '@/lib/utils'

const OP: Record<DiffItemOp, [string, string]> = {
  added: ['新增', 'bg-sage-soft text-sage'],
  removed: ['删除', 'bg-danger-soft text-danger'],
  moved: ['移动', 'bg-sunken text-ink-2'],
  changed: ['修改', 'bg-signal-soft text-signal-ink'],
}

export function DiffView({
  entries,
  fromLabel,
  toLabel,
  className,
}: {
  entries: DiffEntry[]
  /** 两列对照（冲突弹窗）时的列名；不传则上下排列旧值与新值 */
  fromLabel?: string
  toLabel?: string
  className?: string
}) {
  const columns = Boolean(fromLabel && toLabel)
  return (
    <div className={cn('overflow-hidden rounded-xl ring-1 ring-hairline', className)}>
      {columns && (
        <div className="grid grid-cols-[96px_1fr_1fr] gap-3 border-b border-hairline bg-surface-2 px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-ink-3">
          <span>字段</span>
          <span>{fromLabel}</span>
          <span>{toLabel}</span>
        </div>
      )}
      {entries.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          className={cn(
            'grid gap-3 border-b border-hairline px-3 py-2 text-[12.5px] last:border-0',
            columns ? 'grid-cols-[96px_1fr_1fr]' : 'grid-cols-[96px_1fr]',
          )}
        >
          <span className="text-ink-3">{d.label}</span>
          {d.kind === 'value' ? (
            columns ? (
              <>
                <span className="min-w-0 break-words text-ink-2">{d.from || '—'}</span>
                <span className="min-w-0 break-words font-medium text-ink">{d.to || '—'}</span>
              </>
            ) : (
              <span className="min-w-0 break-words">
                <span className="block text-danger line-through decoration-1">{d.from || '—'}</span>
                <span className="block text-sage">{d.to || '—'}</span>
              </span>
            )
          ) : (
            <span className={cn('flex min-w-0 flex-wrap gap-1.5', columns && 'col-span-2')}>
              {d.items.map((it, j) => (
                <span key={j} className="inline-flex items-center gap-1">
                  <span className={cn('rounded px-1 text-[11px] font-medium', OP[it.op][1])}>{OP[it.op][0]}</span>
                  <span className={cn(it.op === 'removed' && 'line-through decoration-1 text-ink-3')}>{it.label}</span>
                </span>
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
