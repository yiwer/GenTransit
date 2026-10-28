import path from 'node:path'
import { defineConfig } from 'prisma/config'

// 读取仓库根目录的 .env（已存在的环境变量优先）
try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env'))
} catch {
  // 没有 .env 时只用系统环境变量
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
})
