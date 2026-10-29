import { Module } from '@nestjs/common'
import { ENV, type Env } from '../config/env'
import { AmapController } from './amap.controller'
import { AMAP_UPSTREAMS, DEFAULT_UPSTREAMS, RegeoService, type AmapUpstreams } from './regeo.service'

/** AMAP_UPSTREAM_OVERRIDE 只在测试环境生效（AC-18 端到端测试的假上游） */
export function upstreamsOf(env: Env): AmapUpstreams {
  const o = env.NODE_ENV === 'test' ? env.AMAP_UPSTREAM_OVERRIDE?.replace(/\/+$/, '') : undefined
  return o ? { webapi: o, fmap: o, restapi: o } : DEFAULT_UPSTREAMS
}

@Module({
  controllers: [AmapController],
  providers: [RegeoService, { provide: AMAP_UPSTREAMS, inject: [ENV], useFactory: upstreamsOf }],
})
export class AmapModule {}
