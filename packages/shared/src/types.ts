// 接口返回的数据形状（DTO）
import type {
  DictCategory,
  ExtOwner,
  ExtType,
  ObjectType,
  OrientationMode,
  RegionLevel,
  RouteKind,
  SnapshotAction,
  StopSection,
} from './enums'

/** 引用：ID + 当前名称 */
export interface Ref {
  id: string
  name: string
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  size: number
}

/** 保存结果：changed=false 表示内容与最后一份快照相同，没有写入 */
export interface SaveResult<T> {
  changed: boolean
  item: T
}

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export interface Me {
  username: string
}

export interface AppConfig {
  /** 高德 JS API Key；未配置时为 null，前端退回示意地图 */
  amapKey: string | null
  /** 服务端是否配置了安全密钥代理 */
  amapProxy: boolean
  /** 服务端是否能做逆地理编码 */
  regeo: boolean
}

export interface Settings {
  orientationMode: OrientationMode
  landmarkLimit: number
  autoMatch: boolean
}

export interface OrientationConflict {
  id: string
  name: string
  direction: string
}

export interface ExtFieldDef {
  id: string
  owner: ExtOwner
  key: string
  name: string
  type: ExtType
  options: string[]
  description: string
  section: StopSection | null
  enabled: boolean
  sort: number
  /** 已有取值时类型锁定 */
  hasValues: boolean
}

export interface DictItem {
  id: string
  category: DictCategory
  name: string
  refCount: number
}

export interface Region {
  id: string
  level: RegionLevel
  parentId: string | null
  name: string
  refCount: number
}

export interface Upload {
  id: string
  url: string
  originalName: string
  mime: string
  size: number
}

export interface BusCompany {
  id: string
  name: string
  nameEn: string
  shortName: string
  logo: Upload | null
  hotline: string
  lineCount: number
}

export interface LandmarkCategory {
  id: string
  name: string
  icon: string
  defaultRadius: number
  enabled: boolean
  landmarkCount: number
}

export interface LandmarkPoint {
  id: string
  lng: number
  lat: number
  radius: number
}

export interface Landmark {
  id: string
  name: string
  nameEn: string
  category: Ref & { enabled: boolean; icon: string }
  points: LandmarkPoint[]
  stopCount: number
}

export interface LandmarkCandidate {
  id: string
  name: string
  category: string
  /** 到最近位置点的距离（米） */
  distance: number
}

/** 引用某对象的一方，用于"被引用不能删除"的提示 */
export interface Referrer {
  type: string
  id: string
  name: string
}

export interface PassingRoute {
  lineId: string
  lineName: string
  routeId: string
  routeKind: RouteKind
  suspended: boolean
  /** 终点站名 */
  terminal: string
}

export interface StopFacilities {
  berths: number | null
  platformType: Ref | null
  safety: Ref | null
  waiting: string
  shelterType: Ref | null
  bigLightbox: number | null
  smallLightbox: number | null
  seats: number | null
}

export interface StopDetail {
  id: string
  rev: number
  name: string
  direction: string
  nameEn: string
  lng: number
  lat: number
  city: Ref | null
  district: Ref | null
  street: Ref | null
  road: Ref | null
  qrUrl: string
  facilities: StopFacilities
  maintainer: Ref | null
  remark: string
  landmarks: (Ref & { category: string })[]
  photos: Upload[]
  ext: Record<string, unknown>
  /** 派生：经过本站的走向 */
  routes: PassingRoute[]
  signSet: { id: string; shelves: number; boards: number; waiting: number; invalid: number }
  snapshotCount: number
  createdAt: string
  updatedAt: string
}

export interface StopListItem {
  id: string
  name: string
  direction: string
  nameEn: string
  lng: number
  lat: number
  city: Ref | null
  district: Ref | null
  street: Ref | null
  road: Ref | null
  maintainer: Ref | null
  remark: string
  landmarks: Ref[]
  lines: { name: string; suspended: boolean }[]
  ext: Record<string, unknown>
  updatedAt: string
}

export interface StopNameCheck {
  exists: boolean
  stop: { id: string; name: string; direction: string } | null
}

export interface DeleteCheck {
  canDelete: boolean
  referrers: Referrer[]
}

export interface SnapshotItem {
  id: string
  objectType: ObjectType
  objectId: string
  objectName: string
  action: SnapshotAction
  note: string
  content: unknown
  createdAt: string
}

export interface DeletedItem {
  objectId: string
  objectName: string
  deletedAt: string
  snapshotCount: number
}

/** 逆地理编码对一个层级的匹配结果 */
export interface RegeoMatch {
  /** 高德返回的名称 */
  name: string
  /** 匹配到的本库对象；null 表示没有匹配到，作为"新建建议" */
  match: Ref | null
  how: 'exact' | 'fuzzy' | null
}

export interface RegeoResult {
  available: boolean
  address: string
  city: RegeoMatch | null
  district: RegeoMatch | null
  street: RegeoMatch | null
  road: RegeoMatch | null
}
