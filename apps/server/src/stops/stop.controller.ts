import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import {
  stopBatchInput,
  stopInput,
  stopMatchInput,
  stopListQuery,
  stopOppositesInput,
  stopUpdateInput,
  type StopBatchInput,
  type StopInput,
  type StopListQuery,
  type StopMatchInput,
  type StopUpdateInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { StopService } from './stop.service'

const num = z.number().finite()
const inViewQuery = z.object({
  bbox: z
    .string()
    .transform((v) => v.split(',').map(Number))
    .pipe(z.tuple([num, num, num, num], '视野格式为 西,南,东,北')),
})
const suggestQuery = z.object({ q: z.string().trim().max(100).default('') })
const nameQuery = z.object({
  name: z.string().trim().min(1),
  direction: z.string().trim().min(1),
  excludeId: z.uuid().optional(),
})

@Controller('api/stops')
export class StopController {
  constructor(private readonly svc: StopService) {}

  @Get()
  list(@Query(new ZodPipe(stopListQuery)) q: StopListQuery) {
    return this.svc.list(q)
  }

  @Get('suggest')
  suggest(@Query(new ZodPipe(suggestQuery)) q: z.infer<typeof suggestQuery>) {
    return this.svc.suggest(q.q)
  }

  @Get('check-name')
  checkName(@Query(new ZodPipe(nameQuery)) q: z.infer<typeof nameQuery>) {
    return this.svc.checkName(q.name, q.direction, q.excludeId)
  }

  /** 站名 + 方位批量匹配（只读，用 POST 以便传较多行） */
  @Post('match')
  @HttpCode(200)
  match(@Body(new ZodPipe(stopMatchInput)) body: StopMatchInput) {
    return this.svc.match(body.rows)
  }

  /** 对向站点（BR-19；只读，用 POST 以便传较多 ID） */
  @Post('opposites')
  @HttpCode(200)
  opposites(@Body(new ZodPipe(stopOppositesInput)) body: z.infer<typeof stopOppositesInput>) {
    return this.svc.opposites(body.ids)
  }

  @Get('in-view')
  inView(@Query(new ZodPipe(inViewQuery)) q: z.infer<typeof inViewQuery>) {
    return this.svc.inView(q.bbox)
  }

  @Get('extent')
  extent() {
    return this.svc.extent()
  }

  @Post('batch/preview')
  @HttpCode(200)
  batchPreview(@Body(new ZodPipe(stopBatchInput)) body: StopBatchInput) {
    return this.svc.batchPreview(body)
  }

  @Post('batch')
  @HttpCode(200)
  batch(@Body(new ZodPipe(stopBatchInput)) body: StopBatchInput) {
    return this.svc.batch(body)
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id)
  }

  @Get(':id/delete-check')
  deleteCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCheck(id)
  }

  @Post()
  create(@Body(new ZodPipe(stopInput)) body: StopInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stopUpdateInput)) body: StopUpdateInput) {
    return this.svc.update(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
