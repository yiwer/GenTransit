// PROTOTYPE — 地图入口：配置了高德 Key 和安全密钥代理就用高德底图，否则用示意地图
import { amapAvailable } from './amap'
import { FakeMap, type FakeMapProps } from './FakeMap'
import { RealMap } from './RealMap'

export function MapView(props: FakeMapProps) {
  return amapAvailable() ? <RealMap {...props} /> : <FakeMap {...props} />
}

export { routePoints } from './FakeMap'
