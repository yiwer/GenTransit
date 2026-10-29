// 线路托盘（需求 5.5.3）：只有两个区——待编排（往上拖到站牌；站牌上的线路拖回来即移除）和隐藏（拖进去即隐藏）。
// 已编排看站牌本身，托盘不重复列出
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { passageLabel, type PoolItem } from '@gentransit/shared'
import { ChevronDown, ChevronUp, EyeOff, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { PassageLabel } from '@/components/gt/elevation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useEditor } from './editor-api'
import { PoolMenu } from './PlaceMenu'

function TrayChip({ item, hidden }: { item: PoolItem; hidden?: boolean }) {
  const ed = useEditor()
  const drag = useDraggable({ id: `pool:${item.key}` })
  return (
    <div
      ref={drag.setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      aria-label={`${passageLabel(item)}${hidden ? '（隐藏）' : '（待编排）'}，可拖到站牌`}
      className={cn(
        'group/chip relative flex h-[46px] shrink-0 cursor-grab items-center gap-2 rounded-xl pl-1.5 pr-1 shadow-xs ring-1 ring-hairline transition-transform hover:-translate-y-0.5 hover:shadow-float focus-visible:outline-2 focus-visible:outline-accent',
        hidden ? 'bg-surface-2' : 'bg-surface',
        drag.isDragging && 'opacity-40',
      )}
      data-testid={hidden ? 'tray-hidden' : 'tray-waiting'}
    >
      <PassageLabel item={item} terminal={false} />
      {item.terminal && (
        <span className="max-w-[110px] truncate whitespace-nowrap text-[11.5px] text-ink-3">开往 {item.terminal}</span>
      )}
      <span onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="ml-0.5">
        {hidden ? (
          <button
            type="button"
            aria-label={`取消隐藏 ${passageLabel(item)}`}
            title="取消隐藏"
            onClick={() => ed.unhide(item)}
            className="flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <Undo2 size={13} />
          </button>
        ) : (
          <span className="opacity-60 group-hover/chip:opacity-100">
            <PoolMenu item={item} />
          </span>
        )}
      </span>
    </div>
  )
}

/** 待编排为 0：一句话配鼠尾草色小对勾 */
function AllDone() {
  return (
    <span className="m-auto flex items-center gap-2 text-[12.5px] text-ink-3" data-testid="tray-all-done">
      <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" className="gt-pop">
        <circle cx="12" cy="12" r="9" fill="var(--sage-soft)" stroke="var(--sage)" strokeWidth="1.5" />
        <path
          d="M7.8 12.4 L10.6 15 C11.8 12.6 13.6 10.2 16.4 8.8"
          fill="none"
          stroke="var(--sage)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      本站途经都已编排
    </span>
  )
}

function Zone({
  id,
  title,
  dot,
  hint,
  overHint,
  count,
  dragging,
  dashed,
  children,
}: {
  id: string
  title: string
  dot: string
  hint: string
  overHint: string
  count: number
  dragging: boolean
  dashed?: boolean
  children: ReactNode
}) {
  const drop = useDroppable({ id })
  return (
    <section
      ref={drop.setNodeRef}
      aria-label={title}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl p-2.5 transition-all duration-200',
        dashed ? 'border-2 border-dashed bg-surface-2' : 'bg-surface ring-1',
        dashed
          ? drop.isOver
            ? 'scale-[1.01] border-ink-2 bg-sunken'
            : dragging
              ? 'border-ink-3'
              : 'border-hairline-2'
          : drop.isOver
            ? 'bg-accent-soft ring-2 ring-accent'
            : dragging
              ? 'ring-accent/40'
              : 'ring-hairline',
      )}
    >
      <header className="mb-2 flex items-center gap-2 px-0.5">
        <span className={cn('size-2 shrink-0 rounded-full', dot)} />
        <span className="shrink-0 text-[13px] font-semibold">{title}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{count}</span>
        <span className="ml-auto truncate text-[11.5px] text-ink-3">{drop.isOver ? overHint : hint}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-auto pb-0.5">{children}</div>
    </section>
  )
}

export function Tray({ open, onToggle, dragging }: { open: boolean; onToggle: () => void; dragging: boolean }) {
  const ed = useEditor()
  const wait = ed.pool.filter((p) => p.status === 'waiting')
  const hidden = ed.pool.filter((p) => p.status === 'hidden')
  if (!open)
    return (
      <div className="flex h-12 shrink-0 items-center gap-4 border-t border-hairline bg-surface-2 px-4">
        <span className="text-[13px] font-semibold">线路托盘</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span className="gt-breathe size-2 rounded-full bg-signal" /> 待编排{' '}
          <b className="tabular-nums">{wait.length}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span className="size-2 rounded-full border border-ink-3" /> 隐藏{' '}
          <b className="tabular-nums">{hidden.length}</b>
        </span>
        <Button size="sm" className="ml-auto" onClick={onToggle}>
          <ChevronUp size={14} /> 展开托盘
        </Button>
      </div>
    )
  return (
    <div className="relative grid h-[172px] shrink-0 grid-cols-[minmax(0,2.8fr)_minmax(0,1fr)] gap-2.5 border-t border-hairline bg-surface-2 p-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label="收起托盘"
        className="absolute -top-[13px] left-1/2 z-[6] flex h-[26px] -translate-x-1/2 items-center gap-1 rounded-full bg-surface px-3 text-[11.5px] text-ink-3 shadow-xs ring-1 ring-hairline hover:text-ink"
      >
        <ChevronDown size={13} /> 收起托盘
      </button>
      <Zone
        id="pool"
        title="待编排"
        dot={wait.length ? 'gt-breathe bg-signal' : 'bg-sage'}
        hint="往上拖到站牌；站牌上的线路拖回这里即移除"
        overHint="松手放回待编排"
        count={wait.length}
        dragging={dragging}
      >
        {wait.map((it) => (
          <TrayChip key={it.key} item={it} />
        ))}
        {wait.length === 0 && <AllDone />}
      </Zone>
      <Zone
        id="hidden"
        title="隐藏"
        dot="border border-ink-3"
        hint="拖进来即隐藏"
        overHint="松手即隐藏"
        count={hidden.length}
        dragging={dragging}
        dashed
      >
        {hidden.map((it) => (
          <TrayChip key={it.key} item={it} hidden />
        ))}
        {hidden.length === 0 && (
          <span className="m-auto flex flex-col items-center gap-1 text-[12px] text-ink-4">
            <EyeOff size={18} /> 不在本站展示的线路拖到这里
          </span>
        )}
      </Zone>
    </div>
  )
}
