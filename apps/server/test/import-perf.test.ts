import type { ImportJobView } from '@gentransit/shared'
import type { Agent } from 'supertest'
import { workbookBuffer } from '../src/import/excel'
import { createTestApp, type TestApp } from './helpers'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 需求 7.1：1 万行文件 1 分钟内完成预览（库里已有 2 万站点） */
describe('站点导入性能', () => {
  let t: TestApp
  let api: Agent
  beforeAll(async () => {
    t = await createTestApp()
    await t.reset()
    api = await t.login()
    await t.prisma.$executeRaw`
      INSERT INTO "Stop" (id, name, direction, lng, lat, "updatedAt")
      SELECT gen_random_uuid(), '站' || i, '东', 120.1 + (i % 200) * 0.001, 30.2 + (i / 200) * 0.001, now()
      FROM generate_series(1, 20000) AS i`
  }, 120_000)
  afterAll(() => t.close())

  it('1 万行（一半修改已有站点、一半新增）60 秒内出预览，确认写入原子完成', async () => {
    const header = ['站名*', '方位*', '英文名', '经度', '纬度', '市', '区', '街道', '路段', '维护公司', '备注']
    const rows = Array.from({ length: 10000 }, (_, i) =>
      i % 2 === 0
        ? [`站${i + 1}`, '东', null, null, null, null, null, null, `路${i % 50}`, null, `备注 ${i}`]
        : [`新站${i}`, '西', `Stop ${i}`, 120.2 + i * 1e-5, 30.25, null, null, null, `路${i % 50}`, null, null],
    )
    const buf = await workbookBuffer([{ name: '站点', columns: header.map((h) => ({ header: h })), rows }])

    const start = performance.now()
    const res = await api.post('/api/import/stop').attach('file', buf, { filename: 'big.xlsx', contentType: XLSX })
    const previewMs = performance.now() - start
    expect(res.status).toBe(201)
    const job = res.body as ImportJobView
    expect(job.preview.created).toHaveLength(5000)
    expect(job.preview.updated).toHaveLength(5000)
    expect(job.preview.newRefs).toHaveLength(50)
    expect(previewMs).toBeLessThan(60_000)

    const c0 = performance.now()
    const r = await api.post(`/api/import/${job.id}/confirm`).expect(200)
    const confirmMs = performance.now() - c0
    expect(r.body).toMatchObject({ created: 5000, updated: 5000, newRefs: 50 })
    expect(await t.prisma.stop.count()).toBe(25000)
    expect(await t.prisma.snapshot.count({ where: { action: { in: ['importCreate', 'importUpdate'] } } })).toBe(15000)
    console.log(`预览 ${Math.round(previewMs)} ms，确认写入 ${Math.round(confirmMs)} ms`)
  }, 600_000)
})
