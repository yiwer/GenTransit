// 地图初始视野（F-COM-18）：没有对象可定位的地图（如新建站点）先用本浏览器最近一次看过的视野，
// 没有时用全部站点的范围，库里没有站点时才用默认中心
import { DEFAULT_CENTER } from './types'

export interface StartView {
  lng: number
  lat: number
  /** 每像素多少米 */
  mpp: number
}

export interface StopExtent {
  west: number
  south: number
  east: number
  north: number
}

const KEY = 'gt-last-view'

/** 平移、缩放结束后记下视野（本浏览器的这次会话） */
export function saveView(v: StartView) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    // 存不了就算了
  }
}

function lastView(): StartView | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as StartView) : null
    return v && Number.isFinite(v.lng) && Number.isFinite(v.lat) && v.mpp > 0 ? v : null
  } catch {
    return null
  }
}

/** 按 1000×700 像素的地图估算能装下全部站点的视野 */
function extentView(e: StopExtent): StartView {
  const lat = (e.south + e.north) / 2
  const spanX = (e.east - e.west) * 111320 * Math.cos((lat * Math.PI) / 180)
  const spanY = (e.north - e.south) * 110574
  return { lng: (e.west + e.east) / 2, lat, mpp: Math.max(spanX / 900, spanY / 600, 2) }
}

export function startView(extent: StopExtent | null | undefined): StartView {
  return lastView() ?? (extent ? extentView(extent) : { lng: DEFAULT_CENTER[0], lat: DEFAULT_CENTER[1], mpp: 12 })
}

/** 每像素米数换成高德（Web 墨卡托，256 像素瓦片）的缩放级别 */
export const zoomOf = (v: StartView) =>
  Math.max(3, Math.min(20, Math.log2((156543.03392 * Math.cos((v.lat * Math.PI) / 180)) / v.mpp)))
