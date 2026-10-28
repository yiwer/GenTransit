import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './styles.css'
import { DebugProvider, StoreProvider } from './data/store'
import { AppShell, Placeholder } from './shell/AppShell'
import { ToastProvider } from './ui'
import { StopListPage } from './pages/StopList'
import { StopFormPage } from './pages/StopForm'
import { SignSetEditorPage } from './pages/signset/SignSetEditor'
import { SignSetListPage } from './pages/signset/SignSetList'
import { StopDetailPage } from './pages/StopDetail'
import { LineListPage } from './pages/lines/LineList'
import { LineDetailPage } from './pages/lines/LineDetail'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <DebugProvider>
          <ToastProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Navigate to="/stops" replace />} />
                <Route path="/stops" element={<StopListPage />} />
                <Route path="/stops/new" element={<StopFormPage />} />
                <Route path="/stops/:id" element={<StopDetailPage />} />
                <Route path="/stops/:id/edit" element={<StopFormPage />} />
                <Route path="/lines" element={<LineListPage />} />
                <Route path="/lines/:id" element={<LineDetailPage />} />
                <Route path="/sign-sets" element={<SignSetListPage />} />
                <Route path="/sign-sets/:stopId" element={<SignSetEditorPage />} />
                <Route path="/home" element={<Placeholder title="工作台" />} />
                <Route path="/landmarks" element={<Placeholder title="地标" />} />
                <Route path="/base-data" element={<Placeholder title="基础数据" />} />
                <Route path="/settings" element={<Placeholder title="设置" />} />
                <Route path="*" element={<Placeholder title="页面不存在" />} />
              </Route>
            </Routes>
          </ToastProvider>
        </DebugProvider>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
