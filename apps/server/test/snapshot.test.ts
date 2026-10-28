import { randomUUID } from 'node:crypto'
import { STOP_DIFF_SPEC, changedLabels, stopSnapshot, type StopSnapshotSource } from '@gentransit/shared'
import { SnapshotService, compareHash } from '../src/snapshots/snapshot.service'
import { createTestApp, type TestApp } from './helpers'

const source: StopSnapshotSource = {
  name: '人民广场',
  direction: '东',
  nameEn: '',
  lng: 120.2,
  lat: 30.25,
  city: null,
  district: null,
  street: null,
  road: { id: 'r1', name: '解放路' },
  qrUrl: '',
  facilities: {
    berths: null,
    platformType: null,
    safety: null,
    waiting: '',
    shelterType: null,
    bigLightbox: null,
    smallLightbox: null,
    seats: 2,
  },
  maintainer: null,
  remark: '',
  landmarks: [],
  photos: [],
  ext: {},
}
const content = (s: Partial<StopSnapshotSource> = {}) => stopSnapshot({ ...source, ...s }, [])

describe('比较哈希（单元）', () => {
  it('键顺序、引用名称、空串与 null 不影响哈希', () => {
    const a = content()
    const b = { ...content({ road: { id: 'r1', name: '解放大道' }, remark: null as unknown as string }) }
    const reordered = Object.fromEntries(Object.entries(b).reverse())
    expect(compareHash('stop', a)).toBe(compareHash('stop', reordered))
    expect(compareHash('stop', a)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('内容变化改变哈希', () => {
    expect(compareHash('stop', content())).not.toBe(compareHash('stop', content({ remark: '地铁口' })))
  })
})

describe('快照机制（T4，真实 PostgreSQL）', () => {
  let t: TestApp
  let svc: SnapshotService
  beforeAll(async () => {
    t = await createTestApp()
    svc = t.app.get(SnapshotService)
  })
  beforeEach(() => t.reset())
  afterAll(() => t.close())

  const record = (id: string, action: 'create' | 'update' | 'delete', c: unknown, noteFrom?: (p: unknown) => string) =>
    t.prisma.$transaction((tx) =>
      svc.record(tx, { type: 'stop', id, name: '人民广场（东）', action, content: c, noteFrom }),
    )

  it('同内容保存不产生快照；只改引用名称也不产生', async () => {
    const id = randomUUID()
    expect(await record(id, 'create', content())).toEqual({ written: true })
    expect(await record(id, 'update', content())).toEqual({ written: false })
    expect(await record(id, 'update', content({ road: { id: 'r1', name: '解放大道' } }))).toEqual({ written: false })
    expect(await svc.count('stop', id)).toBe(1)
  })

  it('内容变化产生快照，说明列出改动字段', async () => {
    const id = randomUUID()
    await record(id, 'create', content())
    const next = content({ remark: '地铁口', facilities: { ...source.facilities, seats: 4 } })
    const r = await record(
      id,
      'update',
      next,
      (prev) => `修改：${changedLabels(prev, next, STOP_DIFF_SPEC).join('、')}`,
    )
    expect(r.written).toBe(true)
    const items = await svc.timeline('stop', id)
    expect(items.map((i) => i.action)).toEqual(['update', 'create'])
    expect(items[0].note).toBe('修改：座椅数、备注')
    expect(items[0].content).toEqual(next)
  })

  it('删除总是记录，并出现在"已删除"视图里', async () => {
    const id = randomUUID()
    await record(id, 'create', content())
    await record(id, 'delete', content())
    const other = randomUUID()
    await record(other, 'create', content({ name: '火车站' }))
    const page = await svc.deleted('stop', 1, 20)
    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({ objectId: id, objectName: '人民广场（东）', snapshotCount: 2 })
  })

  it('时间线与已删除接口需要登录，按类型和 ID 查询', async () => {
    const id = randomUUID()
    await record(id, 'create', content())
    await t.anon().get(`/api/snapshots?type=stop&id=${id}`).expect(401)
    const agent = await t.login()
    const res = await agent.get(`/api/snapshots?type=stop&id=${id}`).expect(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({ action: 'create', objectType: 'stop' })
    await agent.get('/api/snapshots?type=bogus&id=1').expect(400)
    const del = await agent.get('/api/snapshots/deleted?type=stop').expect(200)
    expect(del.body).toMatchObject({ total: 0, page: 1, size: 20 })
  })
})
