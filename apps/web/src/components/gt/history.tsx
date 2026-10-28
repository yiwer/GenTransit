// 修改历史（5.9）：平时是一个按钮（叠纸图标 + 快照数量），点开为弹窗时间轴；只读，不能回滚
import {
  OBJECT_TYPE_LABEL,
  SNAPSHOT_ACTION_LABEL,
  diffSnapshots,
  type DiffField,
  type ObjectType,
  type SnapshotItem,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { get } from '@/lib/api'
import { cn, fmtDateTime } from '@/lib/utils'
import { DiffView } from './diff'
import { OrbitLoader, SnapshotStack } from './lively'
import { Tag } from './symbols'

/** 本次会话的起点：之后生成的快照用珊瑚色标出 */
const SESSION_START = Date.now()

export const snapshotsKey = (type: ObjectType, id: string) => ['snapshots', type, id] as const

export const useSnapshots = (type: ObjectType, id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: snapshotsKey(type, id ?? ''),
    queryFn: () => get<SnapshotItem[]>('/api/snapshots', { type, id }),
    enabled: enabled && Boolean(id),
  })

export function HistoryButton({
  type,
  id,
  name,
  spec,
  size = 'md',
}: {
  type: ObjectType
  id: string
  name: string
  spec: DiffField[]
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const q = useSnapshots(type, id)
  const items = q.data ?? []
  const fresh = items.some((s) => new Date(s.createdAt).getTime() >= SESSION_START)
  return (
    <>
      <Button variant="ghost" size={size} className="group" onClick={() => setOpen(true)}>
        <SnapshotStack size={size === 'md' ? 17 : 15} />
        修改历史
        <span
          data-testid="history-count"
          className={cn(
            'rounded-full px-1.5 text-[11.5px] tabular-nums transition-colors',
            fresh ? 'bg-coral text-paper' : 'bg-sunken text-ink-3',
          )}
        >
          {q.isSuccess ? items.length : '·'}
        </span>
      </Button>
      <HistoryDialog open={open} onOpenChange={setOpen} type={type} id={id} name={name} spec={spec} />
    </>
  )
}

export function HistoryDialog({
  open,
  onOpenChange,
  type,
  id,
  name,
  spec,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  type: ObjectType
  id: string
  name: string
  spec: DiffField[]
}) {
  const q = useSnapshots(type, id, open)
  const items = q.data ?? []
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={580}
      title={
        <span className="flex flex-col">
          <span className="eyebrow">{OBJECT_TYPE_LABEL[type]} · 修改历史</span>
          <span className="mt-1 font-display text-[20px] font-bold">{name}</span>
        </span>
      }
    >
      <p className="-mt-1 mb-5 text-[12.5px] text-ink-3">
        共 {items.length} 份修改快照。只用于查看，不能回滚，也不能按日期回看。
      </p>
      {q.isPending ? (
        <div className="flex items-center gap-2 py-6 text-ink-3">
          <OrbitLoader size={22} /> 正在读取修改历史…
        </div>
      ) : (
        <Timeline items={items} spec={spec} />
      )}
    </Dialog>
  )
}

function Timeline({ items, spec }: { items: SnapshotItem[]; spec: DiffField[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <ol className="relative" aria-label="修改快照时间轴">
      {items.map((e, i) => {
        const [date, time] = fmtDateTime(e.createdAt).split(' ')
        const last = i === items.length - 1
        const fresh = new Date(e.createdAt).getTime() >= SESSION_START
        const prev = items[i + 1]
        const diff = prev && e.action !== 'delete' ? diffSnapshots(prev.content, e.content, spec) : []
        const expanded = openId === e.id
        const dot = fresh
          ? 'bg-coral'
          : e.action === 'create' || e.action === 'importCreate'
            ? 'bg-sage'
            : e.action === 'delete'
              ? 'bg-danger'
              : 'bg-plate'
        return (
          <li
            key={e.id}
            className={cn('relative grid grid-cols-[88px_24px_1fr] gap-x-2', fresh && 'gt-rise')}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="pt-0.5 text-right">
              <div className="text-[13px] font-semibold tabular-nums text-ink">{date.slice(5)}</div>
              <div className="text-[11.5px] tabular-nums text-ink-3">
                {date.slice(0, 4)} · {time}
              </div>
            </div>
            <div className="relative flex justify-center">
              {!last && <span className="absolute bottom-0 top-3 w-[2px] rounded-full bg-hairline-2" />}
              <span className={cn('relative mt-1.5 size-3 rounded-full ring-4 ring-surface', dot)}>
                {fresh && <span className="gt-ripple absolute inset-0 rounded-full bg-coral" />}
              </span>
            </div>
            <div className={cn('min-w-0', last ? 'pb-1' : 'pb-6')}>
              <div className="flex items-center gap-2">
                <Tag className={fresh ? 'bg-coral/15 text-coral' : undefined}>{SNAPSHOT_ACTION_LABEL[e.action]}</Tag>
                {fresh && <span className="text-[11.5px] text-coral">本次会话</span>}
              </div>
              <div className="mt-1 text-[14px] leading-6 text-ink">{e.note || summaryOf(e)}</div>
              {diff.length > 0 && (
                <>
                  <button
                    type="button"
                    className="mt-1 text-[12.5px] font-medium text-accent underline-offset-2 hover:underline"
                    aria-expanded={expanded}
                    onClick={() => setOpenId(expanded ? null : e.id)}
                  >
                    {expanded ? '收起差异' : `查看差异（${diff.length}）`}
                  </button>
                  {expanded && <DiffView entries={diff} className="gt-rise mt-2" />}
                </>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function summaryOf(e: SnapshotItem) {
  if (e.action === 'create') return e.objectType === 'stop' ? '新建站点，并创建空站牌集' : '新建'
  if (e.action === 'delete') return e.objectType === 'stop' ? '删除站点，站牌集一并删除' : '删除'
  return SNAPSHOT_ACTION_LABEL[e.action]
}
