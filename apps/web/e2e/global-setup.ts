import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { E2E_ADMIN, E2E_BASE_URL, E2E_PORT } from './env'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(here, '../../server')
const webDist = path.resolve(here, '../dist')

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // 服务还没起来
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`等待 ${url} 超时`)
}

export default async function globalSetup() {
  for (const f of [path.join(serverDir, 'dist/main.js'), path.join(webDist, 'index.html')])
    if (!fs.existsSync(f)) throw new Error(`缺少构建产物 ${f}，请先执行 pnpm -r build（pnpm test:e2e 会自动构建）`)

  const pg = await new PostgreSqlContainer('postgres:16')
    .withDatabase('gentransit_e2e')
    .withUsername('gt')
    .withPassword('gt')
    .start()
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: pg.getConnectionUri(),
    SESSION_SECRET: 'e2e-session-secret-0123456789abcdef0123456789',
    GT_ADMIN_USERNAME: E2E_ADMIN.username,
    GT_ADMIN_PASSWORD: E2E_ADMIN.password,
    // 高德变量置空：前端退回示意平面
    AMAP_JSAPI_KEY: '',
    AMAP_JSAPI_SECURITY_CODE: '',
    AMAP_WEB_SERVICE_KEY: '',
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gentransit-e2e-uploads-')),
    WEB_DIST: webDist,
    PORT: String(E2E_PORT),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
  }
  execSync('npx prisma migrate deploy', { cwd: serverDir, env, stdio: 'pipe' })
  const server = spawn(process.execPath, ['dist/main.js'], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await waitFor(`${E2E_BASE_URL}/api/health`, 60_000)

  return async () => {
    server.kill()
    await pg.stop()
  }
}
