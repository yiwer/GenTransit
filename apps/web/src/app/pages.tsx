// 按页面分包（M6 计划 4.3）：每个页面一包，路由用 React Router 的 lazy 按需下载；外壳与登录页留在首包。
// 第一个页面加载完、它的请求都返回后，在浏览器空闲时预取站点、线路、站牌集三组页面，之后切换不用等
import type { ComponentType } from 'react'
import { OrbitLoader } from '@/components/gt/lively'

type PageModule = { Component: ComponentType }

const load =
  <M,>(importer: () => Promise<M>, pick: (m: M) => ComponentType) =>
  async (): Promise<PageModule> => {
    const Component = pick(await importer())
    markFirstPage()
    return { Component }
  }

export const pages = {
  home: load(
    () => import('@/features/home/HomePage'),
    (m) => m.HomePage,
  ),
  stopList: load(
    () => import('@/features/stops/StopListPage'),
    (m) => m.StopListPage,
  ),
  stopForm: load(
    () => import('@/features/stops/StopFormPage'),
    (m) => m.StopFormPage,
  ),
  stopDetail: load(
    () => import('@/features/stops/StopDetailPage'),
    (m) => m.StopDetailPage,
  ),
  lineList: load(
    () => import('@/features/lines/LineListPage'),
    (m) => m.LineListPage,
  ),
  lineForm: load(
    () => import('@/features/lines/LineFormPage'),
    (m) => m.LineFormPage,
  ),
  lineDetail: load(
    () => import('@/features/lines/LineDetailPage'),
    (m) => m.LineDetailPage,
  ),
  signSetList: load(
    () => import('@/features/sign-sets/SignSetListPage'),
    (m) => m.SignSetListPage,
  ),
  signSetEditor: load(
    () => import('@/features/sign-sets/SignSetEditorPage'),
    (m) => m.SignSetEditorPage,
  ),
  landmarks: load(
    () => import('@/features/landmarks/LandmarksPage'),
    (m) => m.LandmarksPage,
  ),
  baseData: load(
    () => import('@/features/base-data/BaseDataPage'),
    (m) => m.BaseDataPage,
  ),
  settings: load(
    () => import('@/features/settings/SettingsPage'),
    (m) => m.SettingsPage,
  ),
}

/** 首屏之后空闲时预取的三组页面 */
const PREFETCH = [
  pages.stopList,
  pages.stopDetail,
  pages.stopForm,
  pages.lineList,
  pages.lineDetail,
  pages.lineForm,
  pages.signSetList,
  pages.signSetEditor,
]

let markFirstPage = () => {}
/** 第一个页面的代码下载完成 */
export const firstPageLoaded = new Promise<void>((resolve) => {
  markFirstPage = resolve
})

let prefetched = false
/** 浏览器空闲时依次预取；只做一次，下载失败也不提示（切换到那一页时会再下载） */
export function prefetchPages() {
  if (prefetched) return () => {}
  const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 200))
  const cancel = window.cancelIdleCallback ?? window.clearTimeout
  const id = idle(() => {
    prefetched = true
    for (const p of PREFETCH) p().catch(() => {})
  })
  return () => cancel(id)
}

/** 页面代码还没下载完时内容区显示的加载态，与各页读取数据时一致 */
export function PageLoading({ delayed }: { delayed?: boolean }) {
  return (
    <div
      data-testid="page-loading"
      className={
        delayed
          ? 'gt-fade absolute inset-0 z-20 flex items-center justify-center gap-2 bg-surface/70 text-ink-3 [animation-delay:150ms]'
          : 'flex h-full items-center justify-center gap-2 text-ink-3'
      }
    >
      <OrbitLoader size={22} /> 正在打开…
    </div>
  )
}
