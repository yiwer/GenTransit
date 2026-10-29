import { Global, Module } from '@nestjs/common'
import { ChangeClock } from './change-clock'
import { SnapshotController } from './snapshot.controller'
import { SnapshotService } from './snapshot.service'

@Global()
@Module({
  controllers: [SnapshotController],
  providers: [SnapshotService, ChangeClock],
  exports: [SnapshotService],
})
export class SnapshotModule {}
