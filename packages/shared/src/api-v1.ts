// 只读 API /api/v1 的输出结构与查询参数（M4 计划第 3 节）。
// 服务端按这些模式生成 OpenAPI 文档（z.toJSONSchema），契约测试用它们严格校验响应
import { z } from 'zod'
import {
  DICT_CATEGORIES,
  DICT_CATEGORY_LABEL,
  EXT_OWNERS,
  EXT_OWNER_LABEL,
  EXT_TYPES,
  EXT_TYPE_LABEL,
  LINE_MODES,
  LINE_MODE_LABEL,
  REGION_LEVELS,
  REGION_LEVEL_LABEL,
  ROUTE_KINDS,
  ROUTE_KIND_LABEL,
  STOP_SECTIONS,
  STOP_SECTION_LABEL,
} from './enums'
import {
  LINE_STATUSES,
  LINE_STATUS_LABEL,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  TICKET_TYPES,
  TICKET_TYPE_LABEL,
} from './line'
import {
  BOARD_FACES,
  BOARD_FACE_LABEL,
  BOARD_KINDS,
  BOARD_KIND_LABEL,
  SCHEDULE_STATUSES,
  SCHEDULE_STATUS_LABEL,
  SLOT_KINDS,
  SLOT_KIND_LABEL,
} from './sign-set'

export const API_V1_PREFIX = '/api/v1'

/** 默认与最大每页条数；线路、站牌集内容大，最大 100（默认决定 23） */
export const V1_LIMIT_DEFAULT = 100
export const V1_LIMIT_MAX = 500
export const V1_LIMIT_MAX_HEAVY = 100

/** 枚举的说明：代码值与中文名（默认决定 12） */
const enumOf = <T extends string>(values: readonly [T, ...T[]], labels: Record<T, string>, what: string) =>
  z.enum(values).describe(`${what}：${values.map((v) => `${v}=${labels[v]}`).join('，')}`)

const id = z.uuid()
const time = z.iso.datetime().describe('ISO 8601 UTC 时间，带毫秒，如 2026-10-28T08:00:00.000Z')

/** 引用其他对象：名称取当前值；被引用对象改名不算引用方"有变化" */
export const v1Ref = z.strictObject({ id, name: z.string() }).describe('引用：{ id, name }，name 为当前名称')
/** 站点引用另带方位（同名站点靠方位区分） */
export const v1StopRef = z
  .strictObject({ id, name: z.string(), direction: z.string() })
  .describe('站点引用：{ id, name, direction }')
/** 文件：相对地址，用同一个 Token 下载 */
export const v1File = z
  .strictObject({ id, url: z.string().describe('相对地址 /api/v1/files/{id}，用同一个 Token 下载') })
  .describe('文件')

export const v1Ext = z
  .record(z.string(), z.union([z.string(), z.number(), z.array(z.string())]))
  .describe(
    '扩展字段 { 键: 值 }，只含启用中的字段。文本、下拉为字符串；数字为数字；日期 YYYY-MM-DD；时间 HH:mm；文本列表为字符串数组。字段定义见 /api/v1/ext-fields',
  )

const nullable = <T extends z.ZodType>(t: T) => t.nullable()
const stamps = { createdAt: time, changedAt: time.describe('"有变化"的时间，增量同步按它筛选与排序') }

/* ---------------- 资源 ---------------- */

export const v1Stop = z
  .strictObject({
    id,
    name: z.string(),
    direction: z.string().describe('方位或编码'),
    nameEn: z.string(),
    lng: z.number().describe('经度，GCJ-02（高德坐标系）'),
    lat: z.number().describe('纬度，GCJ-02（高德坐标系）'),
    city: nullable(v1Ref),
    district: nullable(v1Ref),
    street: nullable(v1Ref),
    road: nullable(v1Ref).describe('路段（字典项）'),
    qrUrl: z.string(),
    facilities: z.strictObject({
      berths: nullable(z.number().int()),
      platformType: nullable(v1Ref),
      safety: nullable(v1Ref),
      waiting: z.string(),
      shelterType: nullable(v1Ref),
      bigLightbox: nullable(z.number().int()),
      smallLightbox: nullable(z.number().int()),
      seats: nullable(z.number().int()),
    }),
    maintainer: nullable(v1Ref).describe('维护公司（字典项）'),
    remark: z.string(),
    landmarks: z.array(v1Ref),
    photos: z.array(v1File),
    ext: v1Ext,
    ...stamps,
  })
  .describe('站点')

export const v1RouteStop = z.strictObject({
  seq: z.number().int().describe('站序，从 1 起'),
  stop: v1StopRef,
  pass: z.number().int().describe('第几次途经该站点（环线可能多次经过同一站点），从 1 起'),
  times: z.array(z.string()).describe('到站时刻 HH:mm'),
  ext: v1Ext,
})

export const v1Track = z
  .strictObject({
    points: z.array(z.tuple([z.number(), z.number()])).describe('坐标 [经度, 纬度]，GCJ-02，按行驶顺序'),
    distance: z.number().int().describe('路程，米'),
    computedAt: time,
    stale: z.boolean().describe('计算之后站序或站点坐标变了：轨迹已过期，需要重新计算'),
  })
  .describe('走向轨迹：按站序调用高德驾车路径规划算出，在系统里手动计算')

export const v1Route = z.strictObject({
  id,
  kind: enumOf(ROUTE_KINDS, ROUTE_KIND_LABEL, '走向种类'),
  serviceType: nullable(enumOf(SERVICE_TYPES, SERVICE_TYPE_LABEL, '服务类型')),
  serviceTime: z.string(),
  interval: z.string(),
  stops: z.array(v1RouteStop),
  track: nullable(v1Track).describe('走向轨迹；没算过为 null'),
})

export const v1Line = z
  .strictObject({
    id,
    name: z.string(),
    number: z.string().describe('管理编号'),
    nameEn: z.string(),
    mode: enumOf(LINE_MODES, LINE_MODE_LABEL, '线路模式'),
    status: enumOf(LINE_STATUSES, LINE_STATUS_LABEL, '状态'),
    ticketType: nullable(enumOf(TICKET_TYPES, TICKET_TYPE_LABEL, '售票类型')),
    fareSystem: nullable(v1Ref).describe('票制（字典项）'),
    fare: z.string().describe('票价'),
    company: nullable(v1Ref).describe('公交公司'),
    ext: v1Ext,
    routes: z.array(v1Route),
    ...stamps,
  })
  .describe('线路')

export const v1Slot = z.strictObject({
  id,
  no: z.number().int(),
  kind: enumOf(SLOT_KINDS, SLOT_KIND_LABEL, '插片类型'),
  note: z.string().describe('非线路插片的说明'),
  width: z.number().int().describe('毫米'),
  height: z.number().int().describe('毫米'),
})

export const v1Board = z.strictObject({
  id,
  no: z.number().int(),
  face: enumOf(BOARD_FACES, BOARD_FACE_LABEL, '面'),
  kind: enumOf(BOARD_KINDS, BOARD_KIND_LABEL, '站牌类型'),
  width: z.number().int().describe('毫米'),
  height: z.number().int().describe('毫米'),
  remark: z.string(),
  slots: z.array(v1Slot),
})

export const v1Shelf = z.strictObject({
  id,
  no: z.number().int(),
  type: v1Ref.describe('站架类型（字典项）'),
  name: z.string(),
  desc: z.string(),
  noPhysical: z.boolean().describe('无实物站架'),
  material: z.string(),
  sort: z.number().int().describe('立面上从左到右的顺序，从 0 起'),
  boards: z.array(v1Board),
})

export const v1Place = z.strictObject({
  boardId: id,
  slotId: nullable(id).describe('放在插片上时为插片 ID；放在整版站牌上为 null'),
  order: nullable(z.number().int()).describe('整版站牌上的顺序，从 1 起；插片上为 null'),
})

export const v1Passage = z.strictObject({
  line: v1Ref,
  route: z.strictObject({ id, kind: enumOf(ROUTE_KINDS, ROUTE_KIND_LABEL, '走向种类') }),
  pass: z.number().int().describe('第几次途经本站'),
  status: enumOf(SCHEDULE_STATUSES, SCHEDULE_STATUS_LABEL, '编排状态'),
  places: z.array(v1Place).describe('放置位置；待编排、隐藏为空'),
})

export const v1Counts = z.strictObject({
  waiting: z.number().int(),
  placed: z.number().int(),
  hidden: z.number().int(),
  invalid: z.number().int(),
})

export const v1SignSet = z
  .strictObject({
    id,
    stop: v1StopRef,
    reminder: z.string().describe('温馨提示'),
    shelves: z.array(v1Shelf),
    passages: z
      .array(v1Passage)
      .describe('按途经归组；用（走向 ID，站点 ID，第几次途经）与线路的路径站对应。待编排的途经也列出'),
    counts: v1Counts,
    changedAt: time.describe('"有变化"的时间：自身保存、连带修改，以及线路引起的途经变化'),
  })
  .describe('站牌集')

export const v1LandmarkCategory = z
  .strictObject({
    id,
    name: z.string(),
    icon: z.string(),
    defaultRadius: z.number().int().describe('米'),
    enabled: z.boolean(),
    ...stamps,
  })
  .describe('地标类别')

export const v1Landmark = z
  .strictObject({
    id,
    name: z.string(),
    nameEn: z.string(),
    category: v1Ref,
    points: z.array(
      z.strictObject({
        lng: z.number().describe('GCJ-02'),
        lat: z.number().describe('GCJ-02'),
        radius: z.number().int().describe('辐射半径，米'),
      }),
    ),
    ...stamps,
  })
  .describe('地标')

export const v1DictItem = z
  .strictObject({ id, category: enumOf(DICT_CATEGORIES, DICT_CATEGORY_LABEL, '字典类别'), name: z.string(), ...stamps })
  .describe('字典项')

export const v1Region = z
  .strictObject({
    id,
    level: enumOf(REGION_LEVELS, REGION_LEVEL_LABEL, '级别'),
    name: z.string(),
    parentId: nullable(id),
    ...stamps,
  })
  .describe('行政区划')

export const v1BusCompany = z
  .strictObject({
    id,
    name: z.string(),
    nameEn: z.string(),
    shortName: z.string(),
    logo: nullable(v1File),
    hotline: z.string(),
    ...stamps,
  })
  .describe('公交公司')

export const v1ShelfTemplate = z
  .strictObject({
    id,
    name: z.string(),
    type: v1Ref.describe('站架类型（字典项）'),
    desc: z.string(),
    noPhysical: z.boolean(),
    image: nullable(v1File).describe('示意图'),
    boards: z.array(
      z.strictObject({
        face: enumOf(BOARD_FACES, BOARD_FACE_LABEL, '面'),
        kind: enumOf(BOARD_KINDS, BOARD_KIND_LABEL, '站牌类型'),
        width: z.number().int(),
        height: z.number().int(),
        remark: z.string(),
        slots: z.array(
          z.strictObject({
            no: z.number().int(),
            kind: enumOf(SLOT_KINDS, SLOT_KIND_LABEL, '插片类型'),
            note: z.string(),
            width: z.number().int(),
            height: z.number().int(),
          }),
        ),
      }),
    ),
    ...stamps,
  })
  .describe('站架模板')

export const v1ExtField = z
  .strictObject({
    id,
    owner: enumOf(EXT_OWNERS, EXT_OWNER_LABEL, '归属'),
    key: z.string(),
    name: z.string(),
    type: enumOf(EXT_TYPES, EXT_TYPE_LABEL, '类型'),
    options: z.array(z.string()).describe('下拉选项'),
    description: z.string(),
    section: nullable(enumOf(STOP_SECTIONS, STOP_SECTION_LABEL, '站点字段的显示分区')),
    enabled: z.boolean(),
    sort: z.number().int(),
    ...stamps,
  })
  .describe('扩展字段定义')

export const DELETED_TYPES = [
  'stop',
  'line',
  'signSet',
  'landmark',
  'landmarkCategory',
  'dictItem',
  'region',
  'busCompany',
  'shelfTemplate',
] as const
export type DeletedType = (typeof DELETED_TYPES)[number]
export const DELETED_TYPE_LABEL: Record<DeletedType, string> = {
  stop: '站点',
  line: '线路',
  signSet: '站牌集',
  landmark: '地标',
  landmarkCategory: '地标类别',
  dictItem: '字典项',
  region: '行政区划',
  busCompany: '公交公司',
  shelfTemplate: '站架模板',
}
/** 墓碑表记录的类型（站点、线路、站牌集的删除记在快照里） */
export const TOMBSTONE_TYPES = DELETED_TYPES.filter(
  (t): t is Exclude<DeletedType, 'stop' | 'line' | 'signSet'> => !['stop', 'line', 'signSet'].includes(t),
)

export const v1Deleted = z
  .strictObject({
    type: enumOf(DELETED_TYPES, DELETED_TYPE_LABEL, '类型'),
    id,
    name: z.string().describe('删除时的名称'),
    deletedAt: time,
  })
  .describe('已删除对象')

export const v1Error = z
  .object({
    code: z.string().describe('UNAUTHORIZED、NOT_FOUND、VALIDATION_FAILED 等'),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .describe('错误')

/** 列表页：游标分页，不返回总数（默认决定 4） */
export const v1PageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable().describe('下一页的游标；null 表示本轮已取完'),
    nextUpdatedSince: time.describe('本轮的水位：本轮取完后记下，下一轮作为 updatedSince 传入。本轮各页的值相同'),
  })

export interface V1Page<T> {
  items: T[]
  nextCursor: string | null
  nextUpdatedSince: string
}

/* ---------------- 查询参数 ---------------- */

/** 列表通用参数；max 为最大每页条数 */
export const v1ListQuery = (max = V1_LIMIT_MAX) =>
  z.object({
    updatedSince: z.iso
      .datetime({ offset: true })
      .optional()
      .describe('只返回"有变化"时间晚于它的对象；首次全量同步不传，之后传上一轮的 nextUpdatedSince'),
    cursor: z.string().max(500).optional().describe('上一页返回的 nextCursor；翻页时其余参数要与第一页相同'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(max)
      .default(V1_LIMIT_DEFAULT)
      .describe(`每页条数，默认 ${V1_LIMIT_DEFAULT}，最大 ${max}`),
  })
export type V1ListQuery = z.infer<ReturnType<typeof v1ListQuery>>

export const v1DictQuery = v1ListQuery().extend({
  category: enumOf(DICT_CATEGORIES, DICT_CATEGORY_LABEL, '字典类别').optional(),
})
export const v1DeletedQuery = v1ListQuery().extend({
  type: enumOf(DELETED_TYPES, DELETED_TYPE_LABEL, '只看某一类型').optional(),
})

export type V1Stop = z.infer<typeof v1Stop>
export type V1Line = z.infer<typeof v1Line>
export type V1SignSet = z.infer<typeof v1SignSet>
export type V1Passage = z.infer<typeof v1Passage>
export type V1Landmark = z.infer<typeof v1Landmark>
export type V1LandmarkCategory = z.infer<typeof v1LandmarkCategory>
export type V1DictItem = z.infer<typeof v1DictItem>
export type V1Region = z.infer<typeof v1Region>
export type V1BusCompany = z.infer<typeof v1BusCompany>
export type V1ShelfTemplate = z.infer<typeof v1ShelfTemplate>
export type V1ExtField = z.infer<typeof v1ExtField>
export type V1Deleted = z.infer<typeof v1Deleted>

/* ---------------- API Token（设置页签，登录会话） ---------------- */

export const API_TOKEN_PREFIX = 'gt_'
/** gt_ + 32 字节随机数的 base64url（43 个字符） */
export const API_TOKEN_RE = /^gt_[A-Za-z0-9_-]{43}$/

export const apiTokenInput = z.object({
  name: z.string().trim().min(1, '请填写名称').max(50, '名称不超过 50 字'),
})
export type ApiTokenInput = z.infer<typeof apiTokenInput>

export interface ApiTokenItem {
  id: string
  name: string
  /** 明文的前 10 个字符，用于辨认 */
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

/** 新建结果：明文只在这一次返回 */
export interface ApiTokenCreated extends ApiTokenItem {
  token: string
}

/* ---------------- 备份状态（设置"备份"页签、工作台提醒） ---------------- */

export type BackupDayStatus = 'ok' | 'failed' | 'missing'

export interface BackupDay {
  /** 本地日期 YYYY-MM-DD */
  date: string
  status: BackupDayStatus
  /** 当天最后一份成功备份的大小（数据库导出 + 上传文件，字节） */
  size: number | null
}

export interface BackupStatus {
  /** 没有配置 BACKUP_DIR 时为 false，其余字段为空 */
  configured: boolean
  retentionDays: number
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  lastError: string | null
  latest: { name: string; size: number; createdAt: string } | null
  /** 最近 30 天，从早到晚 */
  days: BackupDay[]
  /** 需要提醒：最近一次成功超过 48 小时，或最近一次尝试失败 */
  alert: 'stale' | 'failed' | null
}

/** 备份超过多久算过期（毫秒） */
export const BACKUP_STALE_MS = 48 * 3600 * 1000

/** 工作台的总数：站点、线路、站牌（所有站牌集里的站牌块数） */
export interface SystemTotals {
  stops: number
  lines: number
  boards: number
}
