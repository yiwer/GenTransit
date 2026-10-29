// 请求体 zod 模式：前端表单与后端 ZodValidationPipe 共用
import { z } from 'zod'
import {
  DICT_CATEGORIES,
  EXT_OWNERS,
  EXT_TYPES,
  LINE_MODE_LABEL,
  LINE_MODES,
  ORIENTATION_MODES,
  REGION_LEVELS,
  ROUTE_KIND_LABEL,
  ROUTE_KINDS,
  STOP_SECTIONS,
} from './enums'
import { LINE_STATUSES, MODE_ROUTE_KINDS, SERVICE_TYPES, TICKET_TYPES, TIME_RE, timesInOrder } from './line'
import { MAX_STOP_PHOTOS } from './enums'
import {
  BOARD_FACES,
  BOARD_KINDS,
  BOARD_NO_MAX,
  PLACEMENTS,
  REMINDER_MAX,
  SHELF_NO_MAX,
  SIZE_MAX_MM,
  SLOT_KINDS,
  SLOT_NO_MAX,
  structureIssues,
} from './sign-set'

/** 英文名：只允许英文字母、数字、空格与常用标点 */
export const EN_NAME_RE = /^[A-Za-z0-9 .,'()&\-/]*$/
const EN_NAME_MSG = '只允许英文字母、数字、空格和常用标点'

const text = (max: number) => z.string().trim().max(max, `不能超过 ${max} 字`)
const required = (max: number) => z.string().trim().min(1, '必填').max(max, `不能超过 ${max} 字`)
const ref = z.uuid().nullable().default(null)
const count = z.number().int('应为整数').min(0, '不能为负数').nullable().default(null)

export const loginInput = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
})
export type LoginInput = z.infer<typeof loginInput>

export const changePasswordInput = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string().min(8, '新密码至少 8 位').max(128, '新密码不能超过 128 位'),
})
export type ChangePasswordInput = z.infer<typeof changePasswordInput>

/* ---------- 设置 ---------- */

export const orientationInput = z.object({ mode: z.enum(ORIENTATION_MODES) })
export type OrientationInput = z.infer<typeof orientationInput>

export const landmarkSettingsInput = z.object({
  landmarkLimit: z.number().int().min(1, '至少 1 个').max(50, '最多 50 个'),
  autoMatch: z.boolean(),
})
export type LandmarkSettingsInput = z.infer<typeof landmarkSettingsInput>

export const EXT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/

const extFieldBody = {
  name: required(30),
  type: z.enum(EXT_TYPES),
  options: z.array(z.string().trim().min(1).max(50)).max(100).default([]),
  description: text(200).default(''),
  section: z.enum(STOP_SECTIONS).nullable().default(null),
  enabled: z.boolean().default(true),
}
const checkOptions = (v: { type: string; options: string[] }, ctx: z.RefinementCtx) => {
  if (v.type === 'select' && v.options.length === 0)
    ctx.addIssue({ code: 'custom', path: ['options'], message: '下拉字段至少要有一个选项' })
  if (new Set(v.options).size !== v.options.length)
    ctx.addIssue({ code: 'custom', path: ['options'], message: '下拉选项不能重复' })
}

export const extFieldCreateInput = z
  .object({
    owner: z.enum(EXT_OWNERS),
    key: z.string().trim().regex(EXT_KEY_RE, '键以字母开头，只含字母、数字和下划线，最多 40 位'),
    ...extFieldBody,
  })
  .superRefine(checkOptions)
export type ExtFieldCreateInput = z.infer<typeof extFieldCreateInput>

/** 键创建后不可修改（扩展字段的值按键存储） */
export const extFieldUpdateInput = z.object(extFieldBody).superRefine(checkOptions)
export type ExtFieldUpdateInput = z.infer<typeof extFieldUpdateInput>

export const reorderInput = z.object({ ids: z.array(z.uuid()).min(1) })
export type ReorderInput = z.infer<typeof reorderInput>

/* ---------- 基础数据 ---------- */

export const dictCreateInput = z.object({ category: z.enum(DICT_CATEGORIES), name: required(50) })
export type DictCreateInput = z.infer<typeof dictCreateInput>

export const renameInput = z.object({ name: required(50) })
export type RenameInput = z.infer<typeof renameInput>

export const regionCreateInput = z
  .object({ level: z.enum(REGION_LEVELS), parentId: z.uuid().nullable().default(null), name: required(50) })
  .superRefine((v, ctx) => {
    if (v.level === 'city' && v.parentId) ctx.addIssue({ code: 'custom', path: ['parentId'], message: '市没有上级' })
    if (v.level !== 'city' && !v.parentId) ctx.addIssue({ code: 'custom', path: ['parentId'], message: '请选择上级' })
  })
export type RegionCreateInput = z.infer<typeof regionCreateInput>

export const companyInput = z.object({
  name: required(100),
  nameEn: text(100).regex(EN_NAME_RE, EN_NAME_MSG).default(''),
  shortName: text(50).default(''),
  logoId: ref,
  hotline: text(50).default(''),
})
export type CompanyInput = z.infer<typeof companyInput>

/* ---------- 地标 ---------- */

const radius = z.number().int('应为整数').min(1, '至少 1 米').max(5000, '最多 5000 米')

export const landmarkCategoryInput = z.object({
  name: required(50),
  icon: text(40).default('landmark'),
  defaultRadius: radius,
  enabled: z.boolean().default(true),
})
export type LandmarkCategoryInput = z.infer<typeof landmarkCategoryInput>

const lng = z.number().min(-180).max(180)
const lat = z.number().min(-90).max(90)

export const landmarkInput = z.object({
  name: required(100),
  nameEn: text(100).regex(EN_NAME_RE, EN_NAME_MSG).default(''),
  categoryId: z.uuid('请选择类别'),
  points: z.array(z.object({ lng, lat, radius })).min(1, '至少要有一个位置点').max(50),
})
export type LandmarkInput = z.infer<typeof landmarkInput>

/* ---------- 站点 ---------- */

export const stopInput = z.object({
  name: required(100),
  // 方位模式下必须是六个方位之一；编码模式下任意非空文本。按当前模式在服务端再校验
  direction: required(50),
  nameEn: text(100).regex(EN_NAME_RE, EN_NAME_MSG).default(''),
  lng,
  lat,
  cityId: ref,
  districtId: ref,
  streetId: ref,
  roadId: ref,
  qrUrl: text(500).default(''),
  berths: count,
  platformTypeId: ref,
  safetyId: ref,
  waiting: text(200).default(''),
  shelterTypeId: ref,
  bigLightbox: count,
  smallLightbox: count,
  seats: count,
  maintainerId: ref,
  remark: text(500).default(''),
  landmarkIds: z.array(z.uuid()).default([]),
  photoIds: z.array(z.uuid()).max(MAX_STOP_PHOTOS, `照片最多 ${MAX_STOP_PHOTOS} 张`).default([]),
  ext: z.record(z.string(), z.unknown()).default({}),
})
export type StopInput = z.infer<typeof stopInput>
export type StopInputRaw = z.input<typeof stopInput>

export const stopUpdateInput = stopInput.extend({ rev: z.number().int().positive() })
export type StopUpdateInput = z.infer<typeof stopUpdateInput>

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
}

export const stopListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  dir: z.string().trim().max(50).optional(),
  cityId: z.uuid().optional(),
  districtId: z.uuid().optional(),
  streetId: z.uuid().optional(),
  roadId: z.uuid().optional(),
  maintainerId: z.uuid().optional(),
  /** 经过的线路：线路 ID，逗号分隔，多选取并集 */
  lineIds: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(50).optional()),
  sort: z.enum(['name', '-name', 'updatedAt', '-updatedAt']).default('name'),
  ...pageQuery,
})
export type StopListQuery = z.infer<typeof stopListQuery>

export const pageInput = z.object(pageQuery)
export type PageInput = z.infer<typeof pageInput>

/* ---------- 线路 ---------- */

const hhmm = z.string().regex(TIME_RE, '时刻应为 HH:mm')

export const routeStopInput = z.object({
  stopId: z.uuid(),
  times: z.array(hhmm).max(500).default([]),
  ext: z.record(z.string(), z.unknown()).default({}),
})
export type RouteStopInput = z.infer<typeof routeStopInput>

export const routeInput = z.object({
  kind: z.enum(ROUTE_KINDS),
  serviceType: z.enum(SERVICE_TYPES).nullable().default(null),
  serviceTime: text(1000).default(''),
  interval: text(500).default(''),
  stops: z.array(routeStopInput).min(2, '每个走向至少要有 2 个站').max(500, '站序最多 500 个站'),
})
export type RouteInput = z.infer<typeof routeInput>

export const lineInput = z
  .object({
    name: required(100),
    number: required(50),
    nameEn: text(100).regex(EN_NAME_RE, EN_NAME_MSG).default(''),
    mode: z.enum(LINE_MODES),
    companyId: ref,
    ticketType: z.enum(TICKET_TYPES).nullable().default(null),
    fareSystemId: ref,
    fare: text(50).default(''),
    ext: z.record(z.string(), z.unknown()).default({}),
    routes: z.array(routeInput),
  })
  .superRefine((v, ctx) => {
    const want = MODE_ROUTE_KINDS[v.mode]
    const got = v.routes.map((r) => r.kind)
    if (got.length !== want.length || want.some((k) => !got.includes(k)))
      ctx.addIssue({
        code: 'custom',
        path: ['routes'],
        message: `${LINE_MODE_LABEL[v.mode]}线路的走向应为：${want.map((k) => ROUTE_KIND_LABEL[k]).join('、')}`,
      })
    v.routes.forEach((r, i) =>
      r.stops.forEach((s, j) => {
        if (!timesInOrder(s.times))
          ctx.addIssue({
            code: 'custom',
            path: ['routes', i, 'stops', j, 'times'],
            message: `${ROUTE_KIND_LABEL[r.kind]}第 ${j + 1} 站的到站时刻没有按先后排列`,
          })
      }),
    )
  })
export type LineInput = z.infer<typeof lineInput>
export type LineInputRaw = z.input<typeof lineInput>

export const lineUpdateInput = lineInput.safeExtend({ rev: z.number().int().positive() })
export type LineUpdateInput = z.infer<typeof lineUpdateInput>

/** 停运、恢复：带 rev */
export const revInput = z.object({ rev: z.number().int().positive() })
export type RevInput = z.infer<typeof revInput>

export const lineListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  mode: z.enum(LINE_MODES).optional(),
  companyId: z.uuid().optional(),
  status: z.enum(LINE_STATUSES).optional(),
  /** 经过的站点 */
  stopId: z.uuid().optional(),
  /** auto = 自动排序规则（需求 5.5.6） */
  sort: z.enum(['auto', 'name', 'updatedAt', '-updatedAt']).default('auto'),
  ...pageQuery,
})
export type LineListQuery = z.infer<typeof lineListQuery>

/** 站名 + 方位批量匹配（粘贴两列文本） */
export const stopMatchInput = z.object({
  rows: z.array(z.object({ name: z.string().trim().max(100), direction: z.string().trim().max(50) })).max(500),
})
export type StopMatchInput = z.infer<typeof stopMatchInput>

/* ---------- 站牌集（M3） ---------- */

const mm = z
  .number()
  .int('应为整数（毫米）')
  .min(1, '应为正整数（毫米）')
  .max(SIZE_MAX_MM, `不能超过 ${SIZE_MAX_MM} 毫米`)

export const slotInput = z.object({
  id: z.uuid(),
  no: z.number().int().min(1, '插片编号从 1 起').max(SLOT_NO_MAX, `插片编号最大 ${SLOT_NO_MAX}`),
  kind: z.enum(SLOT_KINDS),
  note: text(50).default(''),
  width: mm,
  height: mm,
})

export const boardInput = z.object({
  id: z.uuid(),
  no: z.number().int().min(1, '站牌编号从 1 起').max(BOARD_NO_MAX, `站牌编号最大 ${BOARD_NO_MAX}`),
  face: z.enum(BOARD_FACES),
  kind: z.enum(BOARD_KINDS),
  width: mm,
  height: mm,
  remark: text(200).default(''),
  slots: z.array(slotInput).max(SLOT_NO_MAX).default([]),
})

export const shelfInput = z.object({
  id: z.uuid(),
  no: z.number().int().min(1, '站架编号从 1 起').max(SHELF_NO_MAX, `站架编号最大 ${SHELF_NO_MAX}`),
  typeId: z.uuid('请选择站架类型'),
  name: text(50).default(''),
  desc: text(200).default(''),
  noPhysical: z.boolean().default(false),
  material: text(200).default(''),
  boards: z.array(boardInput).max(BOARD_NO_MAX).default([]),
})

export const scheduleInput = z.object({
  routeId: z.uuid(),
  pass: z.number().int().min(1),
  placement: z.enum(PLACEMENTS),
  boardId: z.uuid().nullable().default(null),
  slotId: z.uuid().nullable().default(null),
  order: z.number().int().min(1).nullable().default(null),
})

/** 整个站牌集一次保存（BR-18）；结构与 BR-06、BR-07 在这里校验，途经相关规则在服务端按当前途经校验 */
export const signSetInput = z
  .object({
    rev: z.number().int().positive(),
    reminder: text(REMINDER_MAX).default(''),
    shelves: z.array(shelfInput).max(SHELF_NO_MAX),
    schedules: z.array(scheduleInput).max(2000),
  })
  .superRefine((v, ctx) => {
    for (const i of structureIssues(v)) ctx.addIssue({ code: 'custom', path: i.path.split('.'), message: i.message })
  })
export type SignSetInput = z.infer<typeof signSetInput>
export type SignSetInputRaw = z.input<typeof signSetInput>

const csvUuids = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
  .pipe(z.array(z.uuid()).max(50).optional())

export const signSetListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  streetId: z.uuid().optional(),
  roadId: z.uuid().optional(),
  lineIds: csvUuids,
  shelfTypeIds: csvUuids,
  /** 站牌尺寸，如 1200x1800 */
  boardSize: z
    .string()
    .trim()
    .regex(/^\d{1,5}x\d{1,5}$/, '尺寸格式为 宽x高')
    .optional(),
  /** 只看待处理（有待编排或失效） */
  pending: z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  sort: z.enum(['name', '-pending', '-updatedAt']).default('name'),
  ...pageQuery,
})
export type SignSetListQuery = z.infer<typeof signSetListQuery>

export const templateSlotInput = slotInput.omit({ id: true })
export const templateBoardInput = boardInput.omit({ id: true, no: true }).extend({
  slots: z.array(templateSlotInput).max(SLOT_NO_MAX).default([]),
})

export const shelfTemplateInput = z
  .object({
    name: required(50),
    typeId: z.uuid('请选择站架类型'),
    desc: text(200).default(''),
    noPhysical: z.boolean().default(false),
    imageId: ref,
    boards: z.array(templateBoardInput).max(20, '一个模板最多 20 块站牌'),
  })
  .superRefine((v, ctx) => {
    v.boards.forEach((b, i) => {
      if (b.kind === 'whole' && b.slots.length)
        ctx.addIssue({ code: 'custom', path: ['boards', i, 'slots'], message: '整版站牌不能有插片' })
      const nos = new Set<number>()
      b.slots.forEach((s, j) => {
        if (nos.has(s.no))
          ctx.addIssue({ code: 'custom', path: ['boards', i, 'slots', j, 'no'], message: '插片编号重复' })
        nos.add(s.no)
        if (s.kind === 'other' && !s.note)
          ctx.addIssue({ code: 'custom', path: ['boards', i, 'slots', j, 'note'], message: '非线路插片要写说明' })
      })
    })
  })
export type ShelfTemplateInput = z.infer<typeof shelfTemplateInput>
export type ShelfTemplateInputRaw = z.input<typeof shelfTemplateInput>

export const lineImpactQuery = z.object({
  /** 只统计将删除的走向（改模式） */
  kinds: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.enum(ROUTE_KINDS)).optional()),
})
export type LineImpactQuery = z.infer<typeof lineImpactQuery>
