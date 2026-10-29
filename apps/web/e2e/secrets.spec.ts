import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? files(p) : /\.(js|css|html|json|map|svg)$/.test(e.name) ? [p] : []
  })
}

// 前端构建产物里不能出现安全密钥与 Web 服务 Key（用本机环境变量里的真实值检查，只报告是否出现，不打印值）
test('前端构建产物不含高德安全密钥与 Web 服务 Key', () => {
  const secrets = [
    process.env.AMAP_JSAPI_SECURITY_CODE,
    process.env.AMAP_WEB_SERVICE_KEY,
    process.env.AMAP_API_KEY,
  ].filter((s): s is string => Boolean(s && s.length >= 8))
  test.skip(secrets.length === 0, '本机没有设置高德密钥环境变量')
  const leaked = files(dist).filter((f) => {
    const text = fs.readFileSync(f, 'utf8')
    return secrets.some((s) => text.includes(s))
  })
  expect(leaked.map((f) => path.relative(dist, f))).toEqual([])
})

test('未登录取不到 /api/config', async ({ request }) => {
  const res = await request.get('/api/config')
  // 未登录也不能拿到任何配置
  expect(res.status()).toBe(401)
})
