// 导入：任务、预览与结果的数据形状（需求 5.10，M2 计划 3.4）
import type { CoordSystem } from './geo'
import type { DiffEntry } from './snapshot'

export const IMPORT_KINDS = ['stop', 'line'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]
export const IMPORT_KIND_LABEL: Record<ImportKind, string> = { stop: '站点', line: '线路' }

export const IMPORT_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]
export const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  cancelled: '已取消',
  expired: '已过期',
}

/** 导入文件上限（默认决定 7） */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024
/** 导入任务有效期 */
export const IMPORT_TTL_MS = 24 * 3600 * 1000

export interface ImportOptions {
  /** 站点导入的坐标系 */
  coordSystem?: CoordSystem
}

export interface ImportItem {
  /** 对象的业务键：站点为"站名（方位）"，线路为管理编号 */
  key: string
  name: string
}

export interface ImportChange extends ImportItem {
  /** 改动字段或站序差异（复用快照差异） */
  diff: DiffEntry[]
}

export interface ImportFailure {
  sheet: string
  /** Excel 行号（含表头，从 1 起）；线路失败时为该线路涉及的全部行 */
  rows: number[]
  key: string
  reasons: string[]
  /** 线路导入：匹配不上的站点"站名（方位）" */
  unmatchedStops?: string[]
}

export interface ImportNewRef {
  /** 路段、维护公司、市、区、街道…… */
  category: string
  name: string
  /** 行政区划的上级路径，如"示例市 · 中心区" */
  parent?: string
}

export interface ImportRemovedRoutes {
  key: string
  name: string
  routes: string[]
}

export interface ImportPreview {
  kind: ImportKind
  rows: number
  created: ImportItem[]
  updated: ImportChange[]
  unchanged: number
  failures: ImportFailure[]
  /** 站点导入：将新建的字典项与行政区划 */
  newRefs: ImportNewRef[]
  /** 线路导入：改模式将删除的走向 */
  removedRoutes: ImportRemovedRoutes[]
}

export interface ImportJobView {
  id: string
  kind: ImportKind
  status: ImportStatus
  fileName: string
  options: ImportOptions
  preview: ImportPreview
  createdAt: string
  expiresAt: string
}

export interface ImportResult {
  created: number
  updated: number
  unchanged: number
  failed: number
  newRefs: number
}
