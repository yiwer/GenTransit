// 站点加入线路（需求 5.3.4，M5 计划 4.6）：先选线路（搜索框为空时列出附近站点经过的线路），
// 再逐个走向确认插入位置与站点——位置按绕行最短建议；本站在某个走向的行驶方向左侧、而对向站在右侧时，
// 那个走向默认改加对向站（BR-19、BR-20）。确认后一次保存，每条线路一份快照
import {
  ROUTE_KIND_LABEL,
  distanceM,
  stopLabel,
  suggestInsert,
  wrongSide,
  type GroupLineResult,
  type LineDetail,
  type LineOptions,
  type OppositeMap,
  type Page,
  type StopDetail,
  type StopListItem,
  type StopRef,
} from '@gentransit/shared'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { RoutePlate } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { get, isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { lineColor } from '@/map/routeStyle'

/** 附近多远以内的站点经过的线路作为候选（M5 默认决定 8） */
const NEARBY_M = 500

interface Plan {
  on: boolean
  stopId: string
  at: number
}

export function JoinLinesDialog({
  open,
  onOpenChange,
  stop,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  stop: StopDetail
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([])
  const [plans, setPlans] = useState<Record<string, Plan>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (!open) {
      setPicked([])
      setPlans({})
      setQ('')
    }
  }, [open])
  const passing = new Set(stop.routes.map((r) => r.lineId))

  const nearby = useQuery({
    queryKey: ['stops', 'join-nearby', stop.id],
    enabled: open,
    queryFn: async () => {
      const page = await get<Page<StopListItem>>('/api/stops', { near: `${stop.lng},${stop.lat}`, size: 30 })
      const lines = new Map<string, { id: string; name: string }>()
      for (const s of page.items)
        if ((s.distance ?? Infinity) <= NEARBY_M)
          for (const l of s.lines) if (!passing.has(l.id)) lines.set(l.id, { id: l.id, name: l.name })
      return [...lines.values()]
    },
  })
  const search = useQuery({
    queryKey: ['lines', 'join-search', term],
    enabled: open && term.length > 0,
    // 只要名称：用轻量的线路选项接口，不取走向与站序（M6）
    queryFn: async () =>
      (await get<LineOptions>('/api/lines/options', { q: term, size: 8 })).items.map((l) => ({
        id: l.id,
        name: l.name,
      })),
  })
  const opposite = useQuery({
    queryKey: ['stops', 'opposites', stop.id],
    enabled: open,
    queryFn: () => post<OppositeMap>('/api/stops/opposites', { ids: [stop.id] }),
  })
  const opp = opposite.data?.[stop.id] ?? null
  const details = useQueries({
    queries: picked.map((l) => ({
      queryKey: ['lines', 'detail', l.id],
      queryFn: () => get<LineDetail>(`/api/lines/${l.id}`),
    })),
  })
  const lines = details.map((d) => d.data).filter((d): d is LineDetail => Boolean(d))

  /** 默认方案：每个走向插在绕行最短处；方位反了时改用对向站 */
  const defaultPlan = (l: LineDetail, routeIndex: number): Plan => {
    const r = l.routes[routeIndex]
    const pts = r.stops.map((s) => s.stop)
    const self: StopRef = stop
    const choose = (x: StopRef) => ({ x, at: suggestInsert(pts, x).at })
    let pick = choose(self)
    if (opp) {
      const wrong = wrongSide(pts[pick.at - 1] ?? null, self, pts[pick.at] ?? null, opp)
      const alt = choose(opp)
      const altWrong = wrongSide(pts[alt.at - 1] ?? null, opp, pts[alt.at] ?? null, self)
      // 几何上判断不出来时，第二个走向用对向站
      if (wrong && !altWrong) pick = alt
      else if (wrong === altWrong && routeIndex === 1) pick = alt
    }
    return { on: true, stopId: pick.x.id, at: pick.at }
  }
  const keyOf = (lineId: string, kind: string) => `${lineId}|${kind}`
  const planOf = (l: LineDetail, i: number) => plans[keyOf(l.id, l.routes[i].kind)] ?? defaultPlan(l, i)
  const setPlan = (l: LineDetail, i: number, p: Partial<Plan>) =>
    setPlans((x) => ({ ...x, [keyOf(l.id, l.routes[i].kind)]: { ...planOf(l, i), ...p } }))

  const toggleLine = (l: { id: string; name: string }) =>
    setPicked((xs) => (xs.some((x) => x.id === l.id) ? xs.filter((x) => x.id !== l.id) : [...xs, l]))
  const cands = term ? (search.data ?? []) : (nearby.data ?? [])
  const inserts = lines
    .map((l) => ({
      lineId: l.id,
      rev: l.rev,
      inserts: l.routes
        .map((r, i) => ({ r, p: planOf(l, i) }))
        .filter((x) => x.p.on)
        .map((x) => ({ kind: x.r.kind, stopId: x.p.stopId, at: x.p.at })),
    }))
    .filter((x) => x.inserts.length)

  const submit = async () => {
    setSaving(true)
    try {
      const r = await post<GroupLineResult>(`/api/stops/${stop.id}/join`, { items: inserts })
      toast(`已加入 ${r.lines.length} 条线路，各生成一份修改快照`)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['stops'] }),
        qc.invalidateQueries({ queryKey: ['lines'] }),
        qc.invalidateQueries({ queryKey: ['sign-sets'] }),
        qc.invalidateQueries({ queryKey: ['data-checks'] }),
      ])
      onOpenChange(false)
    } catch (e) {
      toast(isApiError(e) ? e.message : '加入失败', 'error')
      await qc.invalidateQueries({ queryKey: ['lines', 'detail'] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={760}
      title={`把「${stopLabel(stop)}」加入线路`}
      description="选线路，再确认每个走向的插入位置；确认后一次保存，每条线路各生成一份修改快照"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!inserts.length || saving} onClick={() => void submit()}>
            加入 {inserts.length || ''} 条线路
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              aria-label="搜索线路"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="按线路名搜索"
              className="h-8 w-full rounded-lg bg-sunken pl-8 pr-2.5 text-[13px] placeholder:text-ink-4 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          {!term && <div className="px-1 text-[11.5px] text-ink-3">附近 {NEARBY_M} 米内站点经过的线路</div>}
          <ul className="max-h-[320px] overflow-auto" aria-label="可加入的线路">
            {cands.map((l) => {
              const on = picked.some((x) => x.id === l.id)
              const here = passing.has(l.id)
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleLine(l)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]',
                      on ? 'bg-accent-soft' : 'hover:bg-sunken',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded ring-1',
                        on ? 'bg-accent text-accent-ink ring-accent' : 'ring-hairline-2',
                      )}
                    >
                      {on && <Check size={11} />}
                    </span>
                    <RoutePlate name={l.name} size="xs" color={lineColor(l.id)} />
                    {here && <span className="ml-auto text-[11px] text-ink-3">已经过</span>}
                  </button>
                </li>
              )
            })}
            {(term ? search.isSuccess : nearby.isSuccess) && cands.length === 0 && (
              <li className="px-2 py-3 text-[12.5px] text-ink-3">
                {term ? `没有找到「${term}」` : '附近没有其他线路，用上面的搜索框找'}
              </li>
            )}
          </ul>
        </div>
        <div className="flex max-h-[420px] min-h-[200px] flex-col gap-3 overflow-auto">
          {picked.length === 0 && <div className="m-auto text-[12.5px] text-ink-3">在左边选一条或几条线路</div>}
          {details.some((d) => d.isPending) && (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
              <OrbitLoader size={16} /> 正在读取线路…
            </div>
          )}
          {lines.map((l) => (
            <section key={l.id} className="rounded-xl bg-surface-2 p-3 ring-1 ring-hairline" aria-label={l.name}>
              <div className="mb-2 flex items-center gap-2">
                <RoutePlate name={l.name} size="sm" color={lineColor(l.id)} />
                {l.status === 'suspended' && <span className="text-[11.5px] text-ink-3">停运中</span>}
              </div>
              {l.routes.map((r, i) => {
                const p = planOf(l, i)
                const pts = r.stops.map((s) => s.stop)
                const who = p.stopId === stop.id ? stop : opp
                const near = who ? pts.map((x) => distanceM(x, who)) : []
                const between = (at: number) =>
                  at === 0
                    ? `首站「${pts[0]?.name ?? ''}」之前`
                    : at >= pts.length
                      ? `末站「${pts.at(-1)?.name ?? ''}」之后`
                      : `「${pts[at - 1].name}」与「${pts[at].name}」之间`
                return (
                  <div
                    key={r.kind}
                    className="grid grid-cols-[auto_64px_minmax(0,1fr)] items-center gap-2 py-1 text-[12.5px]"
                  >
                    <input
                      type="checkbox"
                      aria-label={`加入${ROUTE_KIND_LABEL[r.kind]}`}
                      checked={p.on}
                      onChange={(e) => setPlan(l, i, { on: e.target.checked })}
                    />
                    <span className="font-semibold">{ROUTE_KIND_LABEL[r.kind]}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {opp ? (
                        <select
                          aria-label={`${ROUTE_KIND_LABEL[r.kind]}加入的站点`}
                          value={p.stopId}
                          onChange={(e) => {
                            const x = e.target.value === stop.id ? stop : opp
                            setPlan(l, i, { stopId: x.id, at: suggestInsert(pts, x).at })
                          }}
                          className="h-7 rounded-md bg-surface px-1.5 ring-1 ring-hairline"
                        >
                          <option value={stop.id}>本站 {stopLabel(stop)}</option>
                          <option value={opp.id}>对向站 {stopLabel(opp)}</option>
                        </select>
                      ) : (
                        <span className="text-ink-2">{stopLabel(stop)}</span>
                      )}
                      <select
                        aria-label={`${ROUTE_KIND_LABEL[r.kind]}插入位置`}
                        value={p.at}
                        onChange={(e) => setPlan(l, i, { at: Number(e.target.value) })}
                        className="h-7 min-w-0 max-w-full rounded-md bg-surface px-1.5 ring-1 ring-hairline"
                      >
                        {Array.from({ length: pts.length + 1 }, (_, at) => (
                          <option key={at} value={at}>
                            插在{between(at)}
                          </option>
                        ))}
                      </select>
                      <MiniStrip
                        count={pts.length}
                        at={p.at}
                        nearest={near.length ? near.indexOf(Math.min(...near)) : -1}
                      />
                    </span>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

/** 走向站序的微型条形图：圆点是各站，珊瑚色竖线是插入点，离本站最近的站点加粗 */
function MiniStrip({ count, at, nearest }: { count: number; at: number; nearest: number }) {
  const n = Math.min(count, 40)
  const scale = count > 40 ? 40 / count : 1
  const w = Math.max(40, n * 6 + 12)
  const x = (i: number) => 6 + i * 6 * scale
  return (
    <svg viewBox={`0 0 ${w} 14`} width={w} height={14} aria-hidden="true" className="shrink-0">
      <path d={`M6 7 H${x(Math.max(0, count - 1))}`} stroke="var(--plate)" strokeWidth={1.4} opacity={0.5} />
      {Array.from({ length: count }, (_, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={7}
          r={i === nearest ? 2.4 : 1.6}
          fill={i === nearest ? 'var(--plate)' : 'var(--surface)'}
          stroke="var(--plate)"
          strokeWidth={0.9}
        />
      ))}
      <path d={`M${x(at) - 3} 1.5 V12.5`} stroke="var(--coral)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}
