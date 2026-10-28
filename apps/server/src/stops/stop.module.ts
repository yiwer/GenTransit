import { Module } from '@nestjs/common'
import { UploadModule } from '../uploads/upload.module'
import { StopController } from './stop.controller'
import { StopService } from './stop.service'

@Module({
  imports: [UploadModule],
  controllers: [StopController],
  providers: [StopService],
  exports: [StopService],
})
export class StopModule {}
