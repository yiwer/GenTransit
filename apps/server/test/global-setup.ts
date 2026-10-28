// 起一个真实 PostgreSQL 16 容器并执行全部迁移；连接串通过环境变量传给测试进程
import { execSync } from 'node:child_process'
import path from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

declare global {
  var __GT_PG__: StartedPostgreSqlContainer | undefined
}

export default async function globalSetup() {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('gentransit_test')
    .withUsername('gt')
    .withPassword('gt')
    .start()
  const url = container.getConnectionUri()
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  process.env.DATABASE_URL = url
  globalThis.__GT_PG__ = container
}
