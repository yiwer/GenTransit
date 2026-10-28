import { Global, Module } from '@nestjs/common'
import { SnapshotController } from './snapshot.controller'
import { SnapshotService } from './snapshot.service'

@Global()
@Module({
  controllers: [SnapshotController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class SnapshotModule {}
