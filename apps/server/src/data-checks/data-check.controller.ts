import { Controller, Get } from '@nestjs/common'
import { DataCheckService } from './data-check.service'

@Controller('api/data-checks')
export class DataCheckController {
  constructor(private readonly svc: DataCheckService) {}

  @Get()
  counts() {
    return this.svc.counts()
  }
}
