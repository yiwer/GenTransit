import { Controller, Get, Query } from '@nestjs/common'
import { OBJECT_TYPES, pageInput, type DeletedItem, type Page, type SnapshotItem } from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { SnapshotService } from './snapshot.service'

const timelineQuery = z.object({ type: z.enum(OBJECT_TYPES), id: z.uuid() })
const deletedQuery = pageInput.extend({ type: z.enum(OBJECT_TYPES) })

@Controller('api/snapshots')
export class SnapshotController {
  constructor(private readonly snapshots: SnapshotService) {}

  @Get()
  timeline(@Query(new ZodPipe(timelineQuery)) q: z.infer<typeof timelineQuery>): Promise<SnapshotItem[]> {
    return this.snapshots.timeline(q.type, q.id)
  }

  @Get('deleted')
  deleted(@Query(new ZodPipe(deletedQuery)) q: z.infer<typeof deletedQuery>): Promise<Page<DeletedItem>> {
    return this.snapshots.deleted(q.type, q.page, q.size)
  }
}
