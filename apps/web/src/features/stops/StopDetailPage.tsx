// 站点详情（5.3.4）：独立页面，左内容、右地图。顶部返回、修改历史、编辑、站牌集；更多菜单里放删除
import {
  STOP_DIFF_SPEC,
  formatExtValue,
  stopLabel,
  type DeleteCheck,
  type ExtFieldDef,
  type StopDetail,
  type StopSection,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Copy, MoreHorizontal, Pencil, Signpost, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ReferrerList } from '@/components/gt/confirm'
import { HistoryButton } from '@/components/gt/history'
import { OrbitLoader } from '@/components/gt/lively'
import { Prop, Val } from '@/components/gt/prop'
import { SplitView } from '@/components/gt/split-view'
import { DirBadge, RoutePlate, SectionTitle, StatusChip, Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown-menu'
import { useExtFields, useLandmarks } from '@/features/common/data'
import { useSignSet } from '@/features/sign-sets/data'
import { SignSetGlance } from '@/features/sign-sets/SignSetPreview'
import { del, get, isApiError } from '@/lib/api'
import { fmtDateTime } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import { RouteLegend } from '@/map/RouteLegend'
import { isReturnKind, lineColor } from '@/map/routeStyle'
import { kindLabel, regionText, useStop } from './shared'

export function StopDetailPage() {
  const { id } = useParams()
  const q = useStop(id)
  if (q.isPending)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-3">
        <OrbitLoader size={22} /> 正在读取站点…
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-[20px] font-semibold">站点不存在</p>
        <p className="text-[13px] text-ink-3">
          它可能已经被删除。已删除的站点可以在站点列表的"已删除"视图里查看修改历史。
        </p>
        <Link to="/stops" className="text-[13px] text-accent hover:underline">
          返回站点列表
        </Link>
      </div>
    )
  return <Detail stop={q.data} />
}

function Detail({ stop }: { stop: StopDetail }) {
  const nav = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const ext = useExtFields('stop')
  const landmarks = useLandmarks()
  const [delCheck, setDelCheck] = useState<DeleteCheck | null>(null)
  // 悬停经过线路时，地图上强调该走向并显示行驶方向
  const [hoverRoute, setHoverRoute] = useState<string | null>(null)
  const label = stopLabel(stop)
  const extIn = (section: StopSection) => (ext.data ?? []).filter((f) => f.enabled && f.section === section)
  const bound = (landmarks.data ?? []).filter((l) => stop.landmarks.some((b) => b.id === l.id))

  const askDelete = async () => {
    try {
      setDelCheck(await get<DeleteCheck>(`/api/stops/${stop.id}/delete-check`))
    } catch (e) {
      toast(isApiError(e) ? e.message : '无法检查引用', 'error')
    }
  }
  const doDelete = async () => {
    try {
      await del(`/api/stops/${stop.id}`)
      setDelCheck(null)
      await qc.invalidateQueries({ queryKey: ['stops'] })
      toast('已删除站点和它的站牌集，修改历史仍可查看')
      nav('/stops')
    } catch (e) {
      toast(isApiError(e) ? e.message : '删除失败', 'error')
    }
  }

  const left = (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex h-14 items-center gap-2 bg-surface/90 px-6 backdrop-blur">
        <Link
          to="/stops"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={15} /> 站点
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <HistoryButton type="stop" id={stop.id} name={label} spec={STOP_DIFF_SPEC} />
          <Button onClick={() => nav(`/stops/${stop.id}/edit`)}>
            <Pencil size={14} /> 编辑
          </Button>
          <Button variant="primary" onClick={() => nav(`/sign-sets/${stop.id}`)}>
            <Signpost size={14} /> 站牌集
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="更多">
                <MoreHorizontal size={17} />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuItem danger onSelect={() => void askDelete()}>
                <Trash2 size={14} /> 删除站点
              </MenuItem>
            </MenuContent>
          </Menu>
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
            <span>{regionText(stop) || '未填写行政区划'}</span>
            <span className="text-ink-4">/</span>
            <span>{stop.road?.name ?? '未填写路段'}</span>
            <span className="text-ink-4">/</span>
            <span className="text-ink-3">最近修改 {fmtDateTime(stop.updatedAt)}</span>
          </div>
        </header>

        <section className="mb-8">
          <SectionTitle
            count={stop.routes.length}
            extra={
              stop.routes.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => nav(`/lines?stopId=${stop.id}`)}>
                  在线路列表查看 <ArrowUpRight size={13} />
                </Button>
              )
            }
          >
            经过线路
          </SectionTitle>
          <ul className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            {stop.routes.map((r) => (
              <li key={r.routeId}>
                <Link
                  to={`/lines/${r.lineId}`}
                  onMouseEnter={() => setHoverRoute(r.routeId)}
                  onMouseLeave={() => setHoverRoute(null)}
                  onFocus={() => setHoverRoute(r.routeId)}
                  onBlur={() => setHoverRoute(null)}
                  className="group flex items-center gap-3 border-b border-hairline px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <RoutePlate
                    name={r.lineName}
                    color={lineColor(r.lineId)}
                    state={r.suspended ? 'suspended' : 'normal'}
                  />
                  <span className="w-14 text-[12.5px] text-ink-2">{kindLabel(r.routeKind)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">
                    <span className="text-ink-3">开往 </span>
                    <span className="font-display font-semibold">{r.terminal}</span>
                  </span>
                  {r.suspended && <Tag>停运</Tag>}
                  <ArrowUpRight
                    size={15}
                    className="text-ink-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </Link>
              </li>
            ))}
            {stop.routes.length === 0 && (
              <li className="px-4 py-6 text-center text-[13px] text-ink-3">没有线路经过这个站点</li>
            )}
          </ul>
        </section>

        <SignSetSection stop={stop} onOpen={() => nav(`/sign-sets/${stop.id}`)} />

        <section className="mb-8">
          <SectionTitle>位置</SectionTitle>
          <Prop label="坐标">
            <span className="inline-flex items-center gap-2 font-mono text-[12.5px]">
              {stop.lng.toFixed(6)}, {stop.lat.toFixed(6)}
              <IconButton
                label="复制坐标"
                className="size-6"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${stop.lng.toFixed(6)},${stop.lat.toFixed(6)}`)
                  toast('已复制坐标')
                }}
              >
                <Copy size={13} />
              </IconButton>
            </span>
          </Prop>
          <Prop label="市 / 区 / 街道">
            <Val>{regionText(stop)}</Val>
          </Prop>
          <Prop label="路段">
            <Val>{stop.road?.name}</Val>
          </Prop>
          <Prop label="地标">
            <span className="flex flex-wrap gap-1.5">
              {stop.landmarks.length ? (
                stop.landmarks.map((l) => (
                  <Tag key={l.id} className="bg-sage-soft text-ink">
                    <span className="mr-1 text-sage">{l.category}</span>
                    {l.name}
                  </Tag>
                ))
              ) : (
                <Val>{''}</Val>
              )}
            </span>
          </Prop>
          <Prop label="二维码 URL">
            <Val>{stop.qrUrl}</Val>
          </Prop>
          <ExtProps fields={extIn('basic')} values={stop.ext} />
        </section>

        <section className="mb-8">
          <SectionTitle>站台设施</SectionTitle>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Prop label="站台类型">
                <Val>{stop.facilities.platformType?.name}</Val>
              </Prop>
              <Prop label="泊位数">
                <Val>{stop.facilities.berths}</Val>
              </Prop>
              <Prop label="候车亭类型">
                <Val>{stop.facilities.shelterType?.name}</Val>
              </Prop>
              <Prop label="候车设施">
                <Val>{stop.facilities.waiting}</Val>
              </Prop>
            </div>
            <div>
              <Prop label="安全设施">
                <Val>{stop.facilities.safety?.name}</Val>
              </Prop>
              <Prop label="大灯箱数">
                <Val>{stop.facilities.bigLightbox}</Val>
              </Prop>
              <Prop label="小灯箱数">
                <Val>{stop.facilities.smallLightbox}</Val>
              </Prop>
              <Prop label="座椅数">
                <Val>{stop.facilities.seats}</Val>
              </Prop>
            </div>
          </div>
          <ExtProps fields={extIn('facility')} values={stop.ext} />
        </section>

        <section className="mb-8">
          <SectionTitle>其他</SectionTitle>
          <Prop label="维护公司">
            <Val>{stop.maintainer?.name}</Val>
          </Prop>
          <Prop label="备注" align="start">
            <span className="whitespace-pre-wrap">
              <Val>{stop.remark}</Val>
            </span>
          </Prop>
          <ExtProps fields={extIn('other')} values={stop.ext} />
        </section>

        {stop.photos.length > 0 && (
          <section className="mb-8">
            <SectionTitle count={stop.photos.length}>照片</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {stop.photos.map((p) => (
                <a
                  key={p.id}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block h-24 w-32 overflow-hidden rounded-xl ring-1 ring-hairline"
                >
                  <img src={p.url} alt={p.originalName} className="size-full object-cover" />
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      <Dialog
        open={Boolean(delCheck)}
        onOpenChange={(o) => !o && setDelCheck(null)}
        title={delCheck?.canDelete ? `删除「${label}」？` : '这个站点还不能删除'}
        footer={
          delCheck?.canDelete ? (
            <>
              <Button onClick={() => setDelCheck(null)}>取消</Button>
              <Button variant="danger" onClick={() => void doDelete()}>
                删除站点和站牌集
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setDelCheck(null)}>
              知道了
            </Button>
          )
        }
      >
        {delCheck?.canDelete ? (
          <p>
            删除站点会同时删除它的站牌集（站架、站牌、插片、编排）。两者的修改历史都会保留，可在"已删除的站点"里查看。
          </p>
        ) : (
          <>
            <p>它仍被这些线路的站序引用。先在线路里移除这个站点，再回来删除。</p>
            {delCheck && <ReferrerList referrers={delCheck.referrers} />}
          </>
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
          points={[{ id: stop.id, lng: stop.lng, lat: stop.lat, label: stop.name, sub: stop.direction }]}
          selectedId={stop.id}
          circles={bound.flatMap((l) =>
            l.points.map((p) => ({ id: p.id, lng: p.lng, lat: p.lat, radius: p.radius, label: l.name })),
          )}
          routes={stop.routes.map((r) => ({
            id: r.routeId,
            points: r.path,
            color: lineColor(r.lineId),
            hollow: isReturnKind(r.routeKind),
            tone: hoverRoute === r.routeId ? 'strong' : hoverRoute ? 'faint' : 'normal',
            flow: hoverRoute === r.routeId && !r.suspended,
          }))}
          fit={{ key: stop.id, points: [[stop.lng, stop.lat]] }}
          overlay={
            <RouteLegend
              routes={stop.routes.map((r) => ({ kind: r.routeKind, road: false }))}
              dashedText="虚线：按站点连线"
            />
          }
        />
      }
    />
  )
}

function ExtProps({ fields, values }: { fields: ExtFieldDef[]; values: Record<string, unknown> }): ReactNode {
  return fields.map((f) => (
    <Prop
      key={f.key}
      label={
        <span className="inline-flex items-center gap-1.5">
          {f.name} <Tag className="h-4 px-1.5 text-[10.5px]">扩展</Tag>
        </span>
      }
    >
      <Val>{formatExtValue(values[f.key])}</Val>
    </Prop>
  ))
}

/** "站牌集"一节：紧凑比例的只读立面加计数；按钮"编排"进编辑器；没有站架时显示空状态插画 */
function SignSetSection({ stop, onOpen }: { stop: StopDetail; onOpen: () => void }) {
  const ss = useSignSet(stop.id)
  const c = stop.signSet
  return (
    <section className="mb-8">
      <SectionTitle
        count={c.shelves ? `${c.shelves} 个站架 · ${c.boards} 块站牌` : undefined}
        extra={
          <Button size="sm" variant={c.waiting + c.invalid ? 'primary' : 'ghost'} onClick={onOpen}>
            <Signpost size={13} /> 编排
          </Button>
        }
      >
        站牌集
      </SectionTitle>
      {(c.waiting > 0 || c.invalid > 0) && (
        <div className="mb-2 flex items-center gap-1.5">
          {c.waiting > 0 && <StatusChip status="待编排" count={c.waiting} size="sm" />}
          {c.invalid > 0 && <StatusChip status="失效" count={c.invalid} size="sm" />}
        </div>
      )}
      <div className="overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] ring-1 ring-hairline">
        {ss.data ? (
          <SignSetGlance view={ss.data} zoom="compact" />
        ) : (
          <div className="flex items-center gap-2 p-6 text-[13px] text-ink-3">
            <OrbitLoader size={18} /> 正在读取站牌集…
          </div>
        )}
      </div>
    </section>
  )
}
