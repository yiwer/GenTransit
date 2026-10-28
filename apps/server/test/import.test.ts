import type { ImportJobView, ImportResult, LineDetail, StopDetail } from '@gentransit/shared'
import type { Agent, Response } from 'supertest'
import { readWorkbook, workbookBuffer, type SheetSpec } from '../src/import/excel'
import { createTestApp, type TestApp } from './helpers'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** 以 Buffer 下载二进制响应 */
const binary = (res: Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = []
  res.on('data', (c: Buffer) => chunks.push(c))
  res.on('end', () => cb(null, Buffer.concat(chunks)))
}

const sheet = (name: string, header: string[], rows: (string | number | null)[][]): SheetSpec => ({
  name,
  columns: header.map((h) => ({ header: h })),
  rows,
})

const STOP_HEADER = [
  '站名*',
  '方位*',
  '英文名',
  '经度',
  '纬度',
  '市',
  '区',
  '街道',
  '路段',
  '维护公司',
  '备注',
  '二维码 URL',
  '泊位数',
  '站台类型',
  '安全设施',
  '候车设施',
  '候车亭类型',
  '大灯箱数',
  '小灯箱数',
  '座椅数',
]

describe('导入导出（T5～T7）', () => {
  let t: TestApp
  let api: Agent
  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(async () => {
    await t.reset()
    api = await t.login()
  })
  afterAll(() => t.close())

  const upload = async (kind: 'stop' | 'line', buf: Buffer, coord?: string) => {
    let req = api.post(`/api/import/${kind}`).attach('file', buf, { filename: `${kind}.xlsx`, contentType: XLSX })
    if (coord) req = req.field('coordSystem', coord)
    const res = await req
    expect(res.status).toBe(201)
    return res.body as ImportJobView
  }
  const download = async (url: string) => {
    const res = await api.get(url).buffer(true).parse(binary).expect(200)
    expect(res.headers['content-type']).toBe(XLSX)
    return res.body as Buffer
  }
  const confirm = async (id: string) => (await api.post(`/api/import/${id}/confirm`).expect(200)).body as ImportResult

  it('模板：按启用的扩展字段生成列，附说明 sheet', async () => {
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'area', name: '养护片区', type: 'text' }).expect(201)
    const stops = await readWorkbook(await download('/api/import/stop/template'))
    expect(stops.map((s) => s.name)).toEqual(['站点', '说明'])
    expect(stops[0].headers).toEqual([...STOP_HEADER, '养护片区'])
    const lines = await readWorkbook(await download('/api/import/line/template'))
    expect(lines.map((s) => s.name)).toEqual(['线路', '走向', '路径站', '说明'])
    expect(lines[2].headers).toEqual(['管理编号*', '走向*', '序号*', '站名*', '方位*', '到站时刻'])
  })

  it('AC-13：站点导入出现库中没有的路段，预览"将新建的字典项"列出，确认后新建；新增站点带空站牌集与"导入新增"快照', async () => {
    const buf = await workbookBuffer([
      sheet('站点', STOP_HEADER, [
        [
          '人民广场',
          '东',
          'Renmin Square',
          120.2,
          30.25,
          '示例市',
          '中心区',
          null,
          '解放路',
          null,
          null,
          null,
          2,
          null,
          null,
          null,
          null,
          null,
          null,
          4,
        ],
        [
          '火车站',
          '场站',
          null,
          120.21,
          30.26,
          '示例市',
          '中心区',
          null,
          '解放路',
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ]),
    ])
    const job = await upload('stop', buf)
    expect(job.preview).toMatchObject({ rows: 2, unchanged: 0, failures: [] })
    expect(job.preview.created.map((c) => c.key)).toEqual(['人民广场（东）', '火车站（场站）'])
    expect(job.preview.newRefs).toEqual([
      { category: '市', name: '示例市' },
      { category: '区', name: '中心区', parent: '示例市' },
      { category: '路段', name: '解放路' },
    ])
    // 预览不写业务数据
    expect(await t.prisma.dictItem.count()).toBe(0)
    const r = await confirm(job.id)
    expect(r).toMatchObject({ created: 2, updated: 0, newRefs: 3 })
    const road = await t.prisma.dictItem.findFirstOrThrow({ where: { category: 'road', name: '解放路' } })
    const stop = await t.prisma.stop.findFirstOrThrow({ where: { name: '人民广场' }, include: { signSet: true } })
    expect(stop).toMatchObject({ roadId: road.id, berths: 2, seats: 4, rev: 1 })
    expect(stop.signSet).not.toBeNull()
    const snaps = await t.prisma.snapshot.findMany({ where: { objectId: { in: [stop.id, stop.signSet!.id] } } })
    expect(snaps.map((s) => [s.objectType, s.action]).sort()).toEqual([
      ['signSet', 'importCreate'],
      ['stop', 'importCreate'],
    ])
    // 再次确认同一任务被拒
    await api.post(`/api/import/${job.id}/confirm`).expect(409)
  })

  it('AC-11：导出站点后原样导入，预览新增 0、修改 0，全部计入无变化', async () => {
    await api
      .post('/api/ext-fields')
      .send({ owner: 'stop', key: 'area', name: '养护片区', type: 'select', options: ['解放片区'] })
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'opened', name: '启用日期', type: 'date' })
    await api.post('/api/ext-fields').send({ owner: 'stop', key: 'tags', name: '标签', type: 'textList' })
    const city = (await api.post('/api/regions').send({ level: 'city', name: '示例市' })).body
    const district = (await api.post('/api/regions').send({ level: 'district', parentId: city.id, name: '中心区' }))
      .body
    const road = (await api.post('/api/dicts').send({ category: 'road', name: '解放路' })).body
    const pt = (await api.post('/api/dicts').send({ category: 'platformType', name: '港湾式' })).body
    await api
      .post('/api/stops')
      .send({
        name: '人民广场',
        direction: '东',
        nameEn: "People's Square",
        lng: 120.186412,
        lat: 30.254062,
        cityId: city.id,
        districtId: district.id,
        roadId: road.id,
        platformTypeId: pt.id,
        berths: 3,
        seats: 0,
        remark: '地铁 2 号线 B 口',
        ext: { area: '解放片区', opened: '2026-10-01', tags: ['夜间', '无障碍'] },
      })
      .expect(201)
    await api.post('/api/stops').send({ name: '火车站', direction: '场站', lng: 120.3, lat: 30.3 }).expect(201)
    const exported = await download('/api/export/stops')
    const job = await upload('stop', exported)
    expect(job.preview).toMatchObject({ rows: 2, created: [], updated: [], unchanged: 2, failures: [], newRefs: [] })
  })

  it('修改已有站点：空单元格不改；预览列出改动字段；确认后存"导入修改"快照并递增 rev；坐标系转换', async () => {
    const s = (
      await api
        .post('/api/stops')
        .send({ name: '人民广场', direction: '东', lng: 120.2, lat: 30.25, remark: '原备注', seats: 2 })
    ).body.item as StopDetail
    const buf = await workbookBuffer([
      sheet('站点', STOP_HEADER, [
        [
          '人民广场',
          '东',
          null,
          116.404,
          39.915,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          6,
        ],
      ]),
    ])
    const job = await upload('stop', buf, 'wgs84')
    expect(job.preview.updated).toEqual([
      {
        key: '人民广场（东）',
        name: '人民广场（东）',
        diff: [
          { kind: 'value', label: '经度', from: '120.200000', to: '116.410244' },
          { kind: 'value', label: '纬度', from: '30.250000', to: '39.916404' },
          { kind: 'value', label: '座椅数', from: '2', to: '6' },
        ],
      },
    ])
    await confirm(job.id)
    const after = await t.prisma.stop.findUniqueOrThrow({ where: { id: s.id } })
    expect(after).toMatchObject({ remark: '原备注', seats: 6, lng: 116.410244, rev: 2 })
    const last = await t.prisma.snapshot.findFirstOrThrow({ where: { objectId: s.id }, orderBy: { createdAt: 'desc' } })
    expect(last).toMatchObject({ action: 'importUpdate', note: '导入修改：经度、纬度、座椅数' })
  })

  it('失败行：方位不合法、新增缺坐标、文件内重复；可下载失败行（附"失败原因"）', async () => {
    const buf = await workbookBuffer([
      sheet('站点', STOP_HEADER, [
        ['甲站', '东北', null, 120.2, 30.25],
        ['乙站', '东'],
        ['丙站', '西', null, 120.2, 30.25],
        ['丙站', '西', null, 120.2, 30.25],
      ]),
    ])
    const job = await upload('stop', buf)
    expect(job.preview.created.map((c) => c.key)).toEqual(['丙站（西）'])
    expect(job.preview.failures).toEqual([
      { sheet: '站点', rows: [2], key: '甲站（东北）', reasons: ['方位「东北」不是东、南、西、北、无、场站之一'] },
      { sheet: '站点', rows: [3], key: '乙站（东）', reasons: ['新增站点必须填写经纬度'] },
      { sheet: '站点', rows: [5], key: '丙站（西）', reasons: ['与第 4 行重复'] },
    ])
    const f = await readWorkbook(await download(`/api/import/${job.id}/failures`))
    expect(f[0].headers.at(-1)).toBe('失败原因')
    expect(f[0].rows.map((r) => [r.get('站名'), r.get('失败原因')])).toEqual([
      ['甲站', '方位「东北」不是东、南、西、北、无、场站之一'],
      ['乙站', '新增站点必须填写经纬度'],
      ['丙站', '与第 4 行重复'],
    ])
  })

  it('确认时数据已变化（有人改了站点）被拒；取消后不能再确认', async () => {
    const s = (await api.post('/api/stops').send({ name: '人民广场', direction: '东', lng: 120.2, lat: 30.25 })).body
      .item as StopDetail
    const buf = await workbookBuffer([
      sheet('站点', STOP_HEADER, [['人民广场', '东', null, null, null, null, null, null, null, null, '新备注']]),
    ])
    const job = await upload('stop', buf)
    expect(job.preview.updated).toHaveLength(1)
    await api
      .put(`/api/stops/${s.id}`)
      .send({ name: '人民广场', direction: '东', lng: 120.2, lat: 30.25, remark: '别处的修改', rev: 1 })
      .expect(200)
    const r = await api.post(`/api/import/${job.id}/confirm`).expect(409)
    expect(r.body).toMatchObject({ code: 'IMPORT_STALE', message: '数据已变化，请重新预览' })
    expect((await t.prisma.stop.findUniqueOrThrow({ where: { id: s.id } })).remark).toBe('别处的修改')
    await api.post(`/api/import/${job.id}/cancel`).expect(204)
    await api.post(`/api/import/${job.id}/confirm`).expect(409)
  })

  it('原文件只留到确认、取消或过期；过期任务在下次上传时清理，7 天前的任务删除', async () => {
    const buf = await workbookBuffer([sheet('站点', STOP_HEADER, [['甲站', '东', null, 120.2, 30.25]])])
    const fileSize = async (id: string) =>
      (await t.prisma.importJob.findUnique({ where: { id }, select: { file: true } }))?.file.length
    const done = await upload('stop', buf)
    expect(await fileSize(done.id)).toBeGreaterThan(0)
    await confirm(done.id)
    expect(await fileSize(done.id)).toBe(0)
    // 失败行在清掉原文件后仍可下载
    await download(`/api/import/${done.id}/failures`)

    const stale = await upload('stop', buf)
    const old = await upload('stop', buf)
    await t.prisma.importJob.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await t.prisma.importJob.update({
      where: { id: old.id },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) },
    })
    await upload('stop', buf)
    expect(await t.prisma.importJob.findUnique({ where: { id: stale.id }, select: { status: true } })).toEqual({
      status: 'expired',
    })
    expect(await fileSize(stale.id)).toBe(0)
    expect(await fileSize(old.id)).toBeUndefined()
  })

  it('不是 xlsx 被拒', async () => {
    const r = await api
      .post('/api/import/stop')
      .attach('file', Buffer.from('a,b'), { filename: 'a.csv', contentType: 'text/csv' })
      .expect(400)
    expect(r.body.message).toBe('请上传 Excel（.xlsx）文件')
  })

  it('超过 20 MB 被拒并写明上限', async () => {
    const r = await api
      .post('/api/import/stop')
      .attach('file', Buffer.alloc(20 * 1024 * 1024 + 1), { filename: 'big.xlsx', contentType: XLSX })
      .expect(413)
    expect(r.body).toMatchObject({ code: 'UPLOAD_REJECTED', message: '文件不能超过 20 MB' })
  })

  describe('线路', () => {
    const LINE_HEADER = ['管理编号*', '线路名*', '英文名', '模式*', '公交公司', '售票类型', '票制', '票价', '状态']
    const ROUTE_HEADER = ['管理编号*', '走向*', '服务类型', '服务时间', '发车间隔']
    const RS_HEADER = ['管理编号*', '走向*', '序号*', '站名*', '方位*', '到站时刻']
    const stops = async () => {
      for (const [name, direction] of [
        ['人民广场', '东'],
        ['火车站', '场站'],
        ['北门', '南'],
      ])
        await api.post('/api/stops').send({ name, direction, lng: 120.2, lat: 30.25 }).expect(201)
    }

    it('AC-12：有一个路径站的站点不存在，该线路整条失败并列出未匹配站点，其他线路照常', async () => {
      await stops()
      const buf = await workbookBuffer([
        sheet('线路', LINE_HEADER, [
          ['G-1', '1路', null, '单向', null, '无人售票', null, '2 元', null],
          ['G-2', '2路', null, '单向'],
        ]),
        sheet('走向', ROUTE_HEADER, [['G-1', '单向', '发车间隔', '06:00–22:00', '10 分钟']]),
        sheet('路径站', RS_HEADER, [
          ['G-1', '单向', 1, '人民广场', '东', '06:00,06:30'],
          ['G-1', '单向', 2, '火车站', '场站', '06:10，06:40'],
          ['G-2', '单向', 1, '人民广场', '东'],
          ['G-2', '单向', 2, '不存在的站', '北'],
          ['G-2', '单向', 3, '也没有', '南'],
        ]),
      ])
      const job = await upload('line', buf)
      expect(job.preview.created).toEqual([{ key: 'G-1', name: '1路' }])
      expect(job.preview.failures).toEqual([
        expect.objectContaining({
          key: 'G-2',
          rows: [3, 4, 5, 6],
          unmatchedStops: ['不存在的站（北）', '也没有（南）'],
          reasons: ['有 2 个站点匹配不上'],
        }),
      ])
      await confirm(job.id)
      const lines = (await api.get('/api/lines')).body.items
      expect(lines.map((l: { name: string }) => l.name)).toEqual(['1路'])
      const l = (await api.get(`/api/lines/${lines[0].id}`)).body as LineDetail
      expect(l.routes[0]).toMatchObject({ kind: 'oneway', serviceType: 'interval', serviceTime: '06:00–22:00' })
      expect(l.routes[0].stops.map((s) => s.times)).toEqual([
        ['06:00', '06:30'],
        ['06:10', '06:40'],
      ])
      const snaps = await t.prisma.snapshot.findMany({ where: { objectId: l.id } })
      expect(snaps.map((s) => s.action)).toEqual(['importCreate'])
    })

    it('导出线路后原样导入为零修改；改模式时预览列出将删除的走向', async () => {
      await stops()
      const ids = (await api.get('/api/stops?size=10')).body.items.map((s: { id: string }) => s.id)
      await api
        .post('/api/lines')
        .send({
          name: 'K1路',
          number: 'K-1',
          mode: 'twoway',
          fare: '2 元',
          routes: [
            {
              kind: 'up',
              serviceType: 'scheduled',
              stops: [{ stopId: ids[0], times: ['06:00'] }, { stopId: ids[1], times: ['06:05'] }, { stopId: ids[0] }],
            },
            { kind: 'down', stops: [{ stopId: ids[2] }, { stopId: ids[1] }] },
          ],
        })
        .expect(201)
      const exported = await download('/api/export/lines')
      const job = await upload('line', exported)
      expect(job.preview).toMatchObject({ created: [], updated: [], unchanged: 1, failures: [] })

      const buf = await workbookBuffer([sheet('线路', LINE_HEADER, [['K-1', 'K1路', null, '单向']])])
      const job2 = await upload('line', buf)
      expect(job2.preview.removedRoutes).toEqual([{ key: 'K-1', name: 'K1路', routes: ['下行'] }])
      expect(job2.preview.updated[0].diff.map((d) => d.label)).toContain('线路模式')
      await confirm(job2.id)
      const l = (await api.get('/api/lines')).body.items[0]
      expect(l.routes.map((r: { kind: string; count: number }) => [r.kind, r.count])).toEqual([['oneway', 3]])
    })

    it('走向名与模式不符、序号不连续、时刻格式不对时整条失败', async () => {
      await stops()
      const buf = await workbookBuffer([
        sheet('线路', LINE_HEADER, [['G-3', '3路', null, '双边']]),
        sheet('路径站', RS_HEADER, [
          ['G-3', '环线', 1, '人民广场', '东'],
          ['G-3', '上行', 1, '人民广场', '东', '7点'],
          ['G-3', '上行', 3, '火车站', '场站'],
        ]),
      ])
      const job = await upload('line', buf)
      expect(job.preview.created).toEqual([])
      expect(job.preview.failures[0].reasons).toEqual(
        expect.arrayContaining([
          '走向「环线」与模式「双边」不符（应为 上行、下行）',
          '上行的序号应从 1 起连续且不重复',
          expect.stringContaining('时刻「7点」格式不对'),
          '缺少走向「下行」的路径站',
        ]),
      )
    })
  })
})
