import { Module } from '@nestjs/common'
import { LineModule } from '../lines/line.module'
import { StopModule } from '../stops/stop.module'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'

@Module({
  imports: [StopModule, LineModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
