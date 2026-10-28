// PROTOTYPE — 线路详情（独立页面）：左侧线路信息与站序条形图，右侧地图点亮当前走向并以流动表示行驶方向
import { ArrowLeft, ArrowUpRight, MoreHorizontal, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDebug, useStore } from '../../data/store'
import { MapView, routePoints } from '../../map/MapView'
import { SplitView } from '../../shell/SplitView'
import { Button, Dialog, DirBadge, IconButton, MenuItem, Popover, Prop, RoutePlate, SectionTitle, Segmented, Tag, cn, useToast } from '../../ui'
import { HistoryButton, KIND_MARK, terminalOf } from '../shared'

export function LineDetailPage() {
  const { id } = useParams()
  const { lines, stops, getSignSet, setLineStatus } = useStore()
  const line = lines.find((l) => l.id === id)
  const nav = useNavigate()
  const toast = useToast()
  const [routeId, setRouteId] = useState(line?.routes[0].id ?? '')
  const [hoverStop, setHoverStop] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null) // 单击站序：地图定位到该站
  const [ask, setAsk] = useState(false)
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 页面: '线路详情', 线路: line }), [line])

  // 停运会让多少个站牌集出现失效编排
  const impacted = useMemo(() => {
    if (!line) return 0
    const ids = new Set(line.routes.map((r) => r.id))
    const stopIds = new Set(line.routes.flatMap((r) => r.stopIds))
    return [...stopIds].filter((sid) => getSignSet(sid).schedules.some((s) => ids.has(s.routeId) && s.place.type !== 'hidden')).length
  }, [line, getSignSet])

  if (!line) return <div className="p-10 text-center text-ink-3">线路不存在</div>
  const route = line.routes.find((r) => r.id === routeId) ?? line.routes[0]
  const suspended = line.status === '停运'
  const seq = route.stopIds.map((sid, i) => ({ stop: stops.find((s) => s.id === sid)!, i }))
  const focusStop = focus ? stops.find((s) => s.id === focus) : undefined
  const transfersAt = (sid: string) => lines.filter((l) => l.id !== line.id && l.routes.some((r) => r.stopIds.includes(sid)))

  const left = (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-surface/90 px-6 backdrop-blur">
        <button onClick={() => nav('/lines')} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink">
          <ArrowLeft size={15} /> 线路
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <HistoryButton objType="线路" objId={line.id} objName={line.name} seed={[
              { at: line.updatedAt, action: '修改', summary: '修改：发车间隔', diff: [{ field: '上行发车间隔', from: '12–18 分钟', to: line.routes[0].interval }] },
              { at: '2026-05-18 09:20', action: '导入修改', summary: '修改：上行站序（插入 1 站）', diff: [{ field: '上行站序', from: `${line.routes[0].stopIds.length - 1} 站`, to: `${line.routes[0].stopIds.length} 站（插入第 3 站）` }] },
              { at: '2025-12-18 15:40', action: '新增', summary: '新建线路' },
            ]} />
          <Button onClick={() => toast('原型：线路表单不在 M0 范围', 'info')}>
            <Pencil size={14} /> 编辑
          </Button>
          <Button variant={suspended ? 'primary' : 'secondary'} onClick={() => setAsk(true)}>
            {suspended ? <><Play size={14} /> 恢复运营</> : <><Pause size={14} /> 停运</>}
          </Button>
          <Popover align="right" width={170} trigger={({ toggle }) => <IconButton label="更多" onClick={toggle}><MoreHorizontal size={17} /></IconButton>}>
            {(close) => (
              <MenuItem danger onClick={() => { close(); toast('原型：删除线路会连带移除各站牌集里的编排，流程不在 M0', 'info') }}>
                <Trash2 size={14} /> 删除线路
              </MenuItem>
            )}
          </Popover>
        </div>
      </div>

      <div className="px-7 pb-16">
        <header className="flex items-start gap-5 pb-6 pt-3">
          <RoutePlate name={line.name} size="xl" state={suspended ? 'suspended' : 'normal'} />
          <div className="min-w-0 pt-0.5">
            <div className="eyebrow">线路 · {line.number}</div>
            <div className="mt-1 font-display text-[22px] font-semibold leading-8">
              {line.mode === '单环' ? '环线' : `${seq[0]?.stop.name} — ${terminalOf(line.routes[0], stops)?.name}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium', suspended ? 'text-ink-3 ring-1 ring-ink-4' : 'bg-sage-soft text-sage')}>
                <span className={cn('size-1.5 rounded-full', suspended ? 'bg-ink-4' : 'bg-sage')} />
                {line.status}
              </span>
              {line.mode} · {line.company}
              <span className="italic text-ink-3">{line.nameEn}</span>
            </div>
          </div>
        </header>

        {suspended && (
          <div className="mb-6 rounded-xl bg-signal-soft px-4 py-3 text-[13.5px] text-signal-ink">
            停运中：这条线路的走向视为不经过任何站点，它在 {impacted} 个站牌集里的编排显示为失效。恢复运营后会自动恢复。
          </div>
        )}

        <section className="mb-8 grid grid-cols-2 gap-x-8">
          <div>
            <Prop label="售票类型">{line.ticket}</Prop>
            <Prop label="票制">{line.fareSystem}</Prop>
          </div>
          <div>
            <Prop label="票价">{line.fare}</Prop>
            <Prop label="公司">{line.company}</Prop>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <Segmented value={route.id} onChange={(v) => { setRouteId(v); setFocus(null) }} options={line.routes.map((r) => ({ value: r.id, label: <>{KIND_MARK[r.kind]} {r.kind}</> }))} />
            <span className="text-[12.5px] text-ink-3">{route.stopIds.length} 站</span>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {[
              ['开往', terminalOf(route, stops)?.name],
              ['服务时间', route.serviceTime],
              [route.serviceType === '定时班车' ? '班次' : '发车间隔', route.interval],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-hairline">
                <div className="text-[11.5px] text-ink-3">{k}</div>
                <div className={cn('mt-0.5 text-[14.5px] font-semibold', k === '开往' && 'font-display')}>{v}</div>
              </div>
            ))}
          </div>

          {/* 站序条形图：像站牌上的线路图 */}
          <ol className="relative" onMouseLeave={() => setHoverStop(null)}>
            {seq.map(({ stop, i }) => {
              const first = i === 0
              const last = i === seq.length - 1
              const tr = transfersAt(stop.id)
              const hov = hoverStop === stop.id
              const focused = focus === stop.id
              return (
                <li key={i}>
                  <button
                    onMouseEnter={() => setHoverStop(stop.id)}
                    onFocus={() => setHoverStop(stop.id)}
                    onClick={() => setFocus(focused ? null : stop.id)}
                    onDoubleClick={() => nav(`/stops/${stop.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        nav(`/stops/${stop.id}`)
                      }
                    }}
                    title="单击在地图上定位，双击进入站点详情"
                    aria-pressed={focused}
                    className={cn('group relative flex w-full select-none items-center gap-3 rounded-xl py-2 pl-2 pr-3 text-left transition-colors', focused ? 'bg-accent-soft/70' : hov && 'bg-surface-2')}
                  >
                    <span className="relative flex w-7 shrink-0 justify-center self-stretch">
                      {!first && <span className="absolute left-1/2 top-0 h-1/2 w-[5px] -translate-x-1/2 bg-plate" />}
                      {!last && <span className="absolute bottom-0 left-1/2 h-1/2 w-[5px] -translate-x-1/2 bg-plate" />}
                      <span
                        className={cn(
                          'relative z-[1] self-center rounded-full transition-transform duration-300 ease-[var(--bounce)]',
                          first || last ? 'size-[18px] bg-plate ring-[3px] ring-surface' : 'size-[13px] border-[3px] border-plate bg-surface',
                          (hov || focused) && 'scale-125',
                        )}
                      >
                        {(first || last) && <span className="absolute inset-[5px] rounded-full bg-coral" />}
                      </span>
                    </span>
                    <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-ink-4">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cn('truncate font-display', first || last ? 'text-[16px] font-bold' : 'text-[14.5px] font-semibold')}>{stop.name}</span>
                        <DirBadge dir={stop.direction} size="sm" />
                      </span>
                    </span>
                    <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                      {tr.slice(0, 5).map((l) => <RoutePlate key={l.id} name={l.name} size="xs" state={l.status === '停运' ? 'suspended' : 'ghost'} />)}
                      {tr.length > 5 && <span className="text-[11.5px] text-ink-3">+{tr.length - 5}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 text-[12px] text-ink-3">单击站点在地图上定位，双击进入站点详情。右侧线路牌是在该站可换乘的其他线路。</p>
        </section>
      </div>

      <Dialog
        open={ask}
        onClose={() => setAsk(false)}
        title={suspended ? `恢复 ${line.name} 运营？` : `${line.name} 停运？`}
        footer={
          <>
            <Button onClick={() => setAsk(false)}>取消</Button>
            <Button
              variant={suspended ? 'primary' : 'danger'}
              onClick={() => {
                setLineStatus(line.id, suspended ? '运营' : '停运')
                setAsk(false)
                toast(suspended ? `${line.name} 已恢复运营，相关编排已恢复` : `${line.name} 已停运，生成修改快照`)
              }}
            >
              {suspended ? '恢复运营' : '确认停运'}
            </Button>
          </>
        }
      >
        {suspended ? (
          <p>恢复后，这条线路在 {impacted} 个站牌集里的失效编排会自动恢复为已编排或隐藏。</p>
        ) : (
          <p>
            立即生效。停运后，这条线路在 <b className="text-ink">{impacted} 个站牌集</b>里的编排会显示为失效，各站也不再出现它的待编排。编排本身保留，恢复运营后自动恢复。
          </p>
        )}
      </Dialog>
    </div>
  )

  return (
    <SplitView
      storageKey="line-detail"
      defaultWidth={560}
      left={() => left}
      map={
        <MapView
          className="absolute inset-0"
          stops={stops.filter((s) => !s.deleted)}
          emphasizeIds={route.stopIds}
          selectedId={focus ?? hoverStop}
          onSelect={(sid) => setFocus(sid === focus ? null : sid)}
          routes={line.routes.map((r) => ({ id: r.id, points: routePoints(r.stopIds, stops), tone: r.id === route.id ? 'strong' : 'normal', flow: r.id === route.id && !suspended }))}
          fit={
            focusStop
              ? { key: `stop:${focusStop.id}`, points: [[focusStop.x, focusStop.y]], pad: 150 }
              : { key: route.id, points: routePoints(line.routes.flatMap((r) => r.stopIds), stops), pad: 80 }
          }
          overlay={
            focusStop && (
              <div key={focusStop.id} className="gt-rise absolute bottom-4 right-4 z-10 flex w-[320px] items-center gap-3 rounded-2xl bg-surface p-3.5 shadow-pop ring-1 ring-hairline">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-[17px] font-semibold">{focusStop.name}</span>
                    <DirBadge dir={focusStop.direction} size="sm" />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    第 {seq.findIndex((x) => x.stop.id === focusStop.id) + 1} 站 · {focusStop.road}
                  </div>
                </div>
                <Button size="sm" variant="primary" onClick={() => nav(`/stops/${focusStop.id}`)}>
                  站点详情 <ArrowUpRight size={13} />
                </Button>
                <IconButton label="取消定位" className="size-7" onClick={() => setFocus(null)}>
                  <X size={14} />
                </IconButton>
              </div>
            )
          }
        />
      }
    />
  )
}
