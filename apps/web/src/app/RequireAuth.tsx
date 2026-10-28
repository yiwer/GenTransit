import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { BrandMark } from '@/components/gt/lively'
import { useMe } from '@/features/auth/auth'
import { UNAUTHORIZED_EVENT } from '@/lib/api'

/** 需要登录的页面：会话失效时回到登录页并带上原地址 */
export function RequireAuth() {
  const me = useMe()
  const loc = useLocation()
  const nav = useNavigate()
  const qc = useQueryClient()
  const next = `${loc.pathname}${loc.search}`

  useEffect(() => {
    const onUnauthorized = () => {
      qc.clear()
      nav(`/login?next=${encodeURIComponent(next)}`, { replace: true })
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [nav, qc, next])

  if (me.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <BrandMark size={36} />
      </div>
    )
  }
  if (me.isError) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  return <Outlet />
}
