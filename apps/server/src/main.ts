import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { EnvError, loadDotEnv, loadEnv, type Env } from './config/env'

async function main() {
  loadDotEnv()
  let env: Env
  try {
    env = loadEnv()
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(e.message)
      process.exit(1)
    }
    throw e
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true })
  configureApp(app, env)
  await app.listen(env.PORT, env.HOST)
}

void main()
