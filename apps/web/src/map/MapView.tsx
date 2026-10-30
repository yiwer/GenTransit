// 地图入口：服务端配置了高德 JS Key 与安全密钥代理就用高德底图，否则退回示意坐标平面。
// 没有对象可定位时的初始视野见 initial-view.ts（F-COM-18）。高德加载器与覆盖层单独成包，用到时才下载（M6）
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { useAppConfig } from '@/features/auth/auth'
import { get } from '@/lib/api'
import { startView, type StopExtent } from './initial-view'
import { PlaneMap } from './PlaneMap'
import type { MapProps } from './types'

const AMapView = lazy(() => import('./AMapView').then((m) => ({ default: m.AMapView })))

export function MapView(props: MapProps) {
  const config = useAppConfig()
  const extent = useQuery({
    queryKey: ['stops', 'extent'],
    queryFn: () => get<StopExtent | null>('/api/stops/extent'),
    staleTime: 10 * 60_000,
  })
  if (config.isPending || extent.isPending) return <div className={props.className} />
  const start = startView(extent.data)
  const key = config.data?.amapKey
  return key ? (
    <Suspense fallback={<div className={props.className} />}>
      <AMapView {...props} amapKey={key} start={start} />
    </Suspense>
  ) : (
    <PlaneMap {...props} start={start} />
  )
}
