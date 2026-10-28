// PROTOTYPE — 站点详情（独立页面）：左侧信息，右侧地图（与列表同一套分栏）
import { ArrowLeft, ArrowUpRight, Copy, MoreHorizontal, Pencil, Signpost, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LANDMARKS } from '../data/mock'
import { useDebug, useStore } from '../data/store'
import { cnNum } from '../lib/domain'
import { MapView, routePoints } from '../map/MapView'
import { SplitView } from '../shell/SplitView'
import { Button, Dialog, DirBadge, IconButton, MenuItem, Popover, Prop, RoutePlate, SectionTitle, StatusChip, Tag, cn, useToast } from '../ui'
import { HistoryButton, KIND_MARK, linesAt, terminalOf, useSignSetSummary } from './shared'

export function StopDetailPage() {
  const { id } = useParams()
  const { stops, lines, deleteStop } = useStore()
  const stop = stops.find((s) => s.id === id)
  const nav = useNavigate()
  const toast = useToast()
  const [hoverRoute, setHoverRoute] = useState<string | null>(null)
  const [askDel, setAskDel] = useState<null | 'ok' | string>(null)
  const sum = useSignSetSummary(id!)
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 页面: '站点详情', 站点: stop }), [stop])

  if (!stop) return <div className="p-10 text-center text-ink-3">站点不存在</div>

  const passing = linesAt(stop.id, lines)
  const lms = LANDMARKS.filter((l) => stop.landmarkIds.includes(l.id))
  const routes = passing.map(({ line, route }) => ({
    id: route.id,
    points: routePoints(route.stopIds, stops),
    tone: (hoverRoute === route.id ? 'strong' : hoverRoute ? 'faint' : 'normal') as 'strong' | 'normal' | 'faint',
    flow: hoverRoute === route.id,
  }))
  const hovered = passing.find((p) => p.route.id === hoverRoute)

  const tryDelete = () => {
    const used = lines.filter((l) => l.routes.some((r) => r.stopIds.includes(stop.id)))
    setAskDel(used.length ? used.map((l) => l.name).join('、') : 'ok')
  }

  const f = stop.facilities
  const num = (v: number | null) => (v === null || v === undefined ? '—' : v)

  const left = (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-surface/90 px-6 backdrop-blur">
        <button onClick={() => nav('/stops')} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink">
          <ArrowLeft size={15} /> 站点
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <HistoryButton
            objType="站点"
            objId={stop.id}
            objName={`${stop.name}（${stop.direction}）`}
            seed={[
              { at: stop.updatedAt, action: '修改', summary: '修改：备注、站台设施', diff: [{ field: '备注', from: '', to: stop.remark || '地铁 2 号线 B 口出站即到' }, { field: '座椅', from: '2', to: String(stop.facilities.seats ?? 4) }] },
              { at: '2026-03-02 10:12', action: '导入修改', summary: '修改：经度、纬度', diff: [{ field: '经度', from: (stop.lng - 0.0004).toFixed(6), to: stop.lng.toFixed(6) }, { field: '纬度', from: (stop.lat + 0.0002).toFixed(6), to: stop.lat.toFixed(6) }] },
              { at: '2025-12-18 15:40', action: '新增', summary: '新建站点，并创建空站牌集' },
            ]}
          />
          {!stop.deleted && (
          <>
            <Button onClick={() => nav(`/stops/${stop.id}/edit`)}>
              <Pencil size={14} /> 编辑
            </Button>
            <Button variant="primary" onClick={() => nav(`/sign-sets/${stop.id}`)}>
              <Signpost size={14} /> 站牌集
            </Button>
            <Popover align="right" width={180} trigger={({ toggle }) => <IconButton label="更多" onClick={toggle}><MoreHorizontal size={17} /></IconButton>}>
              {(close) => (
                <MenuItem danger onClick={() => { close(); tryDelete() }}>
                  <Trash2 size={14} /> 删除站点
                </MenuItem>
              )}
            </Popover>
          </>
          )}
        </div>
      </div>

      <div className="px-7 pb-16">
        <header className="pb-6 pt-3">
          <div className="eyebrow">站点</div>
          <div className="mt-1.5 flex items-center gap-3">
            <h1 className="font-display text-[32px] font-bold leading-10 tracking-wide">{stop.name}</h1>
            <DirBadge dir={stop.direction} size="lg" />
          </div>
          <div className="mt-1 text-[14px] italic text-ink-3">{stop.nameEn || '—'}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span>{stop.city} · {stop.district} · {stop.street}</span>
            <span className="text-ink-4">/</span>
            <span>{stop.road}</span>
            <span className="text-ink-4">/</span>
            <span className="text-ink-3">最近修改 {stop.updatedAt}</span>
          </div>
          {stop.deleted && (
            <div className="mt-4 rounded-xl bg-danger-soft px-4 py-3 text-[13.5px] text-danger">这个站点已经删除。下面是删除前最后一份快照里的内容，修改历史仍然保留。</div>
          )}
        </header>

        <section className="mb-8">
          <SectionTitle count={passing.length}>经过线路</SectionTitle>
          <ul className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            {passing.map(({ line, route }) => (
              <li key={route.id}>
                <button
                  onMouseEnter={() => setHoverRoute(route.id)}
                  onMouseLeave={() => setHoverRoute(null)}
                  onFocus={() => setHoverRoute(route.id)}
                  onBlur={() => setHoverRoute(null)}
                  onClick={() => nav(`/lines/${line.id}`)}
                  className="group flex w-full items-center gap-3 border-b border-hairline px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2"
                >
                  <RoutePlate name={line.name} state={line.status === '停运' ? 'suspended' : 'normal'} />
                  <span className="w-12 text-[12.5px] text-ink-2">
                    {KIND_MARK[route.kind]} {route.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">
                    <span className="text-ink-3">开往 </span>
                    <span className="font-display font-semibold">{terminalOf(route, stops)?.name}</span>
                  </span>
                  {line.status === '停运' && <Tag>停运</Tag>}
                  <ArrowUpRight size={15} className="text-ink-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
                </button>
              </li>
            ))}
            {passing.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-ink-3">没有线路经过这个站点</li>}
          </ul>
        </section>

        <section className="mb-8">
          <SectionTitle
            extra={
              !stop.deleted && (
                <Button size="sm" variant="ghost" onClick={() => nav(`/sign-sets/${stop.id}`)}>
                  打开编辑器 <ArrowUpRight size={13} />
                </Button>
              )
            }
          >
            站牌集
          </SectionTitle>
          <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-hairline">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {sum.wait > 0 && <StatusChip status="待编排" count={sum.wait} />}
              {sum.bad > 0 && <StatusChip status="失效" count={sum.bad} />}
              <StatusChip status="已编排" count={sum.done} />
            </div>
            {sum.ss.shelves.length ? (
              <div className="flex flex-wrap items-end gap-4">
                {sum.ss.shelves.map((sh) => (
                  <div key={sh.id} className="flex flex-col gap-1.5">
                    <div className="flex items-end gap-1.5">
                      {sh.boards.map((b) => (
                        <div key={b.id} title={`${cnNum(b.no)}号牌 · ${b.face} · ${b.kind} ${b.w}×${b.h}`} className="flex items-start justify-center rounded-[4px] bg-surface pt-1 text-[10px] text-ink-3 ring-1 ring-hairline-2" style={{ width: b.w / 22, height: b.h / 22 }}>
                          {cnNum(b.no)}
                        </div>
                      ))}
                    </div>
                    <div className="h-[3px] rounded-full bg-hairline-2" />
                    <div className="text-[12px] text-ink-2">
                      {cnNum(sh.no)}号架 <span className="text-ink-3">· {sh.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[13px] text-ink-3">还没有站架。打开编辑器，从站架模板一键生成。</div>
            )}
          </div>
        </section>

        <section className="mb-8">
          <SectionTitle>位置</SectionTitle>
          <Prop label="坐标">
            <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
              {stop.lng.toFixed(6)}, {stop.lat.toFixed(6)}
              <IconButton label="复制坐标" className="size-6" onClick={() => toast('已复制坐标')}>
                <Copy size={13} />
              </IconButton>
            </span>
          </Prop>
          <Prop label="区 / 街道">{stop.district} · {stop.street}</Prop>
          <Prop label="路段">{stop.road}</Prop>
          <Prop label="地标">
            <span className="flex flex-wrap gap-1.5">
              {lms.length ? lms.map((l) => <Tag key={l.id}>{l.category} · {l.name}</Tag>) : <span className="text-ink-3">—</span>}
            </span>
          </Prop>
        </section>

        <section className="mb-8">
          <SectionTitle>站台设施</SectionTitle>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Prop label="站台类型">{f.platformType || '—'}</Prop>
              <Prop label="泊位数">{num(f.berths)}</Prop>
              <Prop label="候车亭">{f.shelterType || '—'}</Prop>
              <Prop label="候车设施">{f.waiting || '—'}</Prop>
            </div>
            <div>
              <Prop label="安全设施">{f.safety || '—'}</Prop>
              <Prop label="大灯箱">{num(f.bigLightbox)}</Prop>
              <Prop label="小灯箱">{num(f.smallLightbox)}</Prop>
              <Prop label="座椅">{num(f.seats)}</Prop>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <SectionTitle>其他</SectionTitle>
          <Prop label="维护公司">{stop.maintainer}</Prop>
          <Prop label="养护片区">
            解放片区 <Tag className="ml-1">扩展字段</Tag>
          </Prop>
          <Prop label="二维码">{stop.qrUrl || <span className="text-ink-3">—</span>}</Prop>
          <Prop label="备注" align="start">{stop.remark || <span className="text-ink-3">—</span>}</Prop>
        </section>

        {stop.photos > 0 && (
          <section className="mb-8">
            <SectionTitle count={stop.photos}>照片</SectionTitle>
            <div className="flex gap-2">
              {Array.from({ length: stop.photos }, (_, i) => (
                <div key={i} className="h-24 w-32 rounded-xl ring-1 ring-hairline" style={{ background: ['#d9cbb4', '#c9d2c0', '#d6c2b0', '#c4cfcb'][i % 4] }} />
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog
        open={!!askDel}
        onClose={() => setAskDel(null)}
        title={askDel === 'ok' ? `删除「${stop.name}（${stop.direction}）」？` : '这个站点还不能删除'}
        footer={
          askDel === 'ok' ? (
            <>
              <Button onClick={() => setAskDel(null)}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  deleteStop(stop.id)
                  setAskDel(null)
                  toast('已删除站点和它的站牌集，修改历史仍可查看')
                }}
              >
                删除站点和站牌集
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setAskDel(null)}>知道了</Button>
          )
        }
      >
        {askDel === 'ok' ? (
          <p>站牌集（站架、站牌、插片、编排）会一起删除。两者的修改历史都会保留。</p>
        ) : (
          <p>
            它仍被这些线路的站序引用：<b className="text-ink">{askDel}</b>。先在线路里移除这个站点，再回来删除。
          </p>
        )}
      </Dialog>
    </div>
  )

  return (
    <SplitView
      storageKey="stop-detail"
      defaultWidth={560}
      left={() => left}
      map={
        <MapView
          className="absolute inset-0"
          stops={stops.filter((s) => !s.deleted || s.id === stop.id)}
          selectedId={stop.id}
          emphasizeIds={hovered ? hovered.route.stopIds : undefined}
          routes={routes}
          showLandmarks
          landmarkIds={stop.landmarkIds}
          onSelect={(sid) => sid !== stop.id && nav(`/stops/${sid}`)}
          fit={{ key: stop.id, points: [[stop.x, stop.y]], pad: 170 }}
          overlay={
            hovered && (
              <div className="pointer-events-none absolute left-3 top-14 flex items-center gap-2 rounded-xl bg-surface/95 px-3 py-2 text-[13px] shadow-float ring-1 ring-hairline backdrop-blur">
                <RoutePlate name={hovered.line.name} size="sm" />
                {hovered.route.kind} · 开往 <span className="font-display font-semibold">{terminalOf(hovered.route, stops)?.name}</span>
                <span className={cn('text-ink-3')}>· {hovered.route.stopIds.length} 站</span>
              </div>
            )
          }
        />
      }
    />
  )
}
