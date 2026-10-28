import { describe, expect, it } from 'vitest'
import {
  STOP_DIFF_SPEC,
  STOP_NORMALIZE,
  canonicalJson,
  changedLabels,
  compareText,
  diffList,
  diffSnapshots,
  normalize,
  stopSnapshot,
  type StopSnapshotSource,
} from '../src'

const base: StopSnapshotSource = {
  name: '人民广场',
  direction: '东',
  nameEn: 'Renmin Square',
  lng: 120.2,
  lat: 30.25,
  city: { id: 'c1', name: '示例市' },
  district: { id: 'd1', name: '中心区' },
  street: null,
  road: { id: 'r1', name: '解放路' },
  qrUrl: '',
  facilities: {
    berths: 2,
    platformType: null,
    safety: null,
    waiting: '',
    shelterType: null,
    bigLightbox: null,
    smallLightbox: 0,
    seats: 4,
  },
  maintainer: null,
  remark: '',
  landmarks: [
    { id: 'lm-b', name: '中山公园', category: '公园' },
    { id: 'lm-a', name: '市图书馆', category: '文化场馆' },
  ],
  photos: [],
  ext: { area: '解放片区', unused: '' },
}
const defs = [
  { key: 'area', name: '养护片区', type: 'text' as const },
  { key: 'unused', name: '未用', type: 'text' as const },
]

describe('normalize', () => {
  it('引用对象只留 id，改名不改变比较文本', () => {
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot({ ...base, road: { id: 'r1', name: '解放大道' } }, defs)
    expect(compareText(a, STOP_NORMALIZE)).toBe(compareText(b, STOP_NORMALIZE))
  })

  it('扩展字段改名不算修改，取值变化算修改', () => {
    const a = stopSnapshot(base, defs)
    const renamed = stopSnapshot(base, [{ key: 'area', name: '片区', type: 'text' }])
    expect(compareText(a, STOP_NORMALIZE)).toBe(compareText(renamed, STOP_NORMALIZE))
    const changed = stopSnapshot({ ...base, ext: { area: '滨江片区' } }, defs)
    expect(compareText(a, STOP_NORMALIZE)).not.toBe(compareText(changed, STOP_NORMALIZE))
  })

  it('空字符串与 null 视为相同', () => {
    expect(normalize({ a: '', b: null, c: 'x' })).toEqual({ c: 'x' })
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot({ ...base, qrUrl: null as unknown as string }, defs)
    expect(compareText(a, STOP_NORMALIZE)).toBe(compareText(b, STOP_NORMALIZE))
  })

  it('地标是集合：顺序不同视为相同；照片是列表：顺序不同视为修改', () => {
    const a = normalize(
      {
        landmarks: [
          { id: '2', name: 'B' },
          { id: '1', name: 'A' },
        ],
      },
      { sets: ['landmarks'] },
    )
    const b = normalize(
      {
        landmarks: [
          { id: '1', name: 'A' },
          { id: '2', name: 'B' },
        ],
      },
      { sets: ['landmarks'] },
    )
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    const p1 = normalize(
      {
        photos: [
          { id: '1', name: 'a.jpg' },
          { id: '2', name: 'b.jpg' },
        ],
      },
      STOP_NORMALIZE,
    )
    const p2 = normalize(
      {
        photos: [
          { id: '2', name: 'b.jpg' },
          { id: '1', name: 'a.jpg' },
        ],
      },
      STOP_NORMALIZE,
    )
    expect(canonicalJson(p1)).not.toBe(canonicalJson(p2))
  })

  it('键顺序不影响序列化', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { f: 1, e: 2 }] } })).toBe(
      '{"a":{"c":[1,{"e":2,"f":1}],"d":2},"b":1}',
    )
  })

  it('快照内容自包含：引用带名称，地标按 id 排序，扩展字段带字段名与类型', () => {
    const s = stopSnapshot(base, defs)
    expect(s.schema).toBe(1)
    expect(s.road).toEqual({ id: 'r1', name: '解放路' })
    expect(s.landmarks.map((l) => l.id)).toEqual(['lm-a', 'lm-b'])
    expect(s.ext).toEqual({ area: { name: '养护片区', type: 'text', value: '解放片区' } })
  })
})

describe('diff', () => {
  it('字段级差异：引用显示名称，旧值与新值', () => {
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot(
      { ...base, road: { id: 'r2', name: '中山路' }, remark: '地铁口', facilities: { ...base.facilities, seats: 6 } },
      defs,
    )
    const d = diffSnapshots(a, b, STOP_DIFF_SPEC)
    expect(d).toEqual([
      { kind: 'value', label: '路段', from: '解放路', to: '中山路' },
      { kind: 'value', label: '座椅数', from: '4', to: '6' },
      { kind: 'value', label: '备注', from: '', to: '地铁口' },
    ])
  })

  it('改名不产生差异', () => {
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot({ ...base, district: { id: 'd1', name: '中央区' } }, defs)
    expect(diffSnapshots(a, b, STOP_DIFF_SPEC)).toEqual([])
  })

  it('集合差异：增与删', () => {
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot(
      { ...base, landmarks: [{ id: 'lm-c', name: '东方医院', category: '医院' }, base.landmarks[0]] },
      defs,
    )
    expect(diffSnapshots(a, b, STOP_DIFF_SPEC)).toEqual([
      {
        kind: 'items',
        label: '地标',
        items: [
          { op: 'removed', label: '市图书馆' },
          { op: 'added', label: '东方医院' },
        ],
      },
    ])
  })

  it('列表差异：增、删、移动、修改', () => {
    const prev = [
      { id: 'a', name: 'A', w: 1 },
      { id: 'b', name: 'B', w: 1 },
      { id: 'c', name: 'C', w: 1 },
      { id: 'd', name: 'D', w: 1 },
    ]
    const next = [
      { id: 'c', name: 'C', w: 1 },
      { id: 'a', name: 'A', w: 1 },
      { id: 'b', name: 'B', w: 2 },
      { id: 'e', name: 'E', w: 1 },
    ]
    expect(diffList(prev, next)).toEqual([
      { op: 'removed', label: 'D' },
      { op: 'added', label: 'E' },
      { op: 'moved', label: 'C' },
      { op: 'changed', label: 'B' },
    ])
  })

  it('扩展字段差异按字段名显示', () => {
    const a = stopSnapshot(base, defs)
    const b = stopSnapshot({ ...base, ext: { area: '滨江片区' } }, defs)
    expect(changedLabels(a, b, STOP_DIFF_SPEC)).toEqual(['养护片区'])
  })

  it('新增快照没有上一份时差异为空', () => {
    expect(diffSnapshots(null, stopSnapshot(base, defs), STOP_DIFF_SPEC)).toEqual([])
  })
})
