// PROTOTYPE — 详情页共用：修改历史时间线、线路途经计算
import { useMemo, useState } from 'react'
import { useStore } from '../data/store'
import type { Line, Route, Stop } from '../data/types'
import { compareLineName, passagesAt, poolOf } from '../lib/domain'
import { Button, Dialog, Tag, cn } from '../ui'
import { SnapshotStack } from '../ui/lively'

export const KIND_MARK: Record<string, string> = { 上行: '↑', 下行: '↓', 内环: '⟳', 外环: '⟲', 环线: '⟳', 单向: '→' }

export const terminalOf = (route: Route, stops: Stop[]) => stops.find((s) => s.id === route.stopIds[route.stopIds.length - 1])
export const originOf = (route: Route, stops: Stop[]) => stops.find((s) => s.id === route.stopIds[0])

/** 经过某站点的线路（含停运），按自动排序规则排列 */
export function linesAt(stopId: string, lines: Line[]) {
  return lines
    .flatMap((l) => l.routes.filter((r) => r.stopIds.includes(stopId)).map((r) => ({ line: l, route: r })))
    .sort((a, b) => compareLineName(a.line.name, b.line.name) || a.route.kind.localeCompare(b.route.kind))
}

export function useSignSetSummary(stopId: string) {
  const { stops, lines, getSignSet } = useStore()
  return useMemo(() => {
    const ss = getSignSet(stopId)
    const pool = poolOf(ss, passagesAt(stopId, lines, stops))
    return {
      ss,
      boards: ss.shelves.flatMap((s) => s.boards),
      wait: pool.filter((p) => p.status === '待编排').length,
      bad: pool.filter((p) => p.status === '失效').length,
      done: pool.filter((p) => p.status === '已编排').length,
    }
  }, [stopId, stops, lines, getSignSet])
}

export interface HistorySeed {
  at: string
  action: string
  summary: string
  diff?: { field: string; from: string; to: string }[]
}

/** 修改历史：平时只是一个按钮，点开后以时间轴弹窗展示快照（只读，不能回滚） */
export function HistoryButton({ objType, objId, objName, seed, size = 'md' }: { objType: '站点' | '线路' | '站牌集'; objId: string; objName: string; seed: HistorySeed[]; size?: 'sm' | 'md' }) {
  const { snapshots } = useStore()
  const [open, setOpen] = useState(false)
  const fresh = snapshots.filter((s) => s.objType === objType && s.objId === objId)
  const items = [...fresh.map((s) => ({ at: s.at, action: s.action, summary: s.summary, fresh: true as const })), ...seed.map((s) => ({ ...s, fresh: false as const }))]
  return (
    <>
      <Button variant="ghost" size={size} className="group" onClick={() => setOpen(true)}>
        <SnapshotStack size={size === 'md' ? 17 : 15} />
        修改历史
        <span className={cn('rounded-full px-1.5 text-[11.5px] tabular-nums', fresh.length ? 'bg-coral text-paper' : 'bg-sunken text-ink-3')}>{items.length}</span>
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width={560}
        title={
          <span className="flex flex-col">
            <span className="eyebrow">{objType} · 修改历史</span>
            <span className="mt-1 font-display text-[20px] font-bold">{objName}</span>
          </span>
        }
      >
        <p className="-mt-1 mb-5 text-[12.5px] text-ink-3">共 {items.length} 份修改快照。只用于查看，不能回滚，也不能按日期回看。</p>
        <Timeline items={items} />
      </Dialog>
    </>
  )
}

function Timeline({ items }: { items: (HistorySeed & { fresh: boolean })[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <ol className="relative">
      {items.map((e, i) => {
        const [date, time] = e.at.split(' ')
        const last = i === items.length - 1
        const expanded = openIdx === i
        const dot = e.fresh ? 'bg-coral' : e.action === '新增' ? 'bg-sage' : e.action === '删除' ? 'bg-danger' : 'bg-plate'
        return (
          <li key={i} className={cn('relative grid grid-cols-[88px_24px_1fr] gap-x-2', e.fresh && 'gt-rise')} style={{ animationDelay: `${i * 40}ms` }}>
            <div className="pt-0.5 text-right">
              <div className="text-[13px] font-semibold tabular-nums text-ink">{date?.slice(5)}</div>
              <div className="text-[11.5px] tabular-nums text-ink-3">
                {date?.slice(0, 4)} · {time}
              </div>
            </div>
            <div className="relative flex justify-center">
              {!last && <span className="absolute bottom-0 top-3 w-[2px] rounded-full bg-hairline-2" />}
              <span className={cn('relative mt-1.5 size-3 rounded-full ring-4 ring-surface', dot)}>{e.fresh && <span className="absolute inset-0 rounded-full bg-coral gt-ripple" />}</span>
            </div>
            <div className={cn('min-w-0', last ? 'pb-1' : 'pb-6')}>
              <div className="flex items-center gap-2">
                <Tag className={e.fresh ? 'bg-coral/15 text-coral' : undefined}>{e.action}</Tag>
                {e.fresh && <span className="text-[11.5px] text-coral">本次会话</span>}
              </div>
              <div className="mt-1 text-[14px] leading-6 text-ink">{e.summary}</div>
              {e.diff?.length ? (
                <>
                  <button className="mt-1 text-[12.5px] font-medium text-accent underline-offset-2 hover:underline" aria-expanded={expanded} onClick={() => setOpenIdx(expanded ? null : i)}>
                    {expanded ? '收起差异' : `查看差异（${e.diff.length}）`}
                  </button>
                  {expanded && (
                    <div className="gt-rise mt-2 overflow-hidden rounded-xl ring-1 ring-hairline">
                      {e.diff.map((d) => (
                        <div key={d.field} className="grid grid-cols-[84px_1fr] gap-3 border-b border-hairline px-3 py-2 text-[12.5px] last:border-0">
                          <span className="text-ink-3">{d.field}</span>
                          <span className="min-w-0">
                            <span className="block text-danger line-through decoration-1">{d.from || '—'}</span>
                            <span className="block text-sage">{d.to || '—'}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                !e.fresh && e.action !== '新增' && <div className="mt-1 text-[12px] text-ink-4">这份快照没有可展示的字段差异</div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
