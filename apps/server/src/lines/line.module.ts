import { Module } from '@nestjs/common'
import { LineController } from './line.controller'
import { LineService } from './line.service'
import { NoopRouteRemovalHook, ROUTE_REMOVAL_HOOK } from './route-removal.hook'

@Module({
  controllers: [LineController],
  // M3 把空实现换成真正处理编排的实现
  providers: [LineService, { provide: ROUTE_REMOVAL_HOOK, useClass: NoopRouteRemovalHook }],
  exports: [LineService],
})
export class LineModule {}
