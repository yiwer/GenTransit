// 地图入口：服务端配置了高德 JS Key 与安全密钥代理就用高德底图，否则退回示意坐标平面。
// 没有对象可定位时的初始视野见 initial-view.ts（F-COM-18）
import { useQuery } from '@tanstack/react-query'
import { useAppConfig } from '@/features/auth/auth'
import { get } from '@/lib/api'
import { AMapView } from './AMapView'
import { startView, type StopExtent } from './initial-view'
import { PlaneMap } from './PlaneMap'
import type { MapProps } from './types'

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
  return key ? <AMapView {...props} amapKey={key} start={start} /> : <PlaneMap {...props} start={start} />
}
