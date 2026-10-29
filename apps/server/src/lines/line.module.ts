import { Module } from '@nestjs/common'
import { SignSetRouteRemovalHook } from '../sign-sets/sign-set-route-removal.hook'
import { SignSetModule } from '../sign-sets/sign-set.module'
import { LineController } from './line.controller'
import { LineService } from './line.service'
import { ROUTE_REMOVAL_HOOK } from './route-removal.hook'

@Module({
  imports: [SignSetModule],
  controllers: [LineController],
  // 删除走向时的连带处理由站牌集模块实现（M3 计划 3.5 节）
  providers: [LineService, { provide: ROUTE_REMOVAL_HOOK, useExisting: SignSetRouteRemovalHook }],
  exports: [LineService, ROUTE_REMOVAL_HOOK],
})
export class LineModule {}
