// 站牌集预览抽屉（需求 5.5.5）：与编辑器同一个立面组件，只读；顶部站名、方位章、计数、温馨提示
import { countsOf, poolOf, type SignSetView } from '@gentransit/shared'
import { ArrowUpRight, NotebookPen, Signpost } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Elevation, ZOOM_LABEL, useStoredZoom, type Zoom } from '@/components/gt/elevation'
import { EmptyShelfArt, OrbitLoader } from '@/components/gt/lively'
import { DirBadge, Segmented, StatusChip } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useSignSet } from './data'

/** 只读立面 + 计数；站点详情"站牌集"一节也用它 */
export function SignSetGlance({ view, zoom = 'compact' }: { view: SignSetView; zoom?: Zoom }) {
  const pool = useMemo(() => poolOf(view, view.passages, view.routes), [view])
  return (
    <Elevation
      draft={view}
      pool={pool}
      zoom={zoom}
      empty={
        <div className="flex flex-col items-center gap-2 py-8 text-center text-[12.5px] text-ink-3">
          <EmptyShelfArt className="h-[72px] w-[96px]" />
          还没有站架。站架、站牌与线路编排在站牌集编辑器里维护。
        </div>
      }
    />
  )
}

export function SignSetPreview({
  stopId,
  onOpenChange,
}: {
  stopId: string | null
  onOpenChange: (o: boolean) => void
}) {
  const q = useSignSet(stopId ?? undefined)
  const [zoom, setZoom] = useStoredZoom()
  const v = q.data
  const counts = v ? countsOf(poolOf(v, v.passages, v.routes)) : null
  return (
    <Sheet
      open={Boolean(stopId)}
      onOpenChange={onOpenChange}
      width={780}
      title={
        v ? (
          <span className="flex items-center gap-2">
            <span className="font-display text-[20px] font-bold">{v.stop.name}</span>
            <DirBadge dir={v.stop.direction} />
            <span className="text-[13px] font-normal text-ink-3">站牌集</span>
          </span>
        ) : (
          '站牌集'
        )
      }
      description={
        v ? `${v.shelves.length} 个站架 · ${v.shelves.reduce((n, s) => n + s.boards.length, 0)} 块站牌` : undefined
      }
      footer={
        v && (
          <>
            <Button asChild variant="ghost">
              <Link to={`/stops/${v.stop.id}`}>
                站点详情 <ArrowUpRight size={14} />
              </Link>
            </Button>
            <Button asChild variant="primary">
              <Link to={`/sign-sets/${v.stop.id}`}>
                <Signpost size={14} /> 编排
              </Link>
            </Button>
          </>
        )
      }
    >
      {!v ? (
        <div className="flex items-center gap-2 py-10 text-ink-3">
          <OrbitLoader size={22} /> 正在读取站牌集…
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusChip status="待编排" count={counts!.waiting} />
            <StatusChip status="失效" count={counts!.invalid} />
            <StatusChip status="已编排" count={counts!.placed} size="sm" />
            <StatusChip status="隐藏" count={counts!.hidden} size="sm" />
            <span className="ml-auto">
              <Segmented<Zoom>
                size="sm"
                label="立面比例"
                value={zoom}
                onChange={setZoom}
                options={(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => ({ value: z, label: ZOOM_LABEL[z] }))}
              />
            </span>
          </div>
          {v.reminder && (
            <div className="flex items-start gap-2 rounded-xl bg-signal-soft/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink ring-1 ring-signal/25">
              <NotebookPen size={14} className="mt-0.5 shrink-0 text-signal-ink" />
              <span>{v.reminder}</span>
            </div>
          )}
          <div className="rounded-2xl bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] ring-1 ring-hairline">
            <SignSetGlance view={v} zoom={zoom} />
          </div>
        </div>
      )}
    </Sheet>
  )
}
