// 灵动小组件：有机手绘笔触（1.5px 圆头描边）+ 弹簧回弹，只用在需要被注意的瞬间
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

const STROKE = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** 印章对勾：保存成功、生成快照时出现 */
export function SealCheck({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden="true"
    >
      <g className="gt-pop">
        <path
          d="M60 18 C67 18, 71 23, 78 22 C85 21, 90 27, 93 33 C96 39, 102 44, 101 51 C100 58, 102 65, 98 72 C94 79, 92 86, 86 90 C80 94, 73 99, 66 99 C59 99, 53 102, 46 99 C39 96, 32 94, 27 88 C22 82, 18 75, 19 68 C20 61, 17 54, 21 47 C25 40, 28 33, 34 28 C40 23, 47 21, 54 19 Z"
          fill="var(--sage)"
          fillOpacity="0.28"
          stroke="var(--sage)"
          {...STROKE}
          strokeWidth={6}
        />
      </g>
      <path
        d="M44 61 L55 72 C59 63, 66 52, 78 46"
        fill="none"
        stroke="var(--coral)"
        {...STROKE}
        strokeWidth={10}
        className="gt-draw"
        style={{ '--len': 60, animationDelay: '0.18s', strokeDashoffset: 60 } as CSSProperties}
      />
    </svg>
  )
}

/** 四芒星 + 轨道：短暂等待（例如逆地理编码） */
export function OrbitLoader({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden="true"
    >
      <g className="gt-orbit">
        <ellipse
          cx="60"
          cy="60"
          rx="46"
          ry="20"
          fill="none"
          stroke="var(--ink-3)"
          strokeOpacity="0.5"
          strokeDasharray="8 8"
          transform="rotate(-28 60 60)"
          {...STROKE}
          strokeWidth={6}
        />
        <circle cx="106" cy="60" r="8" fill="var(--coral)" transform="rotate(-28 60 60)" />
      </g>
      <g className="gt-orbit-rev">
        <ellipse
          cx="60"
          cy="60"
          rx="44"
          ry="22"
          fill="none"
          stroke="var(--signal)"
          strokeOpacity="0.7"
          strokeDasharray="40 14 8 14"
          transform="rotate(42 60 60)"
          {...STROKE}
          strokeWidth={6}
        />
      </g>
      <path
        className="gt-breathe"
        d="M60 36 C61 52, 68 59, 84 60 C68 61, 61 68, 60 84 C59 68, 52 61, 36 60 C52 59, 59 52, 60 36 Z"
        fill="var(--surface)"
        stroke="var(--coral)"
        {...STROKE}
        strokeWidth={7}
      />
    </svg>
  )
}

/** 呼吸点：轻声提示"这里要处理" */
export function BreathingDot({
  tone = 'signal',
  className,
}: {
  tone?: 'signal' | 'danger' | 'sage'
  className?: string
}) {
  const c = tone === 'signal' ? 'bg-signal' : tone === 'danger' ? 'bg-danger' : 'bg-sage'
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden="true">
      <span className={cn('gt-ripple absolute inset-0 rounded-full opacity-40', c)} />
      <span className={cn('relative size-2 rounded-full', c)} />
    </span>
  )
}

/** 快照叠纸：修改历史入口，悬停时纸张散开（父元素需带 group） */
export function SnapshotStack({ size = 18, className }: { size?: number; className?: string }) {
  const t = 'transition-transform duration-500 ease-[var(--spring)]'
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-visible', className)}
      aria-hidden="true"
    >
      <rect
        x="6"
        y="4"
        width="11"
        height="15"
        rx="2"
        fill="var(--sunken)"
        stroke="var(--ink-3)"
        {...STROKE}
        className={cn(t, 'origin-[12px_16px] group-hover:-translate-x-[1.5px] group-hover:-rotate-[14deg]')}
      />
      <rect
        x="7"
        y="4"
        width="11"
        height="15"
        rx="2"
        fill="var(--sunken)"
        stroke="var(--ink-3)"
        {...STROKE}
        className={cn(t, 'origin-[12px_16px] group-hover:translate-x-[1.5px] group-hover:rotate-[12deg]')}
      />
      <rect
        x="6.5"
        y="3.5"
        width="11"
        height="15"
        rx="2"
        fill="var(--surface)"
        stroke="var(--ink)"
        {...STROKE}
        className={cn(t, 'group-hover:-translate-y-[1px]')}
      />
      <line x1="9" y1="8" x2="15" y2="8" stroke="var(--coral)" {...STROKE} />
      <line x1="9" y1="11.5" x2="14" y2="11.5" stroke="var(--ink-3)" {...STROKE} />
      <line x1="9" y1="15" x2="12.5" y2="15" stroke="var(--ink-3)" {...STROKE} />
    </svg>
  )
}

/** 空状态：还没有站架 */
export function EmptyShelfArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      width={160}
      height={120}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      <ellipse cx="80" cy="108" rx="54" ry="5" fill="var(--ink)" fillOpacity="0.06" />
      <line x1="52" y1="106" x2="52" y2="38" stroke="var(--ink-3)" {...STROKE} strokeDasharray="3 5" />
      <line x1="108" y1="106" x2="108" y2="38" stroke="var(--ink-3)" {...STROKE} strokeDasharray="3 5" />
      <g className="gt-float">
        <rect x="46" y="22" width="68" height="62" rx="6" fill="var(--surface)" stroke="var(--ink)" {...STROKE} />
        <rect x="54" y="32" width="22" height="9" rx="2.5" fill="var(--plate)" />
        <line x1="81" y1="36.5" x2="104" y2="36.5" stroke="var(--ink-3)" {...STROKE} />
        <rect x="54" y="47" width="22" height="9" rx="2.5" fill="var(--plate)" fillOpacity="0.55" />
        <line x1="81" y1="51.5" x2="98" y2="51.5" stroke="var(--ink-3)" {...STROKE} />
        <rect
          x="54"
          y="62"
          width="22"
          height="9"
          rx="2.5"
          fill="none"
          stroke="var(--signal)"
          {...STROKE}
          strokeDasharray="3 3"
        />
        <circle cx="110" cy="24" r="3" fill="var(--coral)" />
      </g>
    </svg>
  )
}

/** 空状态：没有搜到 */
export function EmptySearchArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={112}
      height={112}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      <g className="gt-orbit" style={{ animationDuration: '18s' }}>
        <ellipse
          cx="60"
          cy="60"
          rx="44"
          ry="18"
          fill="none"
          stroke="var(--ink-3)"
          strokeOpacity="0.35"
          strokeDasharray="3 6"
          transform="rotate(-28 60 60)"
          {...STROKE}
        />
        <circle cx="104" cy="60" r="2.5" fill="var(--sage)" transform="rotate(-28 60 60)" />
      </g>
      <circle cx="54" cy="54" r="18" fill="var(--surface)" stroke="var(--ink)" {...STROKE} />
      <line x1="67" y1="67" x2="80" y2="80" stroke="var(--ink)" {...STROKE} strokeWidth={3} />
      <path d="M46 54 Q54 46 62 54" fill="none" stroke="var(--coral)" {...STROKE} />
    </svg>
  )
}

/** 品牌标：一块墨绿站牌，挂着一枚珊瑚色站点 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className="shrink-0">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--plate)" />
      <path d="M9 11.5 H23" stroke="var(--plate-ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 16 H19" stroke="var(--plate-ink)" strokeOpacity="0.6" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 20.5 H16" stroke="var(--plate-ink)" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
      <circle cx="22.5" cy="20.5" r="3" fill="var(--coral)" className="gt-breathe" />
    </svg>
  )
}
