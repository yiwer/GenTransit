import { Controller, Get, Query } from '@nestjs/common'
import {
  OBJECT_TYPES,
  pageInput,
  type DeletedItem,
  type Page,
  type RecentChange,
  type SnapshotItem,
} from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { SnapshotService } from './snapshot.service'

const timelineQuery = z.object({ type: z.enum(OBJECT_TYPES), id: z.uuid() })
const deletedQuery = pageInput.extend({ type: z.enum(OBJECT_TYPES) })
const recentQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) })

@Controller('api/snapshots')
export class SnapshotController {
  constructor(private readonly snapshots: SnapshotService) {}

  @Get()
  timeline(@Query(new ZodPipe(timelineQuery)) q: z.infer<typeof timelineQuery>): Promise<SnapshotItem[]> {
    return this.snapshots.timeline(q.type, q.id)
  }

  /** 工作台"最近修改" */
  @Get('recent')
  recent(@Query(new ZodPipe(recentQuery)) q: z.infer<typeof recentQuery>): Promise<RecentChange[]> {
    return this.snapshots.recent(q.limit)
  }

  @Get('deleted')
  deleted(@Query(new ZodPipe(deletedQuery)) q: z.infer<typeof deletedQuery>): Promise<Page<DeletedItem>> {
    return this.snapshots.deleted(q.type, q.page, q.size)
  }
}
