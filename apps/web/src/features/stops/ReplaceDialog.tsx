// 在线路中替换站点（需求 5.3.4，M5 计划 4.7）：选目标站点（按离本站的距离排序），列出每处引用，
// 替换后会与相邻站相同的默认不勾；一次保存所有受影响线路，每条一份快照；替换完不再被引用时可以接着删除
import {
  ROUTE_KIND_LABEL,
  stopLabel,
  type GroupLineResult,
  type StopDetail,
  type StopReference,
} from '@gentransit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { OrbitLoader, SealCheck } from '@/components/gt/lively'
import { DirBadge, RoutePlate } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { StopSearch } from '@/features/lines/route-tools'
import { get, isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { lineColor } from '@/map/routeStyle'

type Target = { id: string; name: string; direction: string }
const refKey = (r: StopReference) => `${r.lineId}|${r.routeKind}|${r.index}`

export function ReplaceDialog({
  open,
  onOpenChange,
  stop,
  onDelete,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  stop: StopDetail
  /** 替换完不再被引用时"删除这个站点" */
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [target, setTarget] = useState<Target | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<number | null>(null)
  const refs = useQuery({
    queryKey: ['stops', 'references', stop.id],
    enabled: open,
    queryFn: () => get<StopReference[]>(`/api/stops/${stop.id}/references`),
  })
  useEffect(() => {
    if (open) {
      setTarget(null)
      setDone(null)
      setOff(new Set())
    }
  }, [open])
  const list = refs.data ?? []
  /** 替换后会和前一站或后一站相同 */
  const dupOf = (r: StopReference) => (target && (r.prev?.id === target.id || r.next?.id === target.id) ? true : false)
  const chosen = list.filter((r) => !off.has(refKey(r)) && !dupOf(r))

  const submit = async () => {
    if (!target) return
    setSaving(true)
    try {
      await post<GroupLineResult>(`/api/stops/${stop.id}/replace`, {
        targetId: target.id,
        refs: chosen.map((r) => ({ lineId: r.lineId, rev: r.rev, kind: r.routeKind, index: r.index })),
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['stops'] }),
        qc.invalidateQueries({ queryKey: ['lines'] }),
        qc.invalidateQueries({ queryKey: ['sign-sets'] }),
        qc.invalidateQueries({ queryKey: ['data-checks'] }),
      ])
      const left = await get<StopReference[]>(`/api/stops/${stop.id}/references`)
      if (left.length === 0) setDone(chosen.length)
      else {
        toast(`已替换 ${chosen.length} 处，还剩 ${left.length} 处引用`)
        onOpenChange(false)
      }
    } catch (e) {
      toast(isApiError(e) ? e.message : '替换失败', 'error')
      await refs.refetch()
    } finally {
      setSaving(false)
    }
  }

  if (done !== null)
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={
          <span className="inline-flex items-center gap-2">
            <SealCheck size={26} /> 已替换 {done} 处
          </span>
        }
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>先留着</Button>
            <Button
              variant="danger"
              onClick={() => {
                onOpenChange(false)
                onDelete()
              }}
            >
              <Trash2 size={14} /> 删除这个站点
            </Button>
          </>
        }
      >
        <p data-testid="replace-done">
          「{stopLabel(stop)}」已经没有线路引用，现在可以删除它（站牌集一并删除，修改历史保留）。
        </p>
      </Dialog>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={640}
      title={`在线路中把「${stopLabel(stop)}」替换为…`}
      description="被替换位置的到站时刻和路径站扩展字段保留；确认后一次保存，每条线路各生成一份修改快照"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!target || !chosen.length || saving} onClick={() => void submit()}>
            替换 {chosen.length || ''} 处
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[12.5px] text-ink-3">换成</span>
          {target ? (
            <span
              className="flex flex-1 items-center gap-2 rounded-lg bg-accent-soft px-2.5 py-1.5"
              data-testid="replace-target"
            >
              <span className="font-display font-semibold">{target.name}</span>
              <DirBadge dir={target.direction} size="sm" />
              <button
                type="button"
                className="ml-auto text-[12px] text-ink-3 hover:text-ink"
                onClick={() => setTarget(null)}
              >
                重新选
              </button>
            </span>
          ) : (
            <StopSearch
              placeholder="按站名搜索目标站点，按距离排序"
              near={stop}
              onAdd={(s) => setTarget(s.id === stop.id ? null : s)}
            />
          )}
        </div>
        <div className="text-[12px] text-ink-3">引用这个站点的 {list.length} 处路径站</div>
        <ul className="max-h-[320px] overflow-auto rounded-xl ring-1 ring-hairline" aria-label="引用">
          {refs.isPending && (
            <li className="flex items-center gap-2 px-3 py-4 text-[12.5px] text-ink-3">
              <OrbitLoader size={16} /> 正在读取…
            </li>
          )}
          {list.map((r) => {
            const dup = dupOf(r)
            const on = !off.has(refKey(r)) && !dup
            return (
              <li
                key={refKey(r)}
                className="flex items-center gap-2.5 border-b border-hairline px-3 py-2 text-[12.5px] last:border-0"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${r.lineName} ${ROUTE_KIND_LABEL[r.routeKind]}第 ${r.index + 1} 站`}
                  disabled={dup}
                  onClick={() =>
                    setOff((s) => {
                      const n = new Set(s)
                      if (n.has(refKey(r))) n.delete(refKey(r))
                      else n.add(refKey(r))
                      return n
                    })
                  }
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded ring-1',
                    on ? 'bg-accent text-accent-ink ring-accent' : 'ring-hairline-2',
                    dup && 'opacity-40',
                  )}
                >
                  {on && <Check size={11} />}
                </button>
                <Link to={`/lines/${r.lineId}`} className="shrink-0">
                  <RoutePlate
                    name={r.lineName}
                    size="xs"
                    color={lineColor(r.lineId)}
                    state={r.lineSuspended ? 'suspended' : 'normal'}
                  />
                </Link>
                <span className="w-16 shrink-0 text-ink-2">
                  {ROUTE_KIND_LABEL[r.routeKind]} 第 {r.index + 1} 站
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-ink-3">
                  {r.prev ? r.prev.name : '（首站）'}
                  <ArrowRight size={11} className="shrink-0" />
                  <span className={cn('font-semibold', target ? 'text-danger line-through' : 'text-ink')}>
                    {stop.name}
                  </span>
                  {target && <span className="font-semibold text-accent">{target.name}</span>}
                  <ArrowRight size={11} className="shrink-0" />
                  {r.next ? r.next.name : '（末站）'}
                </span>
                {dup && <span className="shrink-0 text-[11.5px] text-signal-ink">替换后会和相邻的站相同</span>}
              </li>
            )
          })}
          {refs.isSuccess && list.length === 0 && (
            <li className="px-3 py-4 text-[12.5px] text-ink-3">没有线路引用这个站点</li>
          )}
        </ul>
      </div>
    </Dialog>
  )
}
