// PROTOTYPE — 应用外壳：去掉顶栏，导航、搜索、主题都收进左侧窄栏，把高度留给地图和内容
import { Bus, Database, LayoutDashboard, Landmark, MapPin, Moon, Search, Settings, Signpost, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn, Kbd } from '../ui'
import { BrandMark } from '../ui/lively'
import { PrototypeSwitcher, VariantBanner } from './PrototypeSwitcher'

const NAV = [
  { to: '/home', label: '工作台', icon: LayoutDashboard },
  { to: '/stops', label: '站点', icon: MapPin },
  { to: '/lines', label: '线路', icon: Bus },
  { to: '/sign-sets', label: '站牌集', icon: Signpost },
  { to: '/landmarks', label: '地标', icon: Landmark },
  { to: '/base-data', label: '基础数据', icon: Database },
  { to: '/settings', label: '设置', icon: Settings },
]

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('gt-proto-theme') === 'dark'
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem('gt-proto-theme', dark ? 'dark' : 'light')
    } catch {
      /* 忽略 */
    }
  }, [dark])
  return [dark, setDark] as const
}

export function AppShell() {
  const [dark, setDark] = useTheme()
  return (
    <div className="flex h-full">
      <nav aria-label="主导航" className="flex w-[216px] shrink-0 flex-col px-3 pb-3 pt-4">
        <div className="flex items-center gap-2.5 px-1.5">
          <BrandMark />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold">GenTransit</div>
            <div className="text-[11.5px] text-ink-3">示例市 · 站牌信息</div>
          </div>
        </div>
        <button className="mt-5 flex h-9 items-center gap-2 whitespace-nowrap rounded-xl bg-surface px-2.5 text-[13px] text-ink-3 shadow-xs ring-1 ring-hairline hover:text-ink">
          <Search size={15} />
          搜索
          <span className="ml-auto whitespace-nowrap"><Kbd>Ctrl K</Kbd></span>
        </button>
        <ul className="mt-4 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[14px] transition-colors',
                    isActive ? 'bg-surface font-semibold text-ink shadow-xs ring-1 ring-hairline' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} strokeWidth={1.6} className={isActive ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2'} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-2 px-1.5 pt-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft font-display text-[13px] font-semibold text-accent">管</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[13px] font-medium">管理员</div>
            <div className="text-[11px] text-ink-3">M0 原型 · 假数据</div>
          </div>
          <button aria-label={dark ? '切换到浅色' : '切换到深色'} title="切换主题" onClick={() => setDark((d) => !d)} className="flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>
      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-surface shadow-xs ring-1 ring-hairline">
        <VariantBanner />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      <PrototypeSwitcher />
    </div>
  )
}

export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-7 pb-4 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-9">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-[22px] font-semibold">{title}</h1>
        <p className="mt-2 text-[13.5px] text-ink-3">不在 M0 原型范围内。M0 只做站点、线路和站牌集。</p>
      </div>
    </div>
  )
}
