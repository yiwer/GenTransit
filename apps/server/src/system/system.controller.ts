import { Controller, Get } from '@nestjs/common'
import { BackupStatusService } from './backup-status.service'
import { TotalsService } from './totals.service'

/** 系统状态（登录会话） */
@Controller('api/system')
export class SystemController {
  constructor(
    private readonly backup: BackupStatusService,
    private readonly counts: TotalsService,
  ) {}

  @Get('backup')
  backupStatus() {
    return this.backup.status()
  }

  /** 工作台：站点、线路、站牌总数 */
  @Get('totals')
  totals() {
    return this.counts.totals()
  }
}
