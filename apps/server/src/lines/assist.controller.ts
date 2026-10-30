// M5 的成组修改与编辑器队列：站点一侧的入口（引用、加入线路、替换），以及站牌集编辑器的队列。
// 放在线路模块里，因为它们改的是线路站序、要用线路的编排进度
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common'
import {
  signSetQueueQuery,
  stopJoinInput,
  stopReplaceInput,
  type SignSetQueueQuery,
  type StopJoinInput,
  type StopReplaceInput,
} from '@gentransit/shared'
import { ZodPipe } from '../common/zod.pipe'
import { LineService } from './line.service'
import { QueueService } from './queue.service'

@Controller('api')
export class AssistController {
  constructor(
    private readonly lines: LineService,
    private readonly queues: QueueService,
  ) {}

  @Get('stops/:id/references')
  references(@Param('id', ParseUUIDPipe) id: string) {
    return this.lines.references(id)
  }

  @Post('stops/:id/join')
  @HttpCode(200)
  join(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stopJoinInput)) body: StopJoinInput) {
    return this.lines.joinStop(id, body)
  }

  @Post('stops/:id/replace')
  @HttpCode(200)
  replace(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stopReplaceInput)) body: StopReplaceInput) {
    return this.lines.replaceStop(id, body)
  }

  @Get('sign-sets/queue')
  queue(@Query(new ZodPipe(signSetQueueQuery)) q: SignSetQueueQuery) {
    return this.queues.queue(q)
  }
}
