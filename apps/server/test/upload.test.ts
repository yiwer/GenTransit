import type { Agent } from 'supertest'
import { createTestApp, type TestApp } from './helpers'

// 最小的合法 PNG（1×1）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

describe('上传（T7）', () => {
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

  it('上传 png 后可以用登录会话下载；未登录不能下载', async () => {
    const res = await api
      .post('/api/uploads')
      .attach('file', PNG, { filename: '站牌照片.png', contentType: 'image/png' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ originalName: '站牌照片.png', mime: 'image/png', size: PNG.length })
    expect(res.body.url).toBe(`/api/uploads/${res.body.id}`)
    const dl = await api.get(res.body.url).buffer(true).expect(200)
    expect(dl.headers['content-type']).toBe('image/png')
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0)
    await t.anon().get(res.body.url).expect(401)
  })

  it('超过 10 MB 被拒', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1)])
    const res = await api.post('/api/uploads').attach('file', big, { filename: 'big.png', contentType: 'image/png' })
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'UPLOAD_REJECTED', message: '文件不能超过 10 MB' })
  })

  it('不是 jpg / png / webp 被拒；扩展名伪装也被拒', async () => {
    const txt = await api
      .post('/api/uploads')
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' })
    expect(txt.status).toBe(415)
    expect(txt.body).toMatchObject({ code: 'UPLOAD_REJECTED', message: '只支持 jpg、png、webp 图片' })
    const fake = await api
      .post('/api/uploads')
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'x.png',
        contentType: 'image/png',
      })
    expect(fake.status).toBe(415)
  })

  it('上传要求 X-GT-Request 请求头', async () => {
    const res = await t
      .anon()
      .post('/api/uploads')
      .unset('X-GT-Request')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
    expect(res.status).toBe(403)
  })
})
