// 站点导入导出（需求 5.10.2、5.11；M2 计划 3.4、3.5）
// 分析阶段只读：把文件解析成"计划"（新建的字典项与区划、新增、修改）和预览；确认时重新分析，计划哈希一致才写入
import {
  DICT_CATEGORY_LABEL,
  DIRECTIONS,
  EN_NAME_RE,
  REGION_LEVEL_LABEL,
  checkExtValue,
  formatExtValue,
  isDirection,
  normalizeTime,
  signSetSnapshot,
  stopLabel,
  stopSnapshot,
  toGcj02,
  type CoordSystem,
  type DictCategory,
  type DiffEntry,
  type ExtType,
  type ImportPreview,
  type OrientationMode,
  type RegionLevel,
} from '@gentransit/shared'
import type { Prisma } from '../generated/prisma/client'
import type { Tx } from '../prisma/prisma.service'
import { compareHash } from '../snapshots/snapshot.service'
import { STOP_DETAIL_INCLUDE, type StopService } from '../stops/stop.service'
import { uuidv7 } from '../common/uuid'
import type { ColumnSpec, Sheet, SheetSpec } from './excel'

export const STOP_SHEET = '站点'

/* ---------------- 列 ---------------- */

type RefKey =
  'cityId' | 'districtId' | 'streetId' | 'roadId' | 'maintainerId' | 'platformTypeId' | 'safetyId' | 'shelterTypeId'

export interface StopValues {
  name: string
  direction: string
  nameEn: string
  lng: number
  lat: number
  cityId: string | null
  districtId: string | null
  streetId: string | null
  roadId: string | null
  maintainerId: string | null
  platformTypeId: string | null
  safetyId: string | null
  shelterTypeId: string | null
  remark: string
  qrUrl: string
  waiting: string
  berths: number | null
  bigLightbox: number | null
  smallLightbox: number | null
  seats: number | null
  ext: Record<string, unknown>
}

type Col =
  | { kind: 'text'; key: 'nameEn' | 'remark' | 'qrUrl' | 'waiting'; header: string; max: number }
  | { kind: 'int'; key: 'berths' | 'bigLightbox' | 'smallLightbox' | 'seats'; header: string }
  | { kind: 'dict'; key: RefKey; header: string; category: DictCategory }
  | { kind: 'region'; key: 'cityId' | 'districtId' | 'streetId'; header: string; level: RegionLevel }

/** 模板列（需求 5.10.2 的顺序）；站名、方位与经纬度单独处理 */
const COLS: Col[] = [
  { kind: 'text', key: 'nameEn', header: '英文名', max: 100 },
  { kind: 'region', key: 'cityId', header: '市', level: 'city' },
  { kind: 'region', key: 'districtId', header: '区', level: 'district' },
  { kind: 'region', key: 'streetId', header: '街道', level: 'street' },
  { kind: 'dict', key: 'roadId', header: '路段', category: 'road' },
  { kind: 'dict', key: 'maintainerId', header: '维护公司', category: 'maintainer' },
  { kind: 'text', key: 'remark', header: '备注', max: 500 },
  { kind: 'text', key: 'qrUrl', header: '二维码 URL', max: 500 },
  { kind: 'int', key: 'berths', header: '泊位数' },
  { kind: 'dict', key: 'platformTypeId', header: '站台类型', category: 'platformType' },
  { kind: 'dict', key: 'safetyId', header: '安全设施', category: 'safety' },
  { kind: 'text', key: 'waiting', header: '候车设施', max: 200 },
  { kind: 'dict', key: 'shelterTypeId', header: '候车亭类型', category: 'shelterType' },
  { kind: 'int', key: 'bigLightbox', header: '大灯箱数' },
  { kind: 'int', key: 'smallLightbox', header: '小灯箱数' },
  { kind: 'int', key: 'seats', header: '座椅数' },
]

export interface ExtDefRow {
  key: string
  name: string
  type: ExtType
  options: string[]
  enabled: boolean
}

const dirHeader = (mode: OrientationMode) => (mode === 'code' ? '编码' : '方位')

/** 模板与导出的列：站名*、方位*、英文名、经度、纬度、市、区……、站台设施 8 项、扩展字段 */
export function stopColumns(mode: OrientationMode, ext: ExtDefRow[]): ColumnSpec[] {
  return [
    { header: '站名*', width: 16 },
    { header: `${dirHeader(mode)}*`, width: 8 },
    { header: '英文名', width: 20 },
    { header: '经度', width: 12, numFmt: '0.000000' },
    { header: '纬度', width: 12, numFmt: '0.000000' },
    ...COLS.slice(1).map((c) => ({
      header: c.header,
      width: c.kind === 'text' ? 18 : 12,
      numFmt: c.kind === 'int' ? '0' : undefined,
    })),
    ...ext.filter((d) => d.enabled).map((d) => ({ header: d.name, width: 14 })),
  ]
}

export function stopNotes(mode: OrientationMode): string[] {
  return [
    '每行一个站点，按"站名 + 方位"匹配：库里有则修改，没有则新增。导入不会删除任何站点。',
    '修改已有站点时，空单元格表示该项不改。',
    `${dirHeader(mode)}：${mode === 'code' ? '任意非空文本（当前为编码模式）' : `${DIRECTIONS.join('、')}之一`}。`,
    '经纬度：新增站点必填；坐标系在导入时选择（GCJ-02、BD-09、WGS-84），统一转换为 GCJ-02 保存。',
    '市、区、街道按名称逐级匹配；路段、维护公司、站台类型、安全设施、候车亭类型按名称匹配。库里没有的会在预览里列出，确认导入时一起新建。',
    '泊位数、灯箱数、座椅数填非负整数。扩展字段：日期填 YYYY-MM-DD，时间填 HH:mm，文本列表用顿号分隔。',
    '照片与地标不通过导入维护。',
  ]
}

/* ---------------- 上下文：一次读进内存，不逐行查询 ---------------- */

interface Existing extends StopValues {
  id: string
  rev: number
}

export interface StopCtx {
  mode: OrientationMode
  regions: { id: string; level: RegionLevel; parentId: string | null; name: string }[]
  dicts: { id: string; category: DictCategory; name: string }[]
  ext: ExtDefRow[]
  stops: Map<string, Existing>
}

const stopKey = (name: string, direction: string) => `${name}\u0000${direction}`

export async function loadStopCtx(db: Tx): Promise<StopCtx> {
  const [setting, regions, dicts, ext, stops] = await Promise.all([
    db.setting.findUniqueOrThrow({ where: { id: 1 } }),
    db.region.findMany({ select: { id: true, level: true, parentId: true, name: true } }),
    db.dictItem.findMany({ select: { id: true, category: true, name: true } }),
    db.extField.findMany({ where: { owner: 'stop' }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] }),
    db.stop.findMany({
      select: {
        id: true,
        rev: true,
        name: true,
        direction: true,
        nameEn: true,
        lng: true,
        lat: true,
        cityId: true,
        districtId: true,
        streetId: true,
        roadId: true,
        maintainerId: true,
        platformTypeId: true,
        safetyId: true,
        shelterTypeId: true,
        remark: true,
        qrUrl: true,
        waiting: true,
        berths: true,
        bigLightbox: true,
        smallLightbox: true,
        seats: true,
        ext: true,
      },
    }),
  ])
  return {
    mode: setting.orientationMode,
    regions,
    dicts,
    ext,
    stops: new Map(
      stops.map((s) => [stopKey(s.name, s.direction), { ...s, ext: (s.ext ?? {}) as Record<string, unknown> }]),
    ),
  }
}

/* ---------------- 分析 ---------------- */

export interface NewRef {
  token: string
  kind: 'dict' | 'region'
  name: string
  category?: DictCategory
  level?: RegionLevel
  /** 区划的上级：已有 ID 或另一个新建令牌 */
  parent?: string | null
}

export interface StopPlan {
  newRefs: NewRef[]
  creates: { key: string; values: StopValues }[]
  /** rev：分析时的版本，写进计划使"确认时数据已变化"能被计划哈希发现 */
  updates: { id: string; rev: number; key: string; values: Partial<StopValues>; labels: string[] }[]
}

export interface FailedRow {
  sheet: string
  row: number
  values: string[]
  reason: string
}

export interface Analysis<P> {
  preview: ImportPreview
  plan: P
  failedRows: FailedRow[]
  headers: Record<string, string[]>
}

const isToken = (v: unknown): v is string => typeof v === 'string' && v.startsWith('new:')

/** 扩展字段单元格 → 取值（按类型解析后再按定义校验） */
export function parseExtCell(def: ExtDefRow, text: string) {
  let raw: unknown = text
  if (def.type === 'number') raw = Number(text)
  if (def.type === 'time') raw = normalizeTime(text) ?? text
  if (def.type === 'textList') raw = text.split(/[、,，;；\n]/).map((x) => x.trim())
  return checkExtValue(def, raw)
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function analyzeStops(sheets: Sheet[], coord: CoordSystem, ctx: StopCtx): Analysis<StopPlan> {
  const sheet = sheets.find((s) => s.name === STOP_SHEET) ?? sheets.find((s) => s.name !== '说明') ?? sheets[0]
  const preview: ImportPreview = {
    kind: 'stop',
    rows: sheet?.rows.length ?? 0,
    created: [],
    updated: [],
    unchanged: 0,
    failures: [],
    newRefs: [],
    removedRoutes: [],
  }
  const plan: StopPlan = { newRefs: [], creates: [], updates: [] }
  const failedRows: FailedRow[] = []
  if (!sheet) return { preview, plan, failedRows, headers: {} }

  const enabledExt = ctx.ext.filter((d) => d.enabled)
  const dictByName = new Map(ctx.dicts.map((d) => [`${d.category}\u0000${d.name}`, d.id]))
  const nameOf = new Map<string, string>([
    ...ctx.dicts.map((d) => [d.id, d.name] as const),
    ...ctx.regions.map((r) => [r.id, r.name] as const),
  ])
  const regionPath = (id: string | null | undefined): string => {
    if (!id) return ''
    if (isToken(id)) {
      const ref = plan.newRefs.find((x) => x.token === id)
      return ref ? [regionPath(ref.parent), ref.name].filter(Boolean).join(' · ') : ''
    }
    const r = ctx.regions.find((x) => x.id === id)
    return r ? [regionPath(r.parentId), r.name].filter(Boolean).join(' · ') : ''
  }
  const singleCity = ctx.regions.filter((r) => r.level === 'city')
  const seen = new Map<string, number>()
  const known = new Set(plan.newRefs.map((r) => r.token))

  for (const row of sheet.rows) {
    const reasons: string[] = []
    const rowRefs: NewRef[] = []
    const name = row.get('站名')
    const direction = row.get('方位') || row.get('编码')
    if (!name) reasons.push('缺少站名')
    else if (name.length > 100) reasons.push('站名不能超过 100 字')
    if (!direction) reasons.push(`缺少${dirHeader(ctx.mode)}`)
    else if (ctx.mode === 'orientation' && !isDirection(direction))
      reasons.push(`方位「${direction}」不是${DIRECTIONS.join('、')}之一`)
    else if (direction.length > 50) reasons.push('编码不能超过 50 字')
    const key = stopLabel({ name, direction })
    if (name && direction) {
      const first = seen.get(stopKey(name, direction))
      if (first) reasons.push(`与第 ${first} 行重复`)
      else seen.set(stopKey(name, direction), row.row)
    }
    const existing = ctx.stops.get(stopKey(name, direction))
    const values: Partial<StopValues> = {}

    // 经纬度
    const lngText = row.get('经度')
    const latText = row.get('纬度')
    if (lngText || latText) {
      const lng = Number(lngText)
      const lat = Number(latText)
      if (!lngText || !latText) reasons.push('经度和纬度要同时填写')
      else if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
        reasons.push('经纬度不是合法的数字')
      else [values.lng, values.lat] = toGcj02(lng, lat, coord)
    } else if (!existing) reasons.push('新增站点必须填写经纬度')

    // 区划：逐级匹配；上级取本行填写的，否则取已有站点的，库里只有一个市时取那个市
    let parent: string | null = null
    for (const c of COLS.filter((x) => x.kind === 'region')) {
      const text = row.get(c.header)
      const level = c.level
      if (level === 'city') {
        if (text) {
          const hit = ctx.regions.find((r) => r.level === 'city' && r.name === text)
          parent = hit?.id ?? `new:region:city::${text}`
          if (!hit) rowRefs.push({ token: parent, kind: 'region', level, name: text, parent: null })
          values.cityId = parent
        } else parent = existing?.cityId ?? (singleCity.length === 1 ? singleCity[0].id : null)
        continue
      }
      if (!text) {
        parent = existing?.[c.key] ?? null
        continue
      }
      if (text.length > 50) {
        reasons.push(`${c.header}名称不能超过 50 字`)
        continue
      }
      if (!parent) {
        reasons.push(`${c.header}「${text}」找不到所属的${level === 'district' ? '市' : '区'}，请同时填写上级`)
        continue
      }
      const hit = isToken(parent)
        ? undefined
        : ctx.regions.find((r) => r.level === level && r.parentId === parent && r.name === text)
      const id = hit?.id ?? `new:region:${level}:${parent}:${text}`
      if (!hit && !rowRefs.some((x) => x.token === id))
        rowRefs.push({ token: id, kind: 'region', level, name: text, parent })
      values[c.key] = id
      parent = id
    }

    for (const c of COLS) {
      const text = row.get(c.header)
      if (!text || c.kind === 'region') continue
      if (c.kind === 'text') {
        if (text.length > c.max) reasons.push(`${c.header}不能超过 ${c.max} 字`)
        else if (c.key === 'nameEn' && !EN_NAME_RE.test(text))
          reasons.push('英文名只允许英文字母、数字、空格和常用标点')
        else values[c.key] = text
      } else if (c.kind === 'int') {
        const n = Number(text)
        if (!Number.isInteger(n) || n < 0) reasons.push(`${c.header}应为非负整数`)
        else values[c.key] = n
      } else {
        if (text.length > 50) {
          reasons.push(`${c.header}名称不能超过 50 字`)
          continue
        }
        const id = dictByName.get(`${c.category}\u0000${text}`) ?? `new:dict:${c.category}:${text}`
        if (isToken(id) && !rowRefs.some((x) => x.token === id))
          rowRefs.push({ token: id, kind: 'dict', category: c.category, name: text })
        values[c.key] = id
      }
    }

    // 扩展字段：修改时只改填写了的字段，其余保留
    const extIn: Record<string, unknown> = {}
    for (const d of enabledExt) {
      const text = row.get(d.name)
      if (!text) continue
      const r = parseExtCell(d, text)
      if (!r.ok) reasons.push(r.error)
      else if (r.value !== null) extIn[d.key] = r.value
    }

    if (reasons.length) {
      preview.failures.push({
        sheet: sheet.name,
        rows: [row.row],
        key: name || direction ? key : `第 ${row.row} 行`,
        reasons,
      })
      failedRows.push({ sheet: sheet.name, row: row.row, values: row.values, reason: reasons.join('；') })
      continue
    }

    const useRefs = () => {
      for (const r of rowRefs) {
        if (known.has(r.token)) continue
        known.add(r.token)
        plan.newRefs.push(r)
        preview.newRefs.push({
          category: r.kind === 'dict' ? DICT_CATEGORY_LABEL[r.category!] : REGION_LEVEL_LABEL[r.level!],
          name: r.name,
          parent: r.kind === 'region' ? regionPath(r.parent) || undefined : undefined,
        })
      }
    }

    if (!existing) {
      useRefs()
      plan.creates.push({
        key,
        values: {
          name,
          direction,
          nameEn: values.nameEn ?? '',
          lng: values.lng!,
          lat: values.lat!,
          cityId: values.cityId ?? null,
          districtId: values.districtId ?? null,
          streetId: values.streetId ?? null,
          roadId: values.roadId ?? null,
          maintainerId: values.maintainerId ?? null,
          platformTypeId: values.platformTypeId ?? null,
          safetyId: values.safetyId ?? null,
          shelterTypeId: values.shelterTypeId ?? null,
          remark: values.remark ?? '',
          qrUrl: values.qrUrl ?? '',
          waiting: values.waiting ?? '',
          berths: values.berths ?? null,
          bigLightbox: values.bigLightbox ?? null,
          smallLightbox: values.smallLightbox ?? null,
          seats: values.seats ?? null,
          ext: extIn,
        },
      })
      preview.created.push({ key, name: key })
      continue
    }

    // 修改：只保留与库里不同的字段
    const changed: Partial<StopValues> = {}
    const diff: DiffEntry[] = []
    const text = (k: keyof StopValues, v: unknown) =>
      v === null || v === undefined || v === ''
        ? ''
        : k === 'lng' || k === 'lat'
          ? Number(v).toFixed(6)
          : k === 'cityId' || k === 'districtId' || k === 'streetId'
            ? isToken(v)
              ? (rowRefs.find((r) => r.token === v)?.name ?? '')
              : (nameOf.get(v as string) ?? '')
            : k.endsWith('Id')
              ? isToken(v)
                ? (rowRefs.find((r) => r.token === v)?.name ?? '')
                : (nameOf.get(v as string) ?? '')
              : String(v)
    const label: Partial<Record<keyof StopValues, string>> = {
      lng: '经度',
      lat: '纬度',
      ...Object.fromEntries(COLS.map((c) => [c.key, c.header])),
    }
    for (const k of Object.keys(values) as (keyof StopValues)[]) {
      if (sameValue(values[k], existing[k])) continue
      ;(changed as Record<string, unknown>)[k] = values[k]
      diff.push({ kind: 'value', label: label[k] ?? k, from: text(k, existing[k]), to: text(k, values[k]) })
    }
    const ext = { ...existing.ext }
    for (const [k, v] of Object.entries(extIn)) {
      if (sameValue(v, existing.ext[k])) continue
      ext[k] = v
      const d = enabledExt.find((x) => x.key === k)!
      diff.push({ kind: 'value', label: d.name, from: formatExtValue(existing.ext[k]), to: formatExtValue(v) })
    }
    if (Object.keys(extIn).some((k) => !sameValue(extIn[k], existing.ext[k]))) changed.ext = ext
    if (!diff.length) {
      preview.unchanged++
      continue
    }
    useRefs()
    plan.updates.push({ id: existing.id, rev: existing.rev, key, values: changed, labels: diff.map((x) => x.label) })
    preview.updated.push({ key, name: key, diff })
  }
  return { preview, plan, failedRows, headers: { [sheet.name]: sheet.headers } }
}

/* ---------------- 写入 ---------------- */

const CHUNK = 2000
const chunks = <T>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK))

export async function applyStops(tx: Tx, plan: StopPlan, stopService: StopService) {
  // 1. 先建字典项与区划（区划按上级在前的顺序），把令牌换成 ID
  const ids = new Map<string, string>()
  const res = (v: string | null | undefined) => (v && isToken(v) ? ids.get(v)! : (v ?? null))
  const order: Record<string, number> = { city: 0, district: 1, street: 2 }
  for (const r of [...plan.newRefs].sort((a, b) =>
    a.kind === b.kind ? (order[a.level ?? ''] ?? 0) - (order[b.level ?? ''] ?? 0) : a.kind === 'region' ? -1 : 1,
  )) {
    const row =
      r.kind === 'dict'
        ? await tx.dictItem.create({ data: { category: r.category!, name: r.name } })
        : await tx.region.create({ data: { level: r.level!, name: r.name, parentId: res(r.parent) } })
    ids.set(r.token, row.id)
  }
  const resolve = <T extends Partial<StopValues>>(v: T): T => {
    const out = { ...v } as Record<string, unknown>
    for (const k of Object.keys(out)) if (k.endsWith('Id')) out[k] = res(out[k] as string | null)
    if (out.ext) out.ext = out.ext as Prisma.InputJsonValue
    return out as T
  }

  // 2. 新增：批量写站点与空站牌集
  const created = plan.creates.map((c) => ({ id: uuidv7(), signSetId: uuidv7(), values: resolve(c.values) }))
  for (const part of chunks(created)) {
    await tx.stop.createMany({
      data: part.map((c) => ({ id: c.id, ...c.values, ext: c.values.ext as Prisma.InputJsonValue })),
    })
    await tx.signSet.createMany({ data: part.map((c) => ({ id: c.signSetId, stopId: c.id })) })
  }

  // 3. 修改：逐个按 ID 更新并递增 rev（导入不检查 rev，但会让之后用旧 rev 保存的表单收到冲突）
  for (const u of plan.updates) {
    const v = resolve(u.values)
    await tx.stop.update({
      where: { id: u.id },
      data: { ...v, ext: v.ext as Prisma.InputJsonValue | undefined, rev: { increment: 1 } },
    })
  }

  // 4. 快照：每个新增或修改的对象各一份"导入新增"或"导入修改"
  const defs = await tx.extField.findMany({ where: { owner: 'stop' } })
  const labels = new Map(plan.updates.map((u) => [u.id, u.labels]))
  const signSetOf = new Map(created.map((c) => [c.id, c.signSetId]))
  const allIds = [...created.map((c) => c.id), ...plan.updates.map((u) => u.id)]
  for (const part of chunks(allIds)) {
    const rows = await tx.stop.findMany({ where: { id: { in: part } }, include: STOP_DETAIL_INCLUDE })
    const data: Prisma.SnapshotCreateManyInput[] = []
    for (const row of rows) {
      const detail = stopService.toDetail(row, [], 0)
      const content = stopSnapshot(detail, defs)
      const name = stopLabel(detail)
      const isNew = signSetOf.has(row.id)
      data.push({
        objectType: 'stop',
        objectId: row.id,
        objectName: name,
        action: isNew ? 'importCreate' : 'importUpdate',
        note: isNew ? '' : `导入修改：${labels.get(row.id)!.join('、')}`,
        content: content as unknown as Prisma.InputJsonValue,
        compareHash: compareHash('stop', content),
      })
      if (isNew) {
        const ss = signSetSnapshot({ id: row.id, name })
        data.push({
          objectType: 'signSet',
          objectId: signSetOf.get(row.id)!,
          objectName: name,
          action: 'importCreate',
          content: ss as unknown as Prisma.InputJsonValue,
          compareHash: compareHash('signSet', ss),
        })
      }
    }
    await tx.snapshot.createMany({ data })
  }
  return { created: created.length, updated: plan.updates.length, newRefs: plan.newRefs.length }
}

/* ---------------- 导出 ---------------- */

const num = (v: number | null) => (v === null || v === undefined ? null : v)

/** 导出行：格式与模板一致，数值与导入解析互逆（AC-11） */
export function stopExportRows(
  rows: Prisma.StopGetPayload<{ include: typeof STOP_DETAIL_INCLUDE }>[],
  ext: ExtDefRow[],
): (string | number | null)[][] {
  const enabled = ext.filter((d) => d.enabled)
  return rows.map((s) => {
    const e = (s.ext ?? {}) as Record<string, unknown>
    return [
      s.name,
      s.direction,
      s.nameEn,
      Math.round(s.lng * 1e6) / 1e6,
      Math.round(s.lat * 1e6) / 1e6,
      s.city?.name ?? null,
      s.district?.name ?? null,
      s.street?.name ?? null,
      s.road?.name ?? null,
      s.maintainer?.name ?? null,
      s.remark,
      s.qrUrl,
      num(s.berths),
      s.platformType?.name ?? null,
      s.safety?.name ?? null,
      s.waiting,
      s.shelterType?.name ?? null,
      num(s.bigLightbox),
      num(s.smallLightbox),
      num(s.seats),
      ...enabled.map((d) => {
        const v = e[d.key]
        if (v === null || v === undefined) return null
        return d.type === 'number' ? Number(v) : formatExtValue(v)
      }),
    ]
  })
}

export const stopSheetSpec = (mode: OrientationMode, ext: ExtDefRow[], rows: SheetSpec['rows']): SheetSpec => ({
  name: STOP_SHEET,
  columns: stopColumns(mode, ext),
  rows,
})
