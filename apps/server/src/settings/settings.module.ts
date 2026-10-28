import { Global, Module } from '@nestjs/common'
import { ExtFieldController, SettingsController } from './settings.controller'
import { SettingsService } from './settings.service'

@Global()
@Module({
  controllers: [SettingsController, ExtFieldController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
