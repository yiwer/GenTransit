import { Test, type TestingModuleBuilder } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/app.setup'
import { BootstrapService } from '../src/bootstrap.service'
import { ENV, loadEnv, type Env } from '../src/config/env'
import { PrismaService } from '../src/prisma/prisma.service'

export const ADMIN = { username: 'admin', password: 'initial-pass-1' }

export interface TestApp {
  app: NestExpressApplication
  prisma: PrismaService
  env: Env
  /** 未登录的请求，写请求已带 X-GT-Request */
  anon: () => request.Agent
  /** 已登录的请求（Cookie 保存在 agent 里） */
  login: (password?: string) => Promise<request.Agent>
  /** 清空数据并补齐初始账号与设置 */
  reset: () => Promise<void>
  close: () => Promise<void>
}

export async function createTestApp(
  customize?: (b: TestingModuleBuilder) => TestingModuleBuilder,
  envOverride: Partial<Env> = {},
): Promise<TestApp> {
  const env = { ...loadEnv(), ...envOverride }
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
  if (customize) builder = customize(builder)
  const moduleRef = await builder.compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true })
  configureApp(app, env)
  await app.init()
  const prisma = app.get(PrismaService)
  const anon = () => request.agent(app.getHttpServer()).set('X-GT-Request', '1')
  return {
    app,
    prisma,
    env,
    anon,
    login: async (password = ADMIN.password) => {
      const agent = anon()
      await agent.post('/api/auth/login').send({ username: ADMIN.username, password }).expect(200)
      return agent
    },
    reset: async () => {
      await resetDb(prisma)
      await app.get(BootstrapService).run()
    },
    close: () => app.close(),
  }
}

/** 清空全部业务表（保留迁移记录） */
export async function resetDb(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`)
}
