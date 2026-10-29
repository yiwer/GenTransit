import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  API_TOKEN_RE,
  apiTokenInput,
  lineSnapshot,
  passagesByStop,
  touchedStops,
  v1DeletedQuery,
  v1Line,
  v1ListQuery,
  v1PageOf,
  v1SignSet,
  v1Stop,
  type LineSnapshotSource,
} from '../src'

const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stop = (n: number) => ({ id: S(n), name: `站${n}`, direction: '东' })

function line(
  routes: Partial<Record<'up' | 'down' | 'loop' | 'inner', number[]>>,
  over: Partial<LineSnapshotSource> = {},
) {
  const src: LineSnapshotSource = {
    name: '1路',
    number: 'L1',
    nameEn: '',
    mode: 'twoway',
    status: 'running',
    ticketType: null,
    fare: '2元',
    company: null,
    fareSystem: null,
    ext: {},
    routes: Object.entries(routes).map(([kind, ids]) => ({
      kind: kind as 'up',
      serviceType: null,
      serviceTime: '',
      interval: '',
      stops: ids!.map((n) => ({ stop: stop(n), times: [], ext: {} })),
    })),
    ...over,
  }
  return lineSnapshot(src, [], [])
}

describe('编排投影 passagesByStop', () => {
  it('每个站点的途经集合按（走向种类#第几次途经）', () => {
    const m = passagesByStop(line({ up: [1, 2, 3], down: [3, 2, 1] }))
    expect([...m.get(S(2))!].sort()).toEqual(['down#1', 'up#1'])
  })
  it('环线第二次途经序号', () => {
    const m = passagesByStop(line({ loop: [1, 2, 3, 1] }, { mode: 'loop' }))
    expect([...m.get(S(1))!].sort()).toEqual(['loop#1', 'loop#2'])
  })
  it('不是线路快照时为空', () => {
    expect(passagesByStop(null).size).toBe(0)
    expect(passagesByStop({ foo: 1 }).size).toBe(0)
  })
})

describe('途经变了的站点 touchedStops', () => {
  const base = line({ up: [1, 2, 3], down: [3, 2, 1] })
  it('新建、删除：所有站点', () => {
    expect(touchedStops(null, base)).toEqual([S(1), S(2), S(3)])
    expect(touchedStops(base, null)).toEqual([S(1), S(2), S(3)])
  })
  it('停运与恢复：前后出现过的所有站点', () => {
    const off = line({ up: [1, 2, 3], down: [3, 2, 1] }, { status: 'suspended' })
    expect(touchedStops(base, off)).toEqual([S(1), S(2), S(3)])
    expect(touchedStops(off, base)).toEqual([S(1), S(2), S(3)])
  })
  it('加站只算新站；删站只算被删的站', () => {
    expect(touchedStops(base, line({ up: [1, 2, 4, 3], down: [3, 2, 1] }))).toEqual([S(4)])
    expect(touchedStops(base, line({ up: [1, 3], down: [3, 2, 1] }))).toEqual([S(2)])
  })
  it('环线第二次途经：加入已有站点也算', () => {
    const a = line({ loop: [1, 2, 3] }, { mode: 'loop' })
    const b = line({ loop: [1, 2, 3, 1] }, { mode: 'loop' })
    expect(touchedStops(a, b)).toEqual([S(1)])
  })
  it('改走向种类：受影响的站点都算', () => {
    const a = line({ up: [1, 2] })
    const b = line({ inner: [1, 2] }, { mode: 'doubleLoop' })
    expect(touchedStops(a, b)).toEqual([S(1), S(2)])
  })
  it('只改到站时刻、票价、线路名：不算', () => {
    const b = lineSnapshot(
      {
        name: '1路（新）',
        number: 'L1',
        nameEn: 'No.1',
        mode: 'twoway',
        status: 'running',
        ticketType: 'attended',
        fare: '3元',
        company: null,
        fareSystem: null,
        ext: {},
        routes: [
          {
            kind: 'up',
            serviceType: 'scheduled',
            serviceTime: '06:00-22:00',
            interval: '',
            stops: [1, 2, 3].map((n) => ({ stop: { ...stop(n), name: `改名${n}` }, times: ['07:00'], ext: {} })),
          },
          {
            kind: 'down',
            serviceType: null,
            serviceTime: '',
            interval: '',
            stops: [3, 2, 1].map((n) => ({ stop: stop(n), times: [], ext: {} })),
          },
        ],
      },
      [],
      [],
    )
    expect(touchedStops(base, b)).toEqual([])
  })
})

describe('只读 API 模式', () => {
  it('列表参数：默认 100、上限、时间带时区', () => {
    expect(v1ListQuery().parse({}).limit).toBe(100)
    expect(v1ListQuery().safeParse({ limit: '501' }).success).toBe(false)
    expect(v1ListQuery(100).safeParse({ limit: '101' }).success).toBe(false)
    expect(v1ListQuery().safeParse({ updatedSince: '2026-10-28T08:00:00.000Z' }).success).toBe(true)
    expect(v1ListQuery().safeParse({ updatedSince: '2026-10-28T16:00:00+08:00' }).success).toBe(true)
    expect(v1ListQuery().safeParse({ updatedSince: 'yesterday' }).success).toBe(false)
    expect(v1DeletedQuery.safeParse({ type: 'busCompany' }).success).toBe(true)
    expect(v1DeletedQuery.safeParse({ type: 'account' }).success).toBe(false)
  })

  it('站点、线路、站牌集的示例数据能严格解析；多余字段不通过', () => {
    const t = '2026-10-28T08:00:00.000Z'
    const ref = { id: S(9), name: '某' }
    const st = {
      id: S(1),
      name: '火车站',
      direction: '东',
      nameEn: '',
      lng: 120.1,
      lat: 30.2,
      city: ref,
      district: null,
      street: null,
      road: null,
      qrUrl: '',
      facilities: {
        berths: 2,
        platformType: null,
        safety: null,
        waiting: '',
        shelterType: null,
        bigLightbox: null,
        smallLightbox: null,
        seats: 4,
      },
      maintainer: null,
      remark: '',
      landmarks: [ref],
      photos: [{ id: S(5), url: `/api/v1/files/${S(5)}` }],
      ext: { color: '红', n: 3, tags: ['a'] },
      createdAt: t,
      changedAt: t,
    }
    expect(v1Stop.parse(st)).toEqual(st)
    expect(v1Stop.safeParse({ ...st, rev: 1 }).success).toBe(false)

    const ln = {
      id: S(2),
      name: '1路',
      number: 'L1',
      nameEn: '',
      mode: 'twoway',
      status: 'running',
      ticketType: null,
      fareSystem: null,
      fare: '',
      company: null,
      ext: {},
      routes: [
        {
          id: S(3),
          kind: 'up',
          serviceType: 'interval',
          serviceTime: '',
          interval: '10',
          stops: [{ seq: 1, stop: { id: S(1), name: '火车站', direction: '东' }, pass: 1, times: ['07:00'], ext: {} }],
        },
      ],
      createdAt: t,
      changedAt: t,
    }
    expect(v1Line.parse(ln)).toEqual(ln)

    const ss = {
      id: S(4),
      stop: { id: S(1), name: '火车站', direction: '东' },
      reminder: '',
      shelves: [
        {
          id: S(6),
          no: 1,
          type: ref,
          name: '',
          desc: '',
          noPhysical: false,
          material: '',
          sort: 0,
          boards: [
            {
              id: S(7),
              no: 1,
              face: 'front',
              kind: 'sliced',
              width: 1200,
              height: 1800,
              remark: '',
              slots: [{ id: S(8), no: 1, kind: 'route', note: '', width: 1200, height: 300 }],
            },
          ],
        },
      ],
      passages: [
        {
          line: ref,
          route: { id: S(3), kind: 'up' },
          pass: 1,
          status: 'placed',
          places: [{ boardId: S(7), slotId: S(8), order: null }],
        },
      ],
      counts: { waiting: 0, placed: 1, hidden: 0, invalid: 0 },
      changedAt: t,
    }
    expect(v1PageOf(v1SignSet).parse({ items: [ss], nextCursor: null, nextUpdatedSince: t }).items).toHaveLength(1)
  })

  it('能生成 JSON Schema', () => {
    const js = z.toJSONSchema(v1SignSet) as { properties: Record<string, unknown> }
    expect(Object.keys(js.properties)).toContain('passages')
  })

  it('Token 格式与名称', () => {
    expect(API_TOKEN_RE.test(`gt_${'A'.repeat(43)}`)).toBe(true)
    expect(API_TOKEN_RE.test(`gt_${'A'.repeat(42)}`)).toBe(false)
    expect(apiTokenInput.safeParse({ name: ' ' }).success).toBe(false)
    expect(apiTokenInput.safeParse({ name: 'x'.repeat(51) }).success).toBe(false)
  })
})
