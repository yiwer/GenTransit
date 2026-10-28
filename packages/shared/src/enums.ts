// 枚举与中文标签。值与 Prisma 枚举保持一致，标签只用于界面展示

export const DIRECTIONS = ['东', '南', '西', '北', '无', '场站'] as const
export type Direction = (typeof DIRECTIONS)[number]
export const isDirection = (v: string): v is Direction => (DIRECTIONS as readonly string[]).includes(v)

export const ORIENTATION_MODES = ['orientation', 'code'] as const
export type OrientationMode = (typeof ORIENTATION_MODES)[number]
export const ORIENTATION_MODE_LABEL: Record<OrientationMode, string> = { orientation: '方位模式', code: '编码模式' }

export const DICT_CATEGORIES = [
  'shelfType',
  'maintainer',
  'road',
  'fareSystem',
  'platformType',
  'safety',
  'shelterType',
] as const
export type DictCategory = (typeof DICT_CATEGORIES)[number]
export const DICT_CATEGORY_LABEL: Record<DictCategory, string> = {
  shelfType: '站架类型',
  maintainer: '维护公司',
  road: '路段',
  fareSystem: '票制',
  platformType: '站台类型',
  safety: '安全设施',
  shelterType: '候车亭类型',
}

export const REGION_LEVELS = ['city', 'district', 'street'] as const
export type RegionLevel = (typeof REGION_LEVELS)[number]
export const REGION_LEVEL_LABEL: Record<RegionLevel, string> = { city: '市', district: '区', street: '街道' }

export const EXT_OWNERS = ['stop', 'line', 'routeStop'] as const
export type ExtOwner = (typeof EXT_OWNERS)[number]
export const EXT_OWNER_LABEL: Record<ExtOwner, string> = { stop: '站点', line: '线路', routeStop: '路径站' }

export const EXT_TYPES = ['text', 'select', 'number', 'date', 'time', 'textList'] as const
export type ExtType = (typeof EXT_TYPES)[number]
export const EXT_TYPE_LABEL: Record<ExtType, string> = {
  text: '文本',
  select: '下拉',
  number: '数字',
  date: '日期',
  time: '时间',
  textList: '文本列表',
}

export const STOP_SECTIONS = ['basic', 'facility', 'other'] as const
export type StopSection = (typeof STOP_SECTIONS)[number]
export const STOP_SECTION_LABEL: Record<StopSection, string> = { basic: '基本', facility: '站台设施', other: '其他' }

export const OBJECT_TYPES = ['stop', 'line', 'signSet'] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]
export const OBJECT_TYPE_LABEL: Record<ObjectType, string> = { stop: '站点', line: '线路', signSet: '站牌集' }

export const SNAPSHOT_ACTIONS = ['create', 'update', 'delete', 'importCreate', 'importUpdate', 'cascadeUpdate'] as const
export type SnapshotAction = (typeof SNAPSHOT_ACTIONS)[number]
export const SNAPSHOT_ACTION_LABEL: Record<SnapshotAction, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  importCreate: '导入新增',
  importUpdate: '导入修改',
  cascadeUpdate: '连带修改',
}

export const LINE_MODES = ['oneway', 'twoway', 'loop', 'doubleLoop'] as const
export type LineMode = (typeof LINE_MODES)[number]
export const LINE_MODE_LABEL: Record<LineMode, string> = {
  oneway: '单向',
  twoway: '双边',
  loop: '单环',
  doubleLoop: '双环',
}

export const ROUTE_KINDS = ['up', 'down', 'inner', 'outer', 'oneway', 'loop'] as const
export type RouteKind = (typeof ROUTE_KINDS)[number]
export const ROUTE_KIND_LABEL: Record<RouteKind, string> = {
  up: '上行',
  down: '下行',
  inner: '内环',
  outer: '外环',
  oneway: '单向',
  loop: '环线',
}

/** 统一错误码，响应体为 { code, message, details } */
export const ERROR_CODES = {
  validation: 'VALIDATION_FAILED',
  unauthorized: 'UNAUTHORIZED',
  authInvalid: 'AUTH_INVALID',
  authLocked: 'AUTH_LOCKED',
  csrf: 'CSRF_REJECTED',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  duplicate: 'DUPLICATE',
  inUse: 'IN_USE',
  orientationIncompatible: 'ORIENTATION_INCOMPATIBLE',
  extTypeLocked: 'EXT_TYPE_LOCKED',
  uploadRejected: 'UPLOAD_REJECTED',
  amapUnavailable: 'AMAP_UNAVAILABLE',
  internal: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** 写请求必须带的自定义请求头（CSRF 防护） */
export const CSRF_HEADER = 'x-gt-request'

export const PAGE_SIZES = [10, 20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 20
export const MAX_STOP_PHOTOS = 10
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
