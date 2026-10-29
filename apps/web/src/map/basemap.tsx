// 高德底图切换：暖纸（默认，浅色街道、不显示兴趣点、调成暖纸色）、标准（道路、路名与兴趣点）、卫星、卫星路网。
// 选择记在本浏览器，所有地图共用；示意平面没有底图，不显示这个按钮
import { Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type BaseMap = 'paper' | 'standard' | 'satellite' | 'hybrid'

export const BASEMAP_KEY = 'gt-basemap'

const road = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** 每种底图一张小缩略图：手绘的街区、河、绿地 */
const THUMBS: Record<BaseMap, ReactNode> = {
  paper: (
    <>
      <rect width="72" height="48" fill="#efe6d4" />
      <path d="M-4 30 C 18 26, 40 36, 76 28" stroke="#fbf7ee" strokeWidth="5" {...road} />
      <path d="M26 -4 C 24 18, 30 30, 27 52" stroke="#fbf7ee" strokeWidth="4" {...road} />
      <path d="M52 -4 L 50 52" stroke="#fbf7ee" strokeWidth="2.5" {...road} />
      <rect x="34" y="8" width="11" height="9" rx="2" fill="#e4d8c2" />
    </>
  ),
  standard: (
    <>
      <rect width="72" height="48" fill="#f4f2ec" />
      <path d="M44 -4 C 50 14, 66 22, 76 20 L 76 -4 Z" fill="#cfe6bf" />
      <path d="M-4 40 C 16 36, 30 46, 50 40 S 70 44, 76 42" stroke="#a9d0ea" strokeWidth="5" {...road} />
      <path d="M-4 22 C 20 20, 44 28, 76 24" stroke="#f5c25b" strokeWidth="4.5" {...road} />
      <path d="M22 -4 C 20 16, 26 32, 24 52" stroke="#ffffff" strokeWidth="3.5" {...road} />
      <rect x="31" y="8" width="16" height="3" rx="1.5" fill="#8b8b8b" opacity="0.55" />
    </>
  ),
  satellite: (
    <>
      <rect width="72" height="48" fill="#4c5a3c" />
      <path d="M-4 8 C 14 2, 26 16, 40 10 S 60 -2, 76 6 L 76 -4 L -4 -4 Z" fill="#6c7a4c" />
      <path d="M8 30 C 18 22, 34 26, 36 36 S 20 50, 8 44 Z" fill="#3a4a30" />
      <path d="M46 20 C 56 16, 70 22, 68 32 S 52 40, 46 32 Z" fill="#7a6e52" />
      <path d="M-4 40 C 16 36, 30 46, 50 40 S 70 44, 76 42" stroke="#2f4a55" strokeWidth="5" {...road} />
    </>
  ),
  hybrid: (
    <>
      <rect width="72" height="48" fill="#4c5a3c" />
      <path d="M8 30 C 18 22, 34 26, 36 36 S 20 50, 8 44 Z" fill="#3a4a30" />
      <path d="M46 20 C 56 16, 70 22, 68 32 S 52 40, 46 32 Z" fill="#7a6e52" />
      <path d="M-4 22 C 20 20, 44 28, 76 24" stroke="#f5c25b" strokeWidth="3.5" {...road} />
      <path d="M22 -4 C 20 16, 26 32, 24 52" stroke="#f3efe4" strokeWidth="2.5" {...road} />
      <rect x="31" y="8" width="16" height="3" rx="1.5" fill="#ffffff" opacity="0.8" />
    </>
  ),
}

export const BASEMAPS: { id: BaseMap; label: string; hint: string }[] = [
  { id: 'paper', label: '暖纸', hint: '浅色街道，不显示兴趣点' },
  { id: 'standard', label: '标准', hint: '道路、路名与兴趣点' },
  { id: 'satellite', label: '卫星', hint: '卫星影像' },
  { id: 'hybrid', label: '卫星路网', hint: '卫星影像叠加道路与路名' },
]

/** 缩放按钮下方的图层按钮，点开选底图 */
export function BaseMapSwitch({ value, onChange }: { value: BaseMap; onChange: (v: BaseMap) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="切换底图"
          title="切换底图"
          className="absolute right-3 top-[118px] z-10 flex size-8 items-center justify-center overflow-hidden rounded-xl bg-surface/95 text-ink-2 shadow-float ring-1 ring-hairline backdrop-blur hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinejoin="round"
          >
            <path d="M12 3.5 21 8.2 12 13 3 8.2Z" />
            <path d="m3 12.2 9 4.8 9-4.8" opacity={0.7} />
            <path d="m3 16 9 4.6 9-4.6" opacity={0.45} />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" sideOffset={8} className="w-[248px] p-2">
        <div className="eyebrow px-1 pb-1.5">底图</div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="底图">
          {BASEMAPS.map((b) => {
            const on = b.id === value
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={b.label}
                title={b.hint}
                onClick={() => {
                  onChange(b.id)
                  setOpen(false)
                }}
                className="group flex flex-col items-start gap-1 rounded-lg p-1 text-left hover:bg-sunken"
              >
                <span
                  className={cn(
                    'relative block overflow-hidden rounded-md ring-1 transition-shadow duration-300 ease-[var(--spring)]',
                    on ? 'ring-2 ring-accent' : 'ring-hairline group-hover:ring-hairline-2',
                  )}
                >
                  <svg viewBox="0 0 72 48" width={108} height={72} aria-hidden="true" className="block">
                    {THUMBS[b.id]}
                  </svg>
                  {on && (
                    <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent text-surface">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className={cn('px-0.5 text-[12.5px]', on ? 'font-semibold text-accent' : 'text-ink-2')}>
                  {b.label}
                </span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
