// 工作台"数据体检"（需求 5.2，M5 计划 4.11）：每个检查项一行，手绘感的小勾或圈加名称和数量；
// 数量为 0 淡显鼠尾草小勾，大于 0 显示赭石数字并进入带 check 筛选的列表；全部为 0 时盖一枚"数据完整"印章
import { CHECK_LABEL, LINE_CHECKS, STOP_CHECKS, type DataChecks as Checks } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { OrbitLoader, SealCheck } from '@/components/gt/lively'
import { get } from '@/lib/api'
import { cn } from '@/lib/utils'

/** 小勾：没有问题 */
function Tick() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" className="shrink-0">
      <path
        d="M3.2 8.6 L6.4 11.4 C8 8.6 10 6.2 12.8 4.6"
        fill="none"
        stroke="var(--sage)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 手绘的圈：需要看一眼 */
function Ring() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden="true" className="shrink-0">
      <path
        d="M8 2.4 C11.6 2.2 13.8 4.6 13.6 8.2 C13.4 11.6 10.8 13.8 7.6 13.6 C4.4 13.4 2.2 11 2.5 7.8 C2.7 5 4.6 2.9 8.6 2.8"
        fill="none"
        stroke="var(--signal)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function DataChecks() {
  const q = useQuery({ queryKey: ['data-checks'], queryFn: () => get<Checks>('/api/data-checks'), staleTime: 0 })
  const rows = q.data
    ? [
        ...STOP_CHECKS.map((k) => ({
          key: k,
          group: '站点',
          label: CHECK_LABEL[k],
          n: q.data.stops[k],
          to: `/stops?check=${k}`,
        })),
        ...LINE_CHECKS.map((k) => ({
          key: k,
          group: '线路',
          label: CHECK_LABEL[k],
          n: q.data.lines[k],
          to: `/lines?check=${k}`,
        })),
        {
          key: 'pending',
          group: '站牌集',
          label: '有待编排或失效编排',
          n: q.data.pendingSets,
          to: '/sign-sets?pending=1&sort=-pending',
        },
      ]
    : []
  const clean = rows.length > 0 && rows.every((r) => r.n === 0)
  return (
    <section aria-labelledby="checks-title" data-testid="data-checks">
      <div className="eyebrow mb-2" id="checks-title">
        数据体检
      </div>
      {!q.data ? (
        <div className="flex items-center gap-2 py-2 text-[12.5px] text-ink-3">
          <OrbitLoader size={16} /> 正在检查…
        </div>
      ) : clean ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <SealCheck size={26} /> 数据完整，没有发现缺口
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-6">
          {rows.map((r) =>
            r.n === 0 ? (
              <li key={r.key} className="flex items-center gap-2 py-1 text-[12.5px] text-ink-4">
                <Tick />
                <span className="text-[11px]">{r.group}</span>
                <span className="truncate">{r.label}</span>
              </li>
            ) : (
              <li key={r.key}>
                <Link
                  to={r.to}
                  className="group flex items-center gap-2 py-1 text-[12.5px] text-ink-2 hover:text-ink"
                  data-testid={`check-${r.key}`}
                >
                  <Ring />
                  <span className="text-[11px] text-ink-3">{r.group}</span>
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  <b className={cn('tabular-nums text-signal-ink')}>{r.n.toLocaleString('zh-CN')}</b>
                  <ArrowRight
                    size={12}
                    className="text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                  />
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
