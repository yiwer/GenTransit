// 编辑器队列的小线路轨道（M5 计划 4.1）：一条细墨绿轨道，站点画成圆点——处理过的鼠尾草实心，
// 当前站放大并带一圈定位涟漪，其余空心；超过 15 站只画当前站前后各 7 站，两端用省略号
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '@/components/ui/button'
import type { Queue } from './queue'

const WINDOW = 7
const STEP = 15

export function QueueTrack({ queue, onGo }: { queue: Queue; onGo: (stopId: string) => void }) {
  const { index, stopIds, done } = queue
  const from =
    stopIds.length > WINDOW * 2 + 1 ? Math.max(0, Math.min(index - WINDOW, stopIds.length - WINDOW * 2 - 1)) : 0
  const shown = stopIds.slice(from, from + WINDOW * 2 + 1)
  const head = from > 0
  const tail = from + shown.length < stopIds.length
  const x0 = head ? 22 : 8
  const w = x0 + (shown.length - 1) * STEP + (tail ? 22 : 8)
  return (
    <div className="flex items-center gap-1" aria-label="逐站编排队列" data-testid="queue-track">
      <IconButton
        label="上一站"
        className="size-7"
        disabled={!queue.prev}
        onClick={() => queue.prev && onGo(queue.prev)}
      >
        <ChevronLeft size={15} />
      </IconButton>
      <svg width={w} height={22} viewBox={`0 0 ${w} 22`} aria-hidden="true" className="overflow-visible">
        <path
          d={`M${head ? 4 : x0} 11 H${x0 + (shown.length - 1) * STEP + (tail ? 18 : 0)}`}
          stroke="var(--plate)"
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.55}
        />
        {head && (
          <text x={4} y={8} fontSize={9} fill="var(--ink-4)">
            …
          </text>
        )}
        {tail && (
          <text x={w - 10} y={8} fontSize={9} fill="var(--ink-4)">
            …
          </text>
        )}
        {shown.map((id, k) => {
          const x = x0 + k * STEP
          const i = from + k
          if (i === index)
            return (
              <g key={id}>
                <circle cx={x} cy={11} r={8} fill="var(--accent)" className="gt-ripple" />
                <circle cx={x} cy={11} r={5.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
              </g>
            )
          return done.has(id) ? (
            <circle key={id} cx={x} cy={11} r={3.6} fill="var(--sage)" />
          ) : (
            <circle key={id} cx={x} cy={11} r={3.4} fill="var(--surface)" stroke="var(--plate)" strokeWidth={1.4} />
          )
        })}
      </svg>
      <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-2" data-testid="queue-pos">
        第 {index + 1} / {stopIds.length} 站
      </span>
      <IconButton
        label="下一站"
        className="size-7"
        disabled={!queue.next}
        onClick={() => queue.next && onGo(queue.next)}
      >
        <ChevronRight size={15} />
      </IconButton>
    </div>
  )
}
