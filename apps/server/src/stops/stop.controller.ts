import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import {
  stopInput,
  stopListQuery,
  stopUpdateInput,
  type StopInput,
  type StopListQuery,
  type StopUpdateInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { StopService } from './stop.service'

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
