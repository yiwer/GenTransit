import { Module } from '@nestjs/common'
import { UploadModule } from '../uploads/upload.module'
import { ShelfTemplateController, ShelfTemplateService } from './shelf-template'
import { SignSetRouteRemovalHook } from './sign-set-route-removal.hook'
import { SignSetStatusService } from './sign-set-status.service'
import { SignSetController } from './sign-set.controller'
import { SignSetService } from './sign-set.service'

@Module({
  imports: [UploadModule],
  controllers: [SignSetController, ShelfTemplateController],
  providers: [SignSetService, SignSetStatusService, SignSetRouteRemovalHook, ShelfTemplateService],
  exports: [SignSetService, SignSetStatusService, SignSetRouteRemovalHook],
})
export class SignSetModule {}
