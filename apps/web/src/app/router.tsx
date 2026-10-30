import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppShell, Placeholder } from '@/shell/AppShell'
import { PageLoading, pages } from './pages'
import { RequireAuth } from './RequireAuth'

/**
 * 按需加载的页面（M6）。HydrateFallback 静态写在路由上：首次打开时外壳照常渲染，
 * 只有内容区显示加载态；之后切换页面的加载态由外壳显示（AppShell）
 */
const page = (path: string, lazy: () => Promise<Pick<RouteObject, 'Component'>>): RouteObject => ({
  path,
  lazy,
  HydrateFallback: PageLoading,
})

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/home" replace /> },
          page('/home', pages.home),
          page('/stops', pages.stopList),
          page('/stops/new', pages.stopForm),
          page('/stops/:id', pages.stopDetail),
          page('/stops/:id/edit', pages.stopForm),
          page('/lines', pages.lineList),
          page('/lines/new', pages.lineForm),
          page('/lines/:id', pages.lineDetail),
          page('/lines/:id/edit', pages.lineForm),
          page('/sign-sets', pages.signSetList),
          page('/sign-sets/:stopId', pages.signSetEditor),
          page('/landmarks', pages.landmarks),
          page('/base-data/:tab?', pages.baseData),
          page('/settings/:tab?', pages.settings),
          { path: '*', element: <Placeholder title="页面不存在" milestone="—" /> },
        ],
      },
    ],
  },
])
