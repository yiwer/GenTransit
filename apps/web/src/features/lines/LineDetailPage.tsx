// 线路详情（5.4.6）：大号线路牌、属性表、走向分段控件、服务信息卡、轨迹、站序条形图（换乘线路牌）；
// 单击一站 = 地图定位并浮出卡片，双击或回车 = 进入站点详情（F-COM-13）
import {
  LINE_DIFF_SPEC,
  LINE_MODE_LABEL,
  SERVICE_TYPE_LABEL,
  TICKET_TYPE_LABEL,
  formatExtValue,
  type LineDeleteCheck,
  type LineImpact,
  type LineDetail,
  type SaveResult,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, MoreHorizontal, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { HistoryButton } from '@/components/gt/history'
import { OrbitLoader } from '@/components/gt/lively'
import { Prop, Val } from '@/components/gt/prop'
import { useSaveFlow } from '@/components/gt/save'
import { SplitView } from '@/components/gt/split-view'
import { DirBadge, RoutePlate, Segmented, Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown-menu'
import { useExtFields } from '@/features/common/data'
import { del, get, isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import { LineSample, RouteLegend } from '@/map/RouteLegend'
import { isReturnKind, lineColor } from '@/map/routeStyle'
import { RouteTrackStrip } from './RouteTrackStrip'
import { StatusPill, kindText, lineKey, useLine, useTransfers } from './shared'

export function LineDetailPage() {
  const { id } = useParams()
  const q = useLine(id)
  if (q.isPending)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-3">
        <OrbitLoader size={22} /> 正在读取线路…
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-[20px] font-semibold">线路不存在</p>
        <p className="text-[13px] text-ink-3">
          它可能已经被删除。已删除的线路可以在线路列表的"已删除"视图里查看修改历史。
        </p>
        <Link to="/lines" className="text-[13px] text-accent hover:underline">
          返回线路列表
        </Link>
      </div>
    )
  return <Detail line={q.data} />
}

function Detail({ line }: { line: LineDetail }) {
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const ext = useExtFields('line')
  const [routeId, setRouteId] = useState(line.routes[0]?.id ?? '')
  const route = line.routes.find((r) => r.id === routeId) ?? line.routes[0]
  const transfers = useTransfers(line.id, route?.id)
  const [hoverStop, setHoverStop] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const [askStatus, setAskStatus] = useState(false)
  const [delCheck, setDelCheck] = useState<LineDeleteCheck | null>(null)
  /** 停运、恢复、删除的确认弹窗写明受影响的站牌集数与编排数（默认决定 14） */
  const [impact, setImpact] = useState<LineImpact | null>(null)
  const suspended = line.status === 'suspended'
  const stopCount = new Set(line.routes.flatMap((r) => r.stops.map((s) => s.stop.id))).size
  const focusStop = focus !== null ? route?.stops[focus] : undefined
  const flow = useSaveFlow<LineDetail>({
    okText: () => (suspended ? `${line.name} 已恢复运营` : `${line.name} 已停运，生成修改快照`),
  })

  const refresh = async (item?: LineDetail) => {
    if (item) qc.setQueryData(lineKey(item.id), item)
    await qc.invalidateQueries({ queryKey: ['lines'] })
    await qc.invalidateQueries({ queryKey: ['stops'] })
    await qc.invalidateQueries({ queryKey: ['snapshots', 'line', line.id] })
    await qc.invalidateQueries({ queryKey: ['sign-sets'] })
  }
  const loadImpact = async () => {
    try {
      setImpact(await get<LineImpact>(`/api/lines/${line.id}/impact`))
    } catch {
      setImpact(null)
    }
  }
  const openStatus = () => {
    setImpact(null)
    setAskStatus(true)
    void loadImpact()
  }
  const toggleStatus = async () => {
    setAskStatus(false)
    try {
      const r = await flow.save(() =>
        post<SaveResult<LineDetail>>(`/api/lines/${line.id}/${suspended ? 'resume' : 'suspend'}`, { rev: line.rev }),
      )
      if (r) await refresh(r.item)
    } catch {
      // 已提示
    }
  }
  const askDelete = async () => {
    try {
      setImpact(null)
      void loadImpact()
      setDelCheck(await get<LineDeleteCheck>(`/api/lines/${line.id}/delete-check`))
    } catch (e) {
      toast(isApiError(e) ? e.message : '无法检查影响', 'error')
    }
  }
  const doDelete = async () => {
    try {
      await del(`/api/lines/${line.id}`)
      setDelCheck(null)
      await qc.invalidateQueries({ queryKey: ['lines'] })
      await qc.invalidateQueries({ queryKey: ['stops'] })
      toast(`已删除 ${line.name}，修改历史仍可查看`)
      nav('/lines')
    } catch (e) {
      toast(isApiError(e) ? e.message : '删除失败', 'error')
    }
  }
  const transfersAt = (stopId: string) => transfers.data?.find((t) => t.stopId === stopId)?.lines ?? []
  const first = route?.stops[0]?.stop.name
  const last = route?.stops.at(-1)?.stop.name

  const left = (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-surface/90 px-6 backdrop-blur">
        <Link
          to="/lines"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={15} /> 线路
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <HistoryButton type="line" id={line.id} name={line.name} spec={LINE_DIFF_SPEC} />
          <Button onClick={() => nav(`/lines/${line.id}/edit`)}>
            <Pencil size={14} /> 编辑
          </Button>
          <Button variant={suspended ? 'primary' : 'secondary'} onClick={openStatus}>
            {suspended ? (
              <>
                <Play size={14} /> 恢复运营
              </>
            ) : (
              <>
                <Pause size={14} /> 停运
              </>
            )}
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="更多">
                <MoreHorizontal size={17} />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem danger onSelect={() => void askDelete()}>
                <Trash2 size={14} /> 删除线路
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="px-7 pb-16">
        <header className="flex items-start gap-5 pb-6 pt-3">
          <RoutePlate
            name={line.name}
            size="xl"
            color={lineColor(line.id)}
            state={suspended ? 'suspended' : 'normal'}
          />
          <div className="min-w-0 pt-0.5">
            <div className="eyebrow">线路 · {line.number}</div>
            <h1 className="mt-1 font-display text-[22px] font-semibold leading-8">
              {line.mode === 'loop' ? `环线 · ${first ?? ''}` : first ? `${first} — ${last}` : '还没有站序'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <StatusPill status={line.status} />
              {LINE_MODE_LABEL[line.mode]}
              {line.company && <> · {line.company.name}</>}
              {line.nameEn && <span className="italic text-ink-3">{line.nameEn}</span>}
            </div>
          </div>
        </header>

        {suspended && (
          <div className="mb-6 rounded-xl bg-signal-soft px-4 py-3 text-[13.5px] text-signal-ink">
            停运中：这条线路的走向视为不经过任何站点。恢复运营后立即生效。
          </div>
        )}

        <section className="mb-8 grid grid-cols-2 gap-x-8">
          <div>
            <Prop label="售票类型">
              <Val>{line.ticketType ? TICKET_TYPE_LABEL[line.ticketType] : ''}</Val>
            </Prop>
            <Prop label="票制">
              <Val>{line.fareSystem?.name}</Val>
            </Prop>
          </div>
          <div>
            <Prop label="票价">
              <Val>{line.fare}</Val>
            </Prop>
            <Prop label="管理编号">
              <Val mono>{line.number}</Val>
            </Prop>
          </div>
          {(ext.data ?? [])
            .filter((f) => f.enabled)
            .map((f) => (
              <Prop
                key={f.key}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {f.name} <Tag className="h-4 px-1.5 text-[10.5px]">扩展</Tag>
                  </span>
                }
              >
                <Val>{formatExtValue(line.ext[f.key])}</Val>
              </Prop>
            ))}
        </section>

        {route && (
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <Segmented
                label="走向"
                value={route.id}
                onChange={(v) => {
                  setRouteId(v)
                  setFocus(null)
                }}
                options={line.routes.map((r) => ({
                  value: r.id,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <LineSample
                        color={lineColor(line.id)}
                        hollow={isReturnKind(r.kind)}
                        dashed={!r.track || r.track.stale}
                      />
                      {kindText(r.kind)}
                    </span>
                  ),
                }))}
              />
              <span className="text-[12.5px] text-ink-3">{route.stops.length} 站</span>
            </div>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {[
                { key: 'to', label: '开往', value: last ?? '—', display: true },
                {
                  key: 'time',
                  label: route.serviceType ? `服务时间 · ${SERVICE_TYPE_LABEL[route.serviceType]}` : '服务时间',
                  value: route.serviceTime || '—',
                },
                { key: 'interval', label: '发车间隔', value: route.interval || '—' },
              ].map((c) => (
                <div key={c.key} className="rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-hairline">
                  <div className="text-[11.5px] text-ink-3">{c.label}</div>
                  <div
                    className={cn('mt-0.5 truncate text-[14.5px] font-semibold', c.display && 'font-display')}
                    title={c.value}
                  >
                    {c.value}
                  </div>
                </div>
              ))}
            </div>
            <RouteTrackStrip line={line} route={route} />

            {/* 站序条形图：像站牌上的线路图 */}
            <ol
              className="relative"
              aria-label={`${kindText(route.kind)} 站序`}
              onMouseLeave={() => setHoverStop(null)}
            >
              {route.stops.map((s, i) => {
                const isFirst = i === 0
                const isLast = i === route.stops.length - 1
                const tr = transfersAt(s.stop.id)
                const focused = focus === i
                const hov = hoverStop === i
                const open = () => nav(`/stops/${s.stop.id}`)
                return (
                  <li key={`${s.stop.id}#${s.pass}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`第 ${i + 1} 站 ${s.stop.name}（${s.stop.direction}）`}
                      aria-pressed={focused}
                      title="单击在地图上定位，双击进入站点详情"
                      onMouseEnter={() => setHoverStop(i)}
                      onFocus={() => setHoverStop(i)}
                      onClick={() => setFocus(focused ? null : i)}
                      onDoubleClick={open}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          open()
                        }
                      }}
                      className={cn(
                        'group relative flex w-full cursor-pointer select-none items-center gap-3 rounded-xl py-2 pl-2 pr-3 text-left transition-colors',
                        focused ? 'bg-accent-soft/70' : hov && 'bg-surface-2',
                      )}
                    >
                      <span className="relative flex w-7 shrink-0 justify-center self-stretch">
                        {!isFirst && (
                          <span className="absolute left-1/2 top-0 h-1/2 w-[5px] -translate-x-1/2 bg-plate" />
                        )}
                        {!isLast && (
                          <span className="absolute bottom-0 left-1/2 h-1/2 w-[5px] -translate-x-1/2 bg-plate" />
                        )}
                        <span
                          className={cn(
                            'relative z-[1] self-center rounded-full transition-transform duration-300 ease-[var(--bounce)]',
                            isFirst || isLast
                              ? 'size-[18px] bg-plate ring-[3px] ring-surface'
                              : 'size-[13px] border-[3px] border-plate bg-surface',
                            (hov || focused) && 'scale-125',
                          )}
                        >
                          {(isFirst || isLast) && <span className="absolute inset-[5px] rounded-full bg-coral" />}
                        </span>
                      </span>
                      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-ink-4">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'truncate font-display',
                              isFirst || isLast ? 'text-[16px] font-bold' : 'text-[14.5px] font-semibold',
                            )}
                          >
                            {s.stop.name}
                          </span>
                          <DirBadge dir={s.stop.direction} size="sm" />
                          {s.pass > 1 && <Tag className="h-4 px-1.5 text-[10.5px]">第 {s.pass} 次</Tag>}
                        </span>
                        {s.times.length > 0 && (
                          <span className="block text-[11.5px] tabular-nums text-ink-3">
                            首 {s.times[0]} · 末 {s.times.at(-1)} · {s.times.length} 班
                          </span>
                        )}
                      </span>
                      <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                        {tr.slice(0, 5).map((l) => (
                          <RoutePlate key={l.id} name={l.name} size="xs" state={l.suspended ? 'suspended' : 'ghost'} />
                        ))}
                        {tr.length > 5 && <span className="text-[11.5px] text-ink-3">+{tr.length - 5}</span>}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
            <p className="mt-2 text-[12px] text-ink-3">
              单击站点在地图上定位，双击进入站点详情。右侧线路牌是在该站可换乘的其他线路。
            </p>
          </section>
        )}
      </div>

      <Dialog
        open={askStatus}
        onOpenChange={setAskStatus}
        title={suspended ? `恢复 ${line.name} 运营？` : `${line.name} 停运？`}
        footer={
          <>
            <Button onClick={() => setAskStatus(false)}>取消</Button>
            <Button variant={suspended ? 'primary' : 'danger'} onClick={() => void toggleStatus()}>
              {suspended ? '恢复运营' : '确认停运'}
            </Button>
          </>
        }
      >
        {suspended ? (
          <p>立即生效。恢复后，这条线路的走向重新经过它的 {stopCount} 个站点。</p>
        ) : (
          <p>
            立即生效。停运后，这条线路的走向视为不经过任何站点，涉及 <b className="text-ink">{stopCount} 个站点</b>
            。线路数据保留，恢复运营后自动恢复。
          </p>
        )}
        <ImpactNote impact={impact} verb={suspended ? '恢复为已编排' : '显示为失效（保留原位，不生成快照）'} />
      </Dialog>
      <Dialog
        open={Boolean(flow.conflict)}
        onOpenChange={(o) => !o && flow.clearConflict()}
        title="已在别处修改"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              flow.clearConflict()
              void refresh()
            }}
          >
            刷新后再试
          </Button>
        }
      >
        <p>这条线路在你打开之后已经在别处保存过，这次操作没有生效。</p>
      </Dialog>
      <Dialog
        open={Boolean(delCheck)}
        onOpenChange={(o) => !o && setDelCheck(null)}
        title={`删除 ${line.name}？`}
        footer={
          <>
            <Button onClick={() => setDelCheck(null)}>取消</Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              删除线路
            </Button>
          </>
        }
      >
        <p>
          会同时删除它的 {delCheck?.routes} 个走向与站序（涉及 {delCheck?.stops}{' '}
          个站点）。修改历史会保留，可在"已删除的线路"里查看。
        </p>
        <ImpactNote impact={impact} verb={'删除，每个站牌集各存一份"连带修改"快照'} />
      </Dialog>
    </div>
  )

  const points = (route?.stops ?? []).map((s, i) => ({
    id: String(i),
    lng: s.stop.lng,
    lat: s.stop.lat,
    label: s.stop.name,
    sub: s.stop.direction,
    badge: String(i + 1),
  }))
  return (
    <SplitView
      storageKey="line-detail"
      defaultWidth={560}
      left={() => left}
      map={
        <MapView
          className="absolute inset-0"
          points={points}
          selectedId={focus !== null ? String(focus) : null}
          hoverId={hoverStop !== null ? String(hoverStop) : null}
          onSelect={(i) => setFocus(focus === Number(i) ? null : Number(i))}
          onOpen={(i) => route && nav(`/stops/${route.stops[Number(i)].stop.id}`)}
          routes={line.routes.map((r) => ({
            id: r.id,
            // 有未过期的轨迹就画轨迹，否则按站点连线
            points:
              r.track && !r.track.stale
                ? r.track.points
                : r.stops.map((s) => [s.stop.lng, s.stop.lat] as [number, number]),
            road: Boolean(r.track && !r.track.stale),
            color: lineColor(line.id),
            hollow: isReturnKind(r.kind),
            tone: r.id === route?.id ? 'strong' : 'faint',
            flow: r.id === route?.id && !suspended,
          }))}
          fit={
            focusStop
              ? { key: `stop:${focus}`, points: [[focusStop.stop.lng, focusStop.stop.lat]] }
              : {
                  key: route?.id ?? 'none',
                  points: line.routes.flatMap((r) => r.stops.map((s) => [s.stop.lng, s.stop.lat] as [number, number])),
                }
          }
          overlay={
            <>
              <RouteLegend
                routes={line.routes.map((r) => ({ kind: r.kind, road: Boolean(r.track && !r.track.stale) }))}
              />
              {focusStop && (
                <div
                  key={focus}
                  className="gt-rise absolute bottom-10 right-4 z-10 flex w-[330px] items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-pop ring-1 ring-hairline"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-[17px] font-semibold">{focusStop.stop.name}</span>
                      <DirBadge dir={focusStop.stop.direction} size="sm" />
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      {kindText(route!.kind)} · 第 {focus! + 1} 站
                      {focusStop.pass > 1 ? `（第 ${focusStop.pass} 次途经）` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => nav(`/stops/${focusStop.stop.id}`)}>
                    站点详情 <ArrowUpRight size={13} />
                  </Button>
                  <IconButton label="取消定位" className="size-7" onClick={() => setFocus(null)}>
                    <X size={14} />
                  </IconButton>
                </div>
              )}
            </>
          }
        />
      }
    />
  )
}

/** 弹窗里的影响说明：N 个站牌集的 M 条编排将…… */
function ImpactNote({ impact, verb }: { impact: LineImpact | null; verb: string }) {
  if (!impact)
    return (
      <p className="mt-2 flex items-center gap-2 text-[12.5px] text-ink-3">
        <OrbitLoader size={14} /> 正在统计站牌集…
      </p>
    )
  if (!impact.schedules) return <p className="mt-2 text-[12.5px] text-ink-3">没有站牌集编排了这条线路。</p>
  return (
    <p
      className="mt-2 rounded-xl bg-signal-soft/60 px-3 py-2 text-[13px] text-ink ring-1 ring-signal/25"
      data-testid="impact-note"
    >
      <b>{impact.signSets}</b> 个站牌集的 <b>{impact.schedules}</b> 条编排将{verb}。
    </p>
  )
}
