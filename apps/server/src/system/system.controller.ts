import { Controller, Get } from '@nestjs/common'
import { BackupStatusService } from './backup-status.service'

/** 系统状态（登录会话） */
@Controller('api/system')
export class SystemController {
  constructor(private readonly backup: BackupStatusService) {}

  @Get('backup')
  backupStatus() {
    return this.backup.status()
  }
}
