// 工作台（需求 5.2，M3 计划 4.4）：暖纸底，一屏三块——待处理（主角）、最近修改（时间轴）、快捷新建；
// 备份过期或失败时顶部一条赭石色提醒（M4 计划 5.5 节）。
// 不做成通用卡片仪表盘：待处理用衬线大数字加赭石呼吸点；最近修改沿用修改历史的轨道与圆点
import {
  LINE_DIFF_SPEC,
  OBJECT_TYPE_LABEL,
  SIGN_SET_DIFF_SPEC,
  SNAPSHOT_ACTION_LABEL,
  STOP_DIFF_SPEC,
  type ObjectType,
  type RecentChange,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bus, MapPin, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { HistoryDialog } from '@/components/gt/history'
import { BreathingDot, OrbitLoader, SnapshotStack } from '@/components/gt/lively'
import { DirBadge, RoutePlate, StatusChip, Tag } from '@/components/gt/symbols'
import { BackupAlert } from '@/features/settings/BackupTab'
import { useSignSetList, useSignSetSummary } from '@/features/sign-sets/data'
import { get } from '@/lib/api'
import { cn, fmtDateTime } from '@/lib/utils'

const SPEC = { stop: STOP_DIFF_SPEC, line: LINE_DIFF_SPEC, signSet: SIGN_SET_DIFF_SPEC }
const WEEK = '日一二三四五六'

/** 空状态：手绘站牌缓慢浮动，牌上一枚鼠尾草对勾 */
function AllSetArt() {
  const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 160 120" width={150} height={112} aria-hidden="true" className="overflow-visible">
      <ellipse cx="80" cy="110" rx="50" ry="5" fill="var(--ink)" fillOpacity="0.06" />
      <line x1="58" y1="108" x2="58" y2="70" stroke="var(--ink-3)" {...s} />
      <line x1="102" y1="108" x2="102" y2="70" stroke="var(--ink-3)" {...s} />
      <g className="gt-float">
        <rect x="44" y="14" width="72" height="62" rx="7" fill="var(--surface)" stroke="var(--ink)" {...s} />
        <rect x="44" y="14" width="72" height="13" rx="6" fill="var(--plate)" />
        <rect x="52" y="35" width="20" height="8" rx="2.5" fill="var(--plate)" />
        <line x1="77" y1="39" x2="106" y2="39" stroke="var(--ink-3)" {...s} />
        <rect x="52" y="50" width="20" height="8" rx="2.5" fill="var(--plate)" fillOpacity="0.55" />
        <line x1="77" y1="54" x2="100" y2="54" stroke="var(--ink-3)" {...s} />
        <circle cx="114" cy="16" r="11" fill="var(--sage-soft)" stroke="var(--sage)" {...s} />
        <path
          d="M109 16.5 L112.5 19.8 C114 16.8 116 14 119 12.6"
          fill="none"
          stroke="var(--sage)"
          {...s}
          strokeWidth={2}
        />
      </g>
    </svg>
  )
}

function Pending() {
  const summary = useSignSetSummary()
  const top = useSignSetList({ pending: '1', sort: '-pending', size: 5, page: 1 })
  const nav = useNavigate()
  const s = summary.data
  return (
    <section aria-labelledby="pending-title" className="flex min-h-0 flex-col">
      <div className="eyebrow" id="pending-title">
        待处理的站牌集
      </div>
      {!s ? (
        <div className="mt-6 flex items-center gap-2 text-ink-3">
          <OrbitLoader size={20} /> 正在计算…
        </div>
      ) : s.pendingSets === 0 ? (
        <div className="mt-4 flex items-center gap-6" data-testid="home-all-done">
          <AllSetArt />
          <div>
            <div className="font-display text-[22px] font-semibold">所有站牌集都已编排妥当</div>
            <p className="mt-1 text-[13px] text-ink-3">{s.signSets} 个站牌集里，没有待编排或失效的线路。</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 flex items-end gap-3">
            <span
              className="font-display text-[88px] font-bold leading-[0.9] tracking-tight text-ink tabular-nums"
              data-testid="home-pending-count"
            >
              {s.pendingSets}
            </span>
            <span className="mb-3 flex items-center gap-2 text-[14px] text-ink-2">
              <BreathingDot />
              个站牌集要处理
            </span>
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            待编排 <b className="font-semibold text-signal-ink tabular-nums">{s.waiting}</b> 条 · 失效{' '}
            <b className="font-semibold text-danger tabular-nums">{s.invalid}</b> 条 · 共 {s.signSets} 个站牌集
          </p>
          <ol className="mt-5 flex flex-col">
            {(top.data?.items ?? []).map((x, i) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => nav(`/sign-sets/${x.stop.id}`)}
                  className="group flex w-full items-center gap-3 border-b border-dashed border-hairline-2 py-2.5 text-left last:border-0"
                >
                  <span className="w-5 text-right font-mono text-[12px] text-ink-4">{i + 1}</span>
                  <span className="truncate font-display text-[16px] font-semibold group-hover:text-accent">
                    {x.stop.name}
                  </span>
                  <DirBadge dir={x.stop.direction} size="sm" />
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {x.waiting > 0 && <StatusChip status="待编排" count={x.waiting} size="sm" />}
                    {x.invalid > 0 && <StatusChip status="失效" count={x.invalid} size="sm" />}
                  </span>
                  <ArrowRight
                    size={15}
                    className="shrink-0 text-ink-4 transition-transform duration-300 ease-[var(--spring)] group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </button>
              </li>
            ))}
          </ol>
          <Link
            to="/sign-sets?pending=1&sort=-pending"
            className="mt-3 inline-flex items-center gap-1 self-start text-[13px] font-medium text-accent underline-offset-2 hover:underline"
          >
            查看全部 {s.pendingSets} 个 <ArrowRight size={13} />
          </Link>
        </>
      )}
    </section>
  )
}

function objectLink(r: RecentChange) {
  if (!r.exists) return null
  if (r.objectType === 'stop') return `/stops/${r.objectId}`
  if (r.objectType === 'line') return `/lines/${r.objectId}`
  return r.stopId ? `/sign-sets/${r.stopId}` : null
}

function Recent() {
  const q = useQuery({
    queryKey: ['snapshots', 'recent'],
    queryFn: () => get<RecentChange[]>('/api/snapshots/recent', { limit: 20 }),
  })
  const nav = useNavigate()
  const [hist, setHist] = useState<RecentChange | null>(null)
  const items = q.data ?? []
  return (
    <section aria-labelledby="recent-title" className="flex min-h-0 flex-col">
      <div className="eyebrow" id="recent-title">
        最近修改
      </div>
      {q.isPending ? (
        <div className="mt-6 flex items-center gap-2 text-ink-3">
          <OrbitLoader size={20} /> 正在读取…
        </div>
      ) : items.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink-3">还没有修改记录。</p>
      ) : (
        <ol className="relative mt-3 min-h-0 flex-1 overflow-auto pr-2" aria-label="最近修改时间轴">
          {items.map((r, i) => {
            const link = objectLink(r)
            const last = i === items.length - 1
            const dot =
              r.action === 'delete'
                ? 'bg-danger'
                : r.action === 'create' || r.action === 'importCreate'
                  ? 'bg-sage'
                  : r.action === 'cascadeUpdate'
                    ? 'bg-signal'
                    : 'bg-plate'
            const [date, time] = fmtDateTime(r.createdAt).split(' ')
            return (
              <li key={r.snapshotId} className="relative grid grid-cols-[64px_20px_1fr] gap-x-2">
                <div className="pt-1 text-right">
                  <div className="text-[12.5px] font-semibold tabular-nums text-ink">{date.slice(5)}</div>
                  <div className="text-[11px] tabular-nums text-ink-3">{time}</div>
                </div>
                <div className="relative flex justify-center">
                  {!last && <span className="absolute bottom-0 top-3 w-[2px] rounded-full bg-hairline-2" />}
                  <span className={cn('relative mt-2 size-2.5 rounded-full ring-4 ring-paper', dot)} />
                </div>
                <div className={cn('group min-w-0', last ? 'pb-1' : 'pb-4')}>
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] text-ink-3">{OBJECT_TYPE_LABEL[r.objectType as ObjectType]}</span>
                    <button
                      type="button"
                      disabled={!link}
                      onClick={() => link && nav(link)}
                      className="flex min-w-0 items-center gap-1.5 text-left enabled:hover:text-accent disabled:cursor-default"
                      title={link ? '打开' : '对象已删除，只能查看修改历史'}
                    >
                      {r.objectType === 'line' ? (
                        <RoutePlate name={r.objectName} size="sm" state={r.exists ? 'normal' : 'ghost'} />
                      ) : (
                        <span
                          className={cn(
                            'truncate font-display text-[14.5px] font-semibold',
                            !r.exists && 'text-ink-3 line-through decoration-1',
                          )}
                        >
                          {r.objectName}
                        </span>
                      )}
                    </button>
                    <Tag className={r.action === 'delete' ? 'bg-danger-soft text-danger' : undefined}>
                      {SNAPSHOT_ACTION_LABEL[r.action]}
                    </Tag>
                    <button
                      type="button"
                      aria-label={`${r.objectName} 的修改历史`}
                      title="修改历史"
                      onClick={() => setHist(r)}
                      className="ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg opacity-60 hover:bg-sunken group-hover:opacity-100"
                    >
                      <SnapshotStack size={15} />
                    </button>
                  </div>
                  {r.note && <p className="mt-0.5 truncate text-[12.5px] text-ink-2">{r.note}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {hist && (
        <HistoryDialog
          open
          onOpenChange={(o) => !o && setHist(null)}
          type={hist.objectType}
          id={hist.objectId}
          name={hist.objectType === 'signSet' ? `${hist.objectName}站牌集` : hist.objectName}
          spec={SPEC[hist.objectType]}
        />
      )}
    </section>
  )
}

function Quick({ to, icon, title, sub }: { to: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <Link
      to={to}
      className="group flex flex-1 items-center gap-3 rounded-2xl border border-dashed border-hairline-2 px-4 py-3 transition-colors hover:border-accent/50 hover:bg-surface"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[14px] font-semibold">
          <Plus size={13} /> {title}
        </span>
        <span className="block text-[12px] text-ink-3">{sub}</span>
      </span>
      <ArrowRight size={15} className="ml-auto text-ink-4 group-hover:text-accent" />
    </Link>
  )
}

export function HomePage() {
  const now = new Date()
  return (
    <div className="flex h-full flex-col bg-[radial-gradient(ellipse_at_top_left,var(--surface)_0%,var(--surface-2)_45%,var(--paper)_120%)]">
      <div className="px-10 pb-2 pt-8">
        <h1 className="font-display text-[26px] font-semibold leading-9">工作台</h1>
        <p className="text-[13px] text-ink-3">
          {now.getFullYear()} 年 {now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{WEEK[now.getDay()]}
        </p>
      </div>
      <BackupAlert />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-12 px-10 pb-8 pt-4">
        <div className="flex min-h-0 flex-col gap-8">
          <Pending />
          <section aria-label="快捷新建" className="mt-auto">
            <div className="eyebrow mb-2">快捷新建</div>
            <div className="flex gap-3">
              <Quick to="/stops/new" icon={<MapPin size={17} />} title="新建站点" sub="同时创建空站牌集" />
              <Quick to="/lines/new" icon={<Bus size={17} />} title="新建线路" sub="站序加入的站点出现待编排" />
            </div>
          </section>
        </div>
        <div className="flex min-h-0 flex-col border-l border-dashed border-hairline-2 pl-10">
          <Recent />
        </div>
      </div>
    </div>
  )
}
