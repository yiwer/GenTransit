// PROTOTYPE — 原型工具（仅开发环境显示）：
// 1. 有多个方案的页面，顶部显示"方案对比"横条，逐个说明并可切换（← → 也能切）；
// 2. 左下角小卡片：查看当前页面数据，以及直达有方案对比的页面。
import { ArrowUpRight, Braces } from 'lucide-react'
import { useEffect, useState } from 'react'
import { matchPath, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDebug } from '../data/store'
import { cn } from '../ui'

type Variant = { key: string; name: string; desc: string }

// 2026-10-27：站点表单定为 A，站牌编排编辑器定为 A3（立面 + 线路托盘），目前没有待对比的页面
export const VARIANTS: { pattern: string; page: string; list: Variant[] }[] = []

export function useVariant() {
  const loc = useLocation()
  const [sp] = useSearchParams()
  const entry = VARIANTS.find((v) => matchPath(v.pattern, loc.pathname))
  const raw = sp.get('variant')
  const key = entry ? (entry.list.some((v) => v.key === raw) ? raw! : entry.list[0].key) : raw ?? ''
  return { entry, key }
}

function useSetVariant() {
  const [sp, setSp] = useSearchParams()
  return (k: string) => {
    const p = new URLSearchParams(sp)
    p.set('variant', k)
    setSp(p, { replace: true })
  }
}

/** 页面顶部的方案对比横条 */
export function VariantBanner() {
  const { entry, key } = useVariant()
  const setVariant = useSetVariant()

  useEffect(() => {
    if (!entry) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // 焦点在页面内其他控件上时不切换方案，避免和页面内的键盘操作冲突
      const act = document.activeElement as HTMLElement | null
      if (act && act !== document.body && !act.closest('[data-variant-banner]')) return
      const i = entry.list.findIndex((v) => v.key === key)
      const d = e.key === 'ArrowLeft' ? -1 : 1
      setVariant(entry.list[(i + d + entry.list.length) % entry.list.length].key)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  if (!import.meta.env.DEV || !entry) return null
  const cur = entry.list.find((v) => v.key === key)!
  return (
    <div data-variant-banner className="flex shrink-0 items-center gap-3 bg-[#111418] px-4 py-2 text-[12.5px] text-white">
      <span className="shrink-0 rounded-full bg-[#ff5c39] px-2 py-0.5 text-[11px] font-semibold">原型 · 方案对比</span>
      <span className="shrink-0 text-white/70">{entry.page}有 {entry.list.length} 个方案：</span>
      <div role="radiogroup" aria-label={`${entry.page}方案`} className="flex shrink-0 gap-1 rounded-lg bg-white/8 p-0.5">
        {entry.list.map((v) => (
          <button
            key={v.key}
            role="radio"
            aria-checked={v.key === key}
            onClick={() => setVariant(v.key)}
            className={cn('h-7 rounded-md px-2.5 transition-colors', v.key === key ? 'bg-white font-semibold text-[#111418]' : 'text-white/80 hover:bg-white/10 hover:text-white')}
          >
            {v.key} · {v.name}
          </button>
        ))}
      </div>
      <span className="min-w-0 truncate text-white/60" title={cur.desc}>
        {cur.desc}
      </span>
      <span className="ml-auto hidden shrink-0 text-white/40 xl:inline">← → 切换</span>
    </div>
  )
}

/** 左下角小卡片：页面数据 + 直达有方案对比的页面 */
export function PrototypeSwitcher() {
  const { entry } = useVariant()
  const { data } = useDebug()
  const [showState, setShowState] = useState(false)
  const nav = useNavigate()
  if (!import.meta.env.DEV) return null

  return (
    <>
      {showState && (
        <div className="fixed bottom-[176px] left-3 z-[70] max-h-[60vh] w-[min(560px,80vw)] overflow-auto rounded-xl bg-[#111418] p-3 font-mono text-[11.5px] leading-relaxed text-[#cfe3ff] shadow-2xl">
          <pre className="whitespace-pre-wrap">{data ? JSON.stringify(data, null, 2) : '当前页面没有登记状态'}</pre>
        </div>
      )}
      <div className="fixed bottom-[68px] left-3 z-[70] w-[192px] whitespace-nowrap rounded-xl bg-[#111418] p-1.5 text-[12px] text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-1.5 px-1 pb-1">
          <span className="shrink-0 rounded-full bg-[#ff5c39] px-1.5 py-px text-[10.5px] font-semibold">原型</span>
          <span className="min-w-0 truncate text-white/70">{entry ? `${entry.page} · 见顶部` : '本页已定稿'}</span>
          <button className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-white/80 hover:bg-white/10" onClick={() => setShowState((s) => !s)} aria-pressed={showState}>
            <Braces size={12} /> 状态
          </button>
        </div>
        {VARIANTS.length > 0 && <div className="border-t border-white/10 px-1 pb-0.5 pt-1.5 text-[11px] text-white/50">有方案对比的页面</div>}
        {VARIANTS.filter((v, i, xs) => xs.findIndex((x) => x.page === v.page) === i).map((v) => [`${v.page}（${v.list.map((x) => x.key).join('/')}）`, v.pattern.replace(':id', 's01').replace(':stopId', 's01')]).map(([label, to]) => (
          <button key={to} onClick={() => nav(to)} className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-white/85 hover:bg-white/10">
            {label}
            <ArrowUpRight size={12} className="text-white/50" />
          </button>
        ))}
      </div>
    </>
  )
}
