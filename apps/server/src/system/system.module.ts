import { Module } from '@nestjs/common'
import { BackupStatusService } from './backup-status.service'
import { SystemController } from './system.controller'
import { TotalsService } from './totals.service'

@Module({
  controllers: [SystemController],
  providers: [BackupStatusService, TotalsService],
})
export class SystemModule {}
