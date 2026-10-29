import { Module } from '@nestjs/common'
import { upstreamsOf } from '../amap/amap.module'
import { AMAP_UPSTREAMS } from '../amap/regeo.service'
import { ENV } from '../config/env'
import { SignSetRouteRemovalHook } from '../sign-sets/sign-set-route-removal.hook'
import { SignSetModule } from '../sign-sets/sign-set.module'
import { LineController } from './line.controller'
import { LineService } from './line.service'
import { ROUTE_REMOVAL_HOOK } from './route-removal.hook'
import { RouteTrackService } from './route-track.service'

@Module({
  imports: [SignSetModule],
  controllers: [LineController],
  // 删除走向时的连带处理由站牌集模块实现（M3 计划 3.5 节）
  providers: [
    LineService,
    { provide: ROUTE_REMOVAL_HOOK, useExisting: SignSetRouteRemovalHook },
    // 走向轨迹调用高德驾车路线规划；上游地址与高德模块同一套（测试里换成假服务）
    RouteTrackService,
    { provide: AMAP_UPSTREAMS, inject: [ENV], useFactory: upstreamsOf },
  ],
  exports: [LineService, ROUTE_REMOVAL_HOOK],
})
export class LineModule {}
