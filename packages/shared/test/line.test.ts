import { describe, expect, it } from 'vitest'
import {
  LINE_DIFF_SPEC,
  LINE_NORMALIZE,
  bd09ToGcj02,
  compareText,
  diffList,
  diffSnapshots,
  expandSchedule,
  fillByInterval,
  lineInput,
  lineSnapshot,
  mapRoutesOnModeChange,
  normalizeTime,
  parseTimes,
  passIndices,
  timesInOrder,
  toGcj02,
  wgs84ToGcj02,
  type LineSnapshotSource,
} from '../src'

describe('坐标转换', () => {
  // 对照点：开源 coordtransform 库 README 的示例结果
  it('WGS-84 → GCJ-02', () => {
    const [lng, lat] = wgs84ToGcj02(116.404, 39.915)
    expect(lng).toBeCloseTo(116.41024449916938, 9)
    expect(lat).toBeCloseTo(39.91640428150164, 9)
  })
  it('BD-09 → GCJ-02', () => {
    const [lng, lat] = bd09ToGcj02(116.404, 39.915)
    expect(lng).toBeCloseTo(116.39762729119315, 9)
    expect(lat).toBeCloseTo(39.90865673957631, 9)
  })
  it('境外坐标不偏移；GCJ-02 原样；结果保留 6 位小数', () => {
    expect(wgs84ToGcj02(-0.1276, 51.5072)).toEqual([-0.1276, 51.5072])
    expect(toGcj02(120.2, 30.25, 'gcj02')).toEqual([120.2, 30.25])
    const [lng] = toGcj02(116.404, 39.915, 'wgs84')
    expect(lng).toBe(116.410244)
  })
})

describe('模式与走向', () => {
  it('改模式按位置对应：第 1 个走向改名，多余的删除，缺少的新建', () => {
    expect(mapRoutesOnModeChange(['down', 'up'], 'twoway', 'oneway')).toEqual([
      { from: 'up', to: 'oneway' },
      { from: 'down', to: null },
    ])
    expect(mapRoutesOnModeChange(['loop'], 'loop', 'doubleLoop')).toEqual([
      { from: 'loop', to: 'inner' },
      { from: null, to: 'outer' },
    ])
    expect(mapRoutesOnModeChange(['up', 'down'], 'twoway', 'twoway')).toEqual([
      { from: 'up', to: 'up' },
      { from: 'down', to: 'down' },
    ])
  })

  it('第几次途经', () => {
    expect(passIndices(['a', 'b', 'c', 'a', 'b', 'a'])).toEqual([1, 1, 1, 2, 2, 3])
  })

  it('线路输入：走向必须与模式一致，每个走向至少 2 个站', () => {
    const stop = (id: string) => ({ stopId: id, times: [] })
    const a = '0190a4b4-0000-7000-8000-000000000001'
    const b = '0190a4b4-0000-7000-8000-000000000002'
    const ok = lineInput.safeParse({
      name: '1路',
      number: 'G-1',
      mode: 'twoway',
      routes: [
        { kind: 'up', stops: [stop(a), stop(b)] },
        { kind: 'down', stops: [stop(b), stop(a)] },
      ],
    })
    expect(ok.success).toBe(true)
    const wrong = lineInput.safeParse({
      name: '1路',
      number: 'G-1',
      mode: 'twoway',
      routes: [{ kind: 'up', stops: [stop(a), stop(b)] }],
    })
    expect(wrong.success).toBe(false)
    expect(wrong.error!.issues[0].message).toBe('双边线路的走向应为：上行、下行')
    const short = lineInput.safeParse({
      name: '1路',
      number: 'G-1',
      mode: 'oneway',
      routes: [{ kind: 'oneway', stops: [stop(a)] }],
    })
    expect(short.error!.issues[0].message).toBe('每个走向至少要有 2 个站')
  })
})

describe('到站时刻', () => {
  it('规整与解析：多种分隔符', () => {
    expect(normalizeTime('7:5')).toBe('07:05')
    expect(normalizeTime('0705')).toBe('07:05')
    expect(normalizeTime('24:00')).toBeNull()
    expect(parseTimes('06:30, 07:00，07:30、08:00 08:30')).toEqual({
      ok: true,
      times: ['06:30', '07:00', '07:30', '08:00', '08:30'],
    })
    expect(parseTimes('07:00,6:30,08:00,07:50')).toEqual({ ok: false, error: '时刻没有按先后排列' })
    expect(parseTimes('7点')).toMatchObject({ ok: false })
  })

  it('按先后排列：允许跨过一次午夜，不允许重复', () => {
    expect(timesInOrder(['22:30', '23:30', '00:30', '01:30'])).toBe(true)
    expect(timesInOrder(['23:30', '00:30', '23:00', '00:10'])).toBe(false)
    expect(timesInOrder(['07:00', '07:00'])).toBe(false)
  })

  it('按间隔填充与展开班次', () => {
    expect(expandSchedule('06:00', '07:00', 20)).toEqual(['06:00', '06:20', '06:40', '07:00'])
    expect(fillByInterval(['06:00', '06:30'], [3, 4], 3)).toEqual([
      ['06:00', '06:30'],
      ['06:03', '06:33'],
      ['06:07', '06:37'],
    ])
    // 统一用时
    expect(fillByInterval(['23:58'], [5], 3)).toEqual([['23:58'], ['00:03'], ['00:08']])
  })
})

const src = (over: Partial<LineSnapshotSource> = {}): LineSnapshotSource => ({
  name: 'K1路',
  number: 'K-1',
  nameEn: '',
  mode: 'twoway',
  status: 'running',
  ticketType: 'unattended',
  fare: '2 元',
  company: { id: 'c1', name: '示例公交一公司' },
  fareSystem: null,
  ext: {},
  routes: [
    {
      kind: 'up',
      serviceType: 'interval',
      serviceTime: '06:00–22:00',
      interval: '10 分钟',
      stops: [
        { stop: { id: 's1', name: '人民广场', direction: '东' }, times: ['06:00'], ext: {} },
        { stop: { id: 's2', name: '火车站', direction: '场站' }, times: ['06:10'], ext: {} },
        { stop: { id: 's1', name: '人民广场', direction: '东' }, times: ['06:20'], ext: {} },
      ],
    },
  ],
  ...over,
})

describe('线路快照', () => {
  it('路径站 ID = 站点 ID + 第几次途经；名称写"站名（方位）"', () => {
    const s = lineSnapshot(src(), [], [])
    expect(s.routes.up!.stops.map((x) => x.id)).toEqual(['s1#1', 's2#1', 's1#2'])
    expect(s.routes.up!.stops[1].stop).toEqual({ id: 's2', name: '火车站（场站）' })
  })

  it('站点改名、公司改名都不改变比较文本', () => {
    const a = lineSnapshot(src(), [], [])
    const renamed = src()
    renamed.routes[0].stops[1].stop.name = '火车东站'
    renamed.company = { id: 'c1', name: '示例公交集团' }
    expect(compareText(a, LINE_NORMALIZE)).toBe(compareText(lineSnapshot(renamed, [], []), LINE_NORMALIZE))
  })

  it('站序差异按站名显示增、删、移动、修改', () => {
    const a = lineSnapshot(src(), [], [])
    const changed = src()
    const st = changed.routes[0].stops
    changed.routes[0].stops = [st[1], st[0], { stop: { id: 's3', name: '北门', direction: '南' }, times: [], ext: {} }]
    changed.routes[0].stops[0] = { ...st[1], times: ['06:12'] }
    const d = diffSnapshots(a, lineSnapshot(changed, [], []), LINE_DIFF_SPEC)
    expect(d).toEqual([
      {
        kind: 'items',
        label: '上行 · 站序',
        items: [
          { op: 'removed', label: '人民广场（东）' },
          { op: 'added', label: '北门（南）' },
          { op: 'moved', label: '火车站（场站）' },
        ],
      },
    ])
  })

  it('模式与状态显示中文', () => {
    const a = lineSnapshot(src(), [], [])
    const b = lineSnapshot(src({ status: 'suspended' }), [], [])
    expect(diffSnapshots(a, b, LINE_DIFF_SPEC)).toEqual([{ kind: 'value', label: '状态', from: '运营', to: '停运' }])
  })

  it('diffList 支持标签路径', () => {
    const p = [{ id: 'a', stop: { id: 'x', name: '甲' } }]
    const n = [{ id: 'b', stop: { id: 'y', name: '乙' } }]
    expect(diffList(p, n, 'stop.name')).toEqual([
      { op: 'removed', label: '甲' },
      { op: 'added', label: '乙' },
    ])
  })
})
