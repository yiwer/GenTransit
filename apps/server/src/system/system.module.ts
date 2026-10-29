import { Module } from '@nestjs/common'
import { BackupStatusService } from './backup-status.service'
import { SystemController } from './system.controller'

@Module({
  controllers: [SystemController],
  providers: [BackupStatusService],
})
export class SystemModule {}
