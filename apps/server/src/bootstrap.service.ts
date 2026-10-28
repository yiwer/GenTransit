import { Injectable, OnApplicationBootstrap } from '@nestjs/common'
import { AuthService } from './auth/auth.service'
import { PrismaService } from './prisma/prisma.service'

/** 启动时补齐必需数据：初始账号、单行设置 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap() {
    await this.run()
  }

  async run() {
    await this.auth.ensureInitialAccount()
    await this.prisma.setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
  }
}
