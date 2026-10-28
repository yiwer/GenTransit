import { Module } from '@nestjs/common'
import { AmapController } from './amap.controller'
import { AMAP_UPSTREAMS, DEFAULT_UPSTREAMS, RegeoService } from './regeo.service'

@Module({
  controllers: [AmapController],
  providers: [RegeoService, { provide: AMAP_UPSTREAMS, useValue: DEFAULT_UPSTREAMS }],
})
export class AmapModule {}
