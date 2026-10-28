import type { ReactNode } from 'react'

export type LngLat = [number, number]

export interface MapPoint {
  id: string
  lng: number
  lat: number
  label: string
  /** 标签后的灰字，如方位 */
  sub?: string
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
  /** key 变化时调整视野：一个点放大到街道级，多个点适配范围 */
  fit?: { key: string; points: LngLat[] } | null
  className?: string
  overlay?: ReactNode
}

/** 默认视野中心（示例市，杭州附近） */
export const DEFAULT_CENTER: LngLat = [120.2, 30.25]
