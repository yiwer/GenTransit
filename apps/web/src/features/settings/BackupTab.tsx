// 设置 → 备份（M4 计划 5.5 节，只读）：最近一次成功、30 天日历条、恢复命令提示；
// 工作台在备份过期或失败时显示赭石色提醒条（BackupAlert）
import type { BackupDay, BackupStatus } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, BookOpen, DatabaseBackup } from 'lucide-react'
import { Link } from 'react-router'
import { OrbitLoader } from '@/components/gt/lively'
import { PageHeader } from '@/components/gt/symbols'
import { get } from '@/lib/api'
import { cn, fmtBytes, fmtDateTime, fmtRelative } from '@/lib/utils'

export const backupKeys = ['system', 'backup'] as const

export const useBackupStatus = () =>
  useQuery({ queryKey: backupKeys, queryFn: () => get<BackupStatus>('/api/system/backup'), staleTime: 60_000 })

const MANUAL = 'docs/deploy.md'
const STATUS_LABEL = { ok: '成功', failed: '失败', missing: '没有备份' } as const

/** 30 天日历条：一排略有起伏的小圆点。成功为鼠尾草色实心，失败为陶土色，缺失留空 */
export function BackupCalendar({ days }: { days: BackupDay[] }) {
  const step = 22
  const w = days.length * step + 8
  return (
    <svg
      viewBox={`0 0 ${w} 58`}
      width="100%"
      style={{ maxWidth: w }}
      role="img"
      aria-label={`最近 ${days.length} 天的备份：成功 ${days.filter((d) => d.status === 'ok').length} 天`}
      className="overflow-visible"
    >
      {/* 一条手绘感的细线把圆点串起来 */}
      <path
        d={days.map((_, i) => `${i ? 'L' : 'M'}${12 + i * step} ${22 + Math.sin(i * 0.9) * 2.2}`).join(' ')}
        fill="none"
        stroke="var(--hairline-2)"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {days.map((d, i) => {
        const x = 12 + i * step
        const y = 22 + Math.sin(i * 0.9) * 2.2
        const today = i === days.length - 1
        const label = `${d.date} ${STATUS_LABEL[d.status]}${d.size !== null ? ` · ${fmtBytes(d.size)}` : ''}`
        return (
          <g key={d.date} data-testid={`backup-day-${d.status}`}>
            <title>{label}</title>
            {d.status === 'ok' && (
              <circle cx={x} cy={y} r={today ? 7.5 : 6.5} fill="var(--sage)" fillOpacity={0.9}>
                {today && <animate attributeName="r" values="7;8;7" dur="2.6s" repeatCount="indefinite" />}
              </circle>
            )}
            {d.status === 'failed' && (
              <>
                <circle cx={x} cy={y} r={6.5} fill="var(--danger-soft)" stroke="var(--danger)" strokeWidth={1.5} />
                <path
                  d={`M${x - 2.4} ${y - 2.4} L${x + 2.4} ${y + 2.4} M${x + 2.4} ${y - 2.4} L${x - 2.4} ${y + 2.4}`}
                  stroke="var(--danger)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              </>
            )}
            {d.status === 'missing' && (
              <circle
                cx={x}
                cy={y}
                r={5.5}
                fill="var(--surface)"
                stroke="var(--ink-4)"
                strokeWidth={1.2}
                strokeDasharray="2 2.4"
              />
            )}
            {/* 首日、每月 1 日、今天标日期；月初离两端太近时不标，免得文字挤在一起 */}
            {(i === 0 || today || (d.date.endsWith('-01') && i >= 3 && i <= days.length - 4)) && (
              <text x={x} y={52} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
                {today ? '今天' : `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function Command({ children }: { children: string }) {
  return (
    <code className="block select-all rounded-lg bg-sunken px-3 py-2 font-mono text-[12.5px] text-ink">{children}</code>
  )
}

export function BackupTab() {
  const q = useBackupStatus()
  const s = q.data
  return (
    <div className="max-w-[760px]">
      <PageHeader title="备份" sub="数据库与上传文件每天自动备份；这里只看状态，备份与恢复在服务器上执行。" />
      <div className="px-7">
        {!s ? (
          <div className="flex items-center gap-2 py-6 text-ink-3">
            <OrbitLoader size={20} /> 正在读取备份状态…
          </div>
        ) : !s.configured ? (
          <div
            className="flex items-start gap-4 rounded-2xl bg-surface-2 px-6 py-5 ring-1 ring-hairline"
            data-testid="backup-unconfigured"
          >
            <DatabaseBackup size={30} className="mt-0.5 text-ink-4" />
            <div>
              <div className="font-display text-[18px] font-semibold">未配置备份</div>
              <p className="mt-1 text-[13px] text-ink-3">
                Docker 部署自带备份容器；应用设置环境变量 BACKUP_DIR 后，这里显示备份状态。开发环境通常不配置。
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <BookOpen size={13} /> 见部署与运维手册 <code className="font-mono">{MANUAL}</code>「备份与恢复」
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {s.alert && (
              <div
                role="alert"
                className={cn(
                  'flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px] ring-1',
                  s.alert === 'failed'
                    ? 'bg-danger-soft/60 text-ink ring-danger/30'
                    : 'bg-signal-soft/60 text-ink ring-signal/35',
                )}
              >
                <AlertTriangle size={15} className={s.alert === 'failed' ? 'text-danger' : 'text-signal-ink'} />
                <span>
                  {s.alert === 'failed'
                    ? `最近一次备份失败${s.lastError ? `：${s.lastError}` : ''}`
                    : s.lastSuccessAt
                      ? `已经 ${fmtRelative(s.lastSuccessAt).replace('前', '')}没有成功备份`
                      : '还没有成功的备份'}
                </span>
              </div>
            )}
            <div className="flex items-end gap-8">
              <div>
                <div className="eyebrow">最近一次成功</div>
                <div className="mt-1 font-display text-[30px] font-semibold leading-tight" data-testid="backup-last">
                  {s.lastSuccessAt ? fmtRelative(s.lastSuccessAt) : '—'}
                </div>
                {s.latest && (
                  <div className="text-[12.5px] text-ink-3">
                    {fmtDateTime(s.latest.createdAt || s.lastSuccessAt!)} · {fmtBytes(s.latest.size)} ·{' '}
                    <code className="font-mono">{s.latest.name}</code>
                  </div>
                )}
              </div>
              <div className="pb-1 text-[12.5px] text-ink-3">保留 {s.retentionDays} 天，始终保留最新一份</div>
            </div>
            <section aria-label="最近 30 天">
              <div className="eyebrow mb-2">最近 30 天</div>
              <BackupCalendar days={s.days} />
              <div className="mt-1 flex gap-4 text-[11.5px] text-ink-3">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-sage" /> 成功
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border border-danger bg-danger-soft" /> 失败
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full border border-dashed border-ink-4" /> 没有备份
                </span>
              </div>
            </section>
            <section aria-label="手动备份与恢复" className="flex flex-col gap-2 text-[13px] text-ink-2">
              <div className="eyebrow">在服务器的部署目录里执行</div>
              <span>手动备份（升级前建议先做一次）：</span>
              <Command>docker compose exec backup bash /scripts/backup.sh manual</Command>
              <span>恢复到某一份备份（会先给当前数据再备份一份）：</span>
              <Command>bash deploy/restore.sh 备份名</Command>
              <p className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3">
                <BookOpen size={13} /> 详细步骤与演练见 <code className="font-mono">{MANUAL}</code>
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/** 工作台顶部的提醒：最近一次成功超过 48 小时，或最近一次尝试失败；没有问题、没有配置时不显示 */
export function BackupAlert() {
  const s = useBackupStatus().data
  if (!s?.configured || !s.alert) return null
  return (
    <Link
      to="/settings/backup"
      role="alert"
      data-testid="home-backup-alert"
      className="group mx-10 mt-4 flex items-center gap-3 rounded-xl bg-signal-soft/70 px-4 py-2.5 text-[13px] text-ink ring-1 ring-signal/40 transition-shadow hover:shadow-float"
    >
      <span className="gt-breathe size-2 shrink-0 rounded-full bg-signal" />
      <span className="min-w-0 flex-1 truncate">
        {s.alert === 'failed'
          ? `最近一次备份失败${s.lastError ? `：${s.lastError}` : ''}`
          : s.lastSuccessAt
            ? `备份已经 ${fmtRelative(s.lastSuccessAt).replace('前', '')}没有成功，请检查备份容器`
            : '还没有成功的备份，请检查备份容器'}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-signal-ink">
        查看备份 <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
