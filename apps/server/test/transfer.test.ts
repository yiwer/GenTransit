import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTestApp, type TestApp } from './helpers'

/** M6 计划 3.1、3.2：压缩传输与静态资源缓存头 */
describe('压缩与缓存头', () => {
  let t: TestApp
  let dist: string

  beforeAll(async () => {
    // 假的前端构建产物：带哈希的 JS、字体、图片，根目录的 favicon 与 index.html
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'gentransit-dist-'))
    fs.mkdirSync(path.join(dist, 'assets'))
    fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><title>GenTransit</title>${' '.repeat(2000)}`)
    fs.writeFileSync(path.join(dist, 'assets/index-AbC123.js'), 'console.log("站点");\n'.repeat(500))
    fs.writeFileSync(path.join(dist, 'assets/noto-sans-sc-0-400-normal-AbC123.woff2'), Buffer.alloc(4096, 7))
    fs.writeFileSync(path.join(dist, 'assets/login-AbC123.png'), Buffer.alloc(4096, 9))
    fs.writeFileSync(
      path.join(dist, 'favicon.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(400)}</svg>`,
    )
    t = await createTestApp(undefined, { WEB_DIST: dist })
    await t.reset()
  })
  afterAll(async () => {
    await t.close()
    fs.rmSync(dist, { recursive: true, force: true })
  })

  const gzip = { 'Accept-Encoding': 'gzip' }

  it('接口 JSON 超过 1 KB 时 gzip 压缩，小响应不压缩', async () => {
    await t.prisma.stop.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({ name: `压缩站${i}`, direction: '东', lng: 120.1, lat: 30.2 })),
    })
    const api = await t.login()
    const list = await api.get('/api/stops?size=50').set(gzip).expect(200)
    expect(list.headers['content-encoding']).toBe('gzip')
    expect(list.body.total).toBe(40)
    const health = await t.anon().get('/api/health').set(gzip).expect(200)
    expect(health.headers['content-encoding']).toBeUndefined()
  })

  it('带哈希的静态资源缓存一年，JS 压缩，字体与图片不再压缩', async () => {
    const js = await t.anon().get('/assets/index-AbC123.js').set(gzip).expect(200)
    expect(js.headers['content-encoding']).toBe('gzip')
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    for (const f of ['noto-sans-sc-0-400-normal-AbC123.woff2', 'login-AbC123.png']) {
      const res = await t.anon().get(`/assets/${f}`).set(gzip).expect(200)
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    }
  })

  it('其他静态文件缓存一天，index.html 与页面路由不缓存', async () => {
    const icon = await t.anon().get('/favicon.svg').set(gzip).expect(200)
    expect(icon.headers['cache-control']).toBe('public, max-age=86400')
    for (const url of ['/index.html', '/stops', '/sign-sets/abc']) {
      const res = await t.anon().get(url).set(gzip).expect(200)
      expect(res.headers['cache-control']).toBe('no-cache')
      expect(res.headers['content-encoding']).toBe('gzip')
    }
  })
})
