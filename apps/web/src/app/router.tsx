import { createBrowserRouter, Navigate } from 'react-router'
import { LoginPage } from '@/features/auth/LoginPage'
import { BaseDataPage } from '@/features/base-data/BaseDataPage'
import { LandmarksPage } from '@/features/landmarks/LandmarksPage'
import { LineDetailPage } from '@/features/lines/LineDetailPage'
import { LineFormPage } from '@/features/lines/LineFormPage'
import { LineListPage } from '@/features/lines/LineListPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { StopDetailPage } from '@/features/stops/StopDetailPage'
import { StopFormPage } from '@/features/stops/StopFormPage'
import { StopListPage } from '@/features/stops/StopListPage'
import { AppShell, Placeholder } from '@/shell/AppShell'
import { RequireAuth } from './RequireAuth'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/stops" replace /> },
          { path: '/home', element: <Placeholder title="工作台" milestone="M3" /> },
          { path: '/stops', element: <StopListPage /> },
          { path: '/stops/new', element: <StopFormPage /> },
          { path: '/stops/:id', element: <StopDetailPage /> },
          { path: '/stops/:id/edit', element: <StopFormPage /> },
          { path: '/lines', element: <LineListPage /> },
          { path: '/lines/new', element: <LineFormPage /> },
          { path: '/lines/:id', element: <LineDetailPage /> },
          { path: '/lines/:id/edit', element: <LineFormPage /> },
          { path: '/sign-sets', element: <Placeholder title="站牌集" milestone="M3" /> },
          { path: '/landmarks', element: <LandmarksPage /> },
          { path: '/base-data/:tab?', element: <BaseDataPage /> },
          { path: '/settings/:tab?', element: <SettingsPage /> },
          { path: '*', element: <Placeholder title="页面不存在" milestone="—" /> },
        ],
      },
    ],
  },
])
