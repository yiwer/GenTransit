// 站点表单的草稿：与接口的 StopInput 互转；构造快照内容用于"改了哪些字段"与冲突差异
import {
  STOP_DIFF_SPEC,
  changedLabels,
  roundCoord,
  stopInput,
  stopSnapshot,
  type DictItem,
  type ExtFieldDef,
  type Ref,
  type Region,
  type StopDetail,
  type StopInputRaw,
  type StopSnapshotV1,
  type Upload,
} from '@gentransit/shared'

export interface Draft {
  name: string
  direction: string
  nameEn: string
  lng: number | null
  lat: number | null
  cityId: string | null
  districtId: string | null
  streetId: string | null
  roadId: string | null
  qrUrl: string
  berths: number | null
  platformTypeId: string | null
  safetyId: string | null
  waiting: string
  shelterTypeId: string | null
  bigLightbox: number | null
  smallLightbox: number | null
  seats: number | null
  maintainerId: string | null
  remark: string
  landmarks: (Ref & { category: string })[]
  photos: Upload[]
  ext: Record<string, unknown>
}

export const blankDraft = (direction = '东'): Draft => ({
  name: '',
  direction,
  nameEn: '',
  lng: null,
  lat: null,
  cityId: null,
  districtId: null,
  streetId: null,
  roadId: null,
  qrUrl: '',
  berths: null,
  platformTypeId: null,
  safetyId: null,
  waiting: '',
  shelterTypeId: null,
  bigLightbox: null,
  smallLightbox: null,
  seats: null,
  maintainerId: null,
  remark: '',
  landmarks: [],
  photos: [],
  ext: {},
})

export const draftOf = (s: StopDetail): Draft => ({
  name: s.name,
  direction: s.direction,
  nameEn: s.nameEn,
  lng: s.lng,
  lat: s.lat,
  cityId: s.city?.id ?? null,
  districtId: s.district?.id ?? null,
  streetId: s.street?.id ?? null,
  roadId: s.road?.id ?? null,
  qrUrl: s.qrUrl,
  berths: s.facilities.berths,
  platformTypeId: s.facilities.platformType?.id ?? null,
  safetyId: s.facilities.safety?.id ?? null,
  waiting: s.facilities.waiting,
  shelterTypeId: s.facilities.shelterType?.id ?? null,
  bigLightbox: s.facilities.bigLightbox,
  smallLightbox: s.facilities.smallLightbox,
  seats: s.facilities.seats,
  maintainerId: s.maintainer?.id ?? null,
  remark: s.remark,
  landmarks: s.landmarks,
  photos: s.photos,
  ext: { ...s.ext },
})

export const toInput = (d: Draft): StopInputRaw => ({
  name: d.name,
  direction: d.direction,
  nameEn: d.nameEn,
  lng: d.lng === null ? NaN : roundCoord(d.lng),
  lat: d.lat === null ? NaN : roundCoord(d.lat),
  cityId: d.cityId,
  districtId: d.districtId,
  streetId: d.streetId,
  roadId: d.roadId,
  qrUrl: d.qrUrl,
  berths: d.berths,
  platformTypeId: d.platformTypeId,
  safetyId: d.safetyId,
  waiting: d.waiting,
  shelterTypeId: d.shelterTypeId,
  bigLightbox: d.bigLightbox,
  smallLightbox: d.smallLightbox,
  seats: d.seats,
  maintainerId: d.maintainerId,
  remark: d.remark,
  landmarkIds: d.landmarks.map((l) => l.id),
  photoIds: d.photos.map((p) => p.id),
  ext: d.ext,
})

/** 客户端校验：与服务端同一个 zod 模式；按字段返回第一条错误 */
export function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (d.lng === null || d.lat === null) errors.coord = '在地图上点选位置，或填写经纬度'
  const r = stopInput.safeParse(toInput(d))
  if (!r.success)
    for (const i of r.error.issues) {
      const k = i.path[0] === 'lng' || i.path[0] === 'lat' ? 'coord' : String(i.path[0])
      if (!errors[k]) errors[k] = k === 'coord' ? '经纬度不合法' : i.message
    }
  return errors
}

export interface Lookups {
  dicts: DictItem[]
  regions: Region[]
  extDefs: ExtFieldDef[]
}

/** 草稿 → 快照内容（引用名称取自已加载的字典与区划） */
export function snapshotOf(d: Draft, lk: Lookups): StopSnapshotV1 {
  const dict = (id: string | null) => {
    const x = id ? lk.dicts.find((i) => i.id === id) : null
    return x ? { id: x.id, name: x.name } : id ? { id, name: '' } : null
  }
  const region = (id: string | null) => {
    const x = id ? lk.regions.find((i) => i.id === id) : null
    return x ? { id: x.id, name: x.name } : id ? { id, name: '' } : null
  }
  return stopSnapshot(
    {
      name: d.name.trim(),
      direction: d.direction.trim(),
      nameEn: d.nameEn.trim(),
      lng: d.lng === null ? 0 : roundCoord(d.lng),
      lat: d.lat === null ? 0 : roundCoord(d.lat),
      city: region(d.cityId),
      district: region(d.districtId),
      street: region(d.streetId),
      road: dict(d.roadId),
      qrUrl: d.qrUrl.trim(),
      facilities: {
        berths: d.berths,
        platformType: dict(d.platformTypeId),
        safety: dict(d.safetyId),
        waiting: d.waiting.trim(),
        shelterType: dict(d.shelterTypeId),
        bigLightbox: d.bigLightbox,
        smallLightbox: d.smallLightbox,
        seats: d.seats,
      },
      maintainer: dict(d.maintainerId),
      remark: d.remark.trim(),
      landmarks: d.landmarks,
      photos: d.photos,
      ext: d.ext,
    },
    lk.extDefs,
  )
}

export const changedFields = (orig: Draft, d: Draft, lk: Lookups) =>
  changedLabels(snapshotOf(orig, lk), snapshotOf(d, lk), STOP_DIFF_SPEC)
