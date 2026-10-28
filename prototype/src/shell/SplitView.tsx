// PROTOTYPE — 左内容右地图的分栏：拖动分隔条调宽（有最小值），地图可收起/展开；宽度和开关记在本浏览器
import { Map as MapIcon, PanelRightClose } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../ui'

const MIN = 360
const MAX_RATIO = 0.62

function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* 忽略 */
    }
  }, [key, v])
  return [v, setV] as const
}

export interface SplitCtx {
  mapOpen: boolean
  toggleMap: () => void
  /** 左栏实际宽度，用于切换紧凑 / 宽列表 */
  width: number
}

export function SplitView({ storageKey, defaultWidth = 440, left, map }: { storageKey: string; defaultWidth?: number; left: (ctx: SplitCtx) => ReactNode; map: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useStored(`gt-split-${storageKey}-w`, defaultWidth)
  const [open, setOpen] = useStored(`gt-split-${storageKey}-map`, true)
  const [total, setTotal] = useState(1200)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setTotal(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const clamp = (x: number) => Math.round(Math.max(MIN, Math.min(total * MAX_RATIO, x)))
  const width = open ? clamp(w) : total

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = wrap.current!
    setDragging(true)
    const move = (ev: PointerEvent) => setW(clamp(ev.clientX - el.getBoundingClientRect().left))
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setW(clamp(width - 24))
    if (e.key === 'ArrowRight') setW(clamp(width + 24))
  }

  return (
    <div ref={wrap} className={cn('relative flex h-full', dragging && 'cursor-col-resize select-none')}>
      <div className="flex min-w-0 flex-col" style={{ width, transition: dragging ? 'none' : 'width 0.45s var(--spring)' }}>
        {left({ mapOpen: open, toggleMap: () => setOpen((o) => !o), width })}
      </div>
      {open && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整列表宽度"
            aria-valuemin={MIN}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={onKey}
            className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize"
          >
            <span className={cn('absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hairline transition-colors group-hover:bg-accent/50', dragging && 'bg-accent')} />
            <span className={cn('absolute left-1/2 top-1/2 h-9 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hairline-2 transition-colors group-hover:bg-accent/60', dragging && 'bg-accent')} />
          </div>
          <div className="relative min-w-0 flex-1 p-2 pl-0.5">
            <div className="relative h-full overflow-hidden rounded-[14px] ring-1 ring-hairline">
              {map}
              <button
                onClick={() => setOpen(false)}
                className="absolute left-3 top-3 z-20 flex h-8 items-center gap-1.5 rounded-lg bg-surface/95 px-2.5 text-[12.5px] font-medium text-ink-2 shadow-float ring-1 ring-hairline backdrop-blur hover:text-ink"
              >
                <PanelRightClose size={14} /> 收起地图
              </button>
            </div>
          </div>
        </>
      )}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="gt-rise absolute bottom-6 right-6 z-20 flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-ink shadow-pop transition-transform duration-300 ease-[var(--bounce)] hover:scale-[1.04]"
        >
          <MapIcon size={15} /> 展开地图
        </button>
      )}
    </div>
  )
}
