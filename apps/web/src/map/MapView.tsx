// 地图入口：服务端配置了高德 JS Key 与安全密钥代理就用高德底图，否则退回示意坐标平面
import { useAppConfig } from '@/features/auth/auth'
import { AMapView } from './AMapView'
import { PlaneMap } from './PlaneMap'
import type { MapProps } from './types'

export function MapView(props: MapProps) {
  const config = useAppConfig()
  if (config.isPending) return <div className={props.className} />
  const key = config.data?.amapKey
  return key ? <AMapView {...props} amapKey={key} /> : <PlaneMap {...props} />
}
