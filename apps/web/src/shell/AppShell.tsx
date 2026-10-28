// 应用外壳（F-COM-10）：不设顶栏，导航、全局搜索、主题切换、账号收进左侧窄栏
import type { Region } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import {
  Bus,
  Database,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPin,
  Moon,
  Search,
  Settings,
  Signpost,
  Sun,
  UserRound,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { BrandMark } from '@/components/gt/lively'
import { Kbd } from '@/components/gt/symbols'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/dropdown-menu'
import { useLogout, useMe } from '@/features/auth/auth'
import { get } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { GlobalSearch, useSearchHotkey } from './GlobalSearch'

const NAV = [
  { to: '/home', label: '工作台', icon: LayoutDashboard },
  { to: '/stops', label: '站点', icon: MapPin },
  { to: '/lines', label: '线路', icon: Bus },
  { to: '/sign-sets', label: '站牌集', icon: Signpost },
  { to: '/landmarks', label: '地标', icon: Landmark },
  { to: '/base-data', label: '基础数据', icon: Database },
  { to: '/settings', label: '设置', icon: Settings },
]

export function AppShell() {
  const [dark, setDark] = useTheme()
  const me = useMe()
  const logout = useLogout()
  const nav = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  useSearchHotkey(() => setSearchOpen(true))
  const regions = useQuery({ queryKey: ['regions'], queryFn: () => get<Region[]>('/api/regions') })
  const city = regions.data?.find((r) => r.level === 'city')?.name

  return (
    <div className="flex h-full">
      <nav aria-label="主导航" className="flex w-[216px] shrink-0 flex-col px-3 pb-3 pt-4">
        <div className="flex items-center gap-2.5 px-1.5">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <div className="font-display text-[15px] font-semibold">GenTransit</div>
            <div className="truncate text-[11.5px] text-ink-3">{city ? `${city} · 站牌信息` : '站牌信息'}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="mt-5 flex h-9 items-center gap-2 whitespace-nowrap rounded-xl bg-surface px-2.5 text-[13px] text-ink-3 shadow-xs ring-1 ring-hairline hover:text-ink"
        >
          <Search size={15} />
          搜索
          <span className="ml-auto whitespace-nowrap">
            <Kbd>Ctrl K</Kbd>
          </span>
        </button>
        <ul className="mt-4 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[14px] transition-colors',
                    isActive
                      ? 'bg-surface font-semibold text-ink shadow-xs ring-1 ring-hairline'
                      : 'text-ink-2 hover:bg-sunken/70 hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={16}
                      strokeWidth={1.6}
                      className={isActive ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2'}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-1 px-1.5 pt-3">
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label="账号菜单"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-1 text-left hover:bg-sunken/70"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-[13px] font-semibold uppercase text-accent">
                  {me.data?.username.slice(0, 1) ?? '·'}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium">{me.data?.username}</span>
                  <span className="block text-[11px] text-ink-3">唯一账号</span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent align="start" side="top">
              <MenuItem onSelect={() => nav('/settings/account')}>
                <UserRound size={14} /> 账号与密码
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => logout.mutate()}>
                <LogOut size={14} /> 退出登录
              </MenuItem>
            </MenuContent>
          </Menu>
          <button
            type="button"
            aria-label={dark ? '切换到浅色' : '切换到深色'}
            title="切换主题"
            onClick={() => setDark((d) => !d)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>
      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-surface shadow-xs ring-1 ring-hairline">
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  )
}

/** 后续里程碑的页面占位 */
export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-[22px] font-semibold">{title}</h1>
        <p className="mt-2 text-[13.5px] text-ink-3">这部分在 {milestone} 实现。</p>
      </div>
    </div>
  )
}
