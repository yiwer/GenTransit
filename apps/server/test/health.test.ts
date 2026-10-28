import { createTestApp, type TestApp } from './helpers'

describe('后端骨架（真实 PostgreSQL）', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  afterAll(() => t.close())

  it('健康检查能查询数据库', async () => {
    const res = await t.anon().get('/api/health').expect(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('迁移建好了表，名称列按拼音排序', async () => {
    const rows = await t.prisma.$queryRaw<{ x: string }[]>`
      SELECT x FROM (VALUES ('人民广场'), ('火车站'), ('北门')) t(x) ORDER BY x COLLATE "zh-x-icu"`
    expect(rows.map((r) => r.x)).toEqual(['北门', '火车站', '人民广场'])
    const collation = await t.prisma.$queryRaw<{ collation_name: string }[]>`
      SELECT collation_name FROM information_schema.columns WHERE table_name = 'Stop' AND column_name = 'name'`
    expect(collation[0].collation_name).toBe('zh-x-icu')
  })

  it('未知接口返回统一错误格式', async () => {
    const res = await t.anon().get('/api/nope').expect(404)
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) })
  })
})
