import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { LoggerModule } from 'nestjs-pino'
import { AmapModule } from './amap/amap.module'
import { AuthGuard } from './auth/auth.guard'
import { AuthModule } from './auth/auth.module'
import { BaseDataModule } from './base-data/base-data.module'
import { BootstrapService } from './bootstrap.service'
import { CsrfGuard } from './common/csrf.guard'
import { AllExceptionsFilter } from './common/http-exception.filter'
import { ConfigModule } from './config/config.module'
import { ENV, type Env } from './config/env'
import { HealthController } from './health/health.controller'
import { ImportModule } from './import/import.module'
import { LandmarksModule } from './landmarks/landmarks.module'
import { LineModule } from './lines/line.module'
import { PrismaModule } from './prisma/prisma.module'
import { SettingsModule } from './settings/settings.module'
import { SnapshotModule } from './snapshots/snapshot.module'
import { StopModule } from './stops/stop.module'
import { UploadModule } from './uploads/upload.module'

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport:
            env.NODE_ENV === 'development' && process.stdout.isTTY
              ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } }
              : undefined,
          // 只记方法、路径与状态码：不记录请求头（Cookie、会话令牌）
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url === '/api/health' },
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    SnapshotModule,
    UploadModule,
    BaseDataModule,
    SettingsModule,
    AmapModule,
    LandmarksModule,
    StopModule,
    LineModule,
    ImportModule,
  ],
  controllers: [HealthController],
  providers: [
    BootstrapService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 先查 CSRF 请求头，再查登录会话
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
