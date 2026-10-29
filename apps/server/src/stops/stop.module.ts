import { Module } from '@nestjs/common'
import { SignSetModule } from '../sign-sets/sign-set.module'
import { UploadModule } from '../uploads/upload.module'
import { StopController } from './stop.controller'
import { StopService } from './stop.service'

@Module({
  imports: [UploadModule, SignSetModule],
  controllers: [StopController],
  providers: [StopService],
  exports: [StopService],
})
export class StopModule {}
