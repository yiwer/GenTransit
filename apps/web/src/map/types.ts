import type { ReactNode } from 'react'

export type LngLat = [number, number]

export interface MapPoint {
  id: string
  lng: number
  lat: number
  label: string
  /** 标签后的灰字，如方位 */
  sub?: string
  /** 圆点里的序号（站序） */
  badge?: string
}

/** 线路走向折线：按站序连线；强调、普通、淡显三档；flow 表示行驶方向的流动短划 */
export interface MapRoute {
  id: string
  points: LngLat[]
  tone: 'strong' | 'normal' | 'faint'
  flow?: boolean
  /** points 是算出来的道路轨迹（实线）；否则是站点之间的连线（虚线） */
  road?: boolean
}

export interface MapCircle {
  id: string
  lng: number
  lat: number
  /** 米 */
  radius: number
  label: string
  strong?: boolean
}

export interface MapProps {
  points?: MapPoint[]
  selectedId?: string | null
  hoverId?: string | null
  /** 强调这些点，其余淡显 */
  emphasizeIds?: string[]
  onSelect?: (id: string) => void
  onHover?: (id: string | null) => void
  /** 双击点位 */
  onOpen?: (id: string) => void
  /** 可拖动的定位标记（表单选点） */
  marker?: { lng: number; lat: number } | null
  /** 点击地图或拖动标记 */
  onPick?: (lng: number, lat: number) => void
  circles?: MapCircle[]
  routes?: MapRoute[]
  /** key 变化时调整视野：一个点放大到街道级，多个点适配范围 */
  fit?: { key: string; points: LngLat[] } | null
  className?: string
  overlay?: ReactNode
}

/** 默认视野中心（示例市，杭州附近） */
export const DEFAULT_CENTER: LngLat = [120.2, 30.25]

/**
 * 每像素不超过这么多米时显示站名（方位），标注互相避让；高德底图与示意平面共用。
 * 取高德比例尺从"2 公里"换成"1 公里"的分界：实测每像素 14.27 米（1 公里约 70 像素），在示例市的纬度上约是 13.2 级
 */
export const LABEL_MAX_MPP = 14.27
