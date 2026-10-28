import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import {
  lineInput,
  lineListQuery,
  lineUpdateInput,
  revInput,
  type LineInput,
  type LineListQuery,
  type LineUpdateInput,
  type RevInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { LineService } from './line.service'

const nameQuery = z.object({ name: z.string().trim().min(1), excludeId: z.uuid().optional() })
const numberQuery = z.object({ number: z.string().trim().min(1), excludeId: z.uuid().optional() })
const routeQuery = z.object({ routeId: z.uuid() })

@Controller('api/lines')
export class LineController {
  constructor(private readonly svc: LineService) {}

  @Get()
  list(@Query(new ZodPipe(lineListQuery)) q: LineListQuery) {
    return this.svc.list(q)
  }

  @Get('check-name')
  checkName(@Query(new ZodPipe(nameQuery)) q: z.infer<typeof nameQuery>) {
    return this.svc.checkName(q.name, q.excludeId)
  }

  @Get('check-number')
  checkNumber(@Query(new ZodPipe(numberQuery)) q: z.infer<typeof numberQuery>) {
    return this.svc.checkNumber(q.number, q.excludeId)
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id)
  }

  @Get(':id/transfers')
  transfers(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodPipe(routeQuery)) q: z.infer<typeof routeQuery>) {
    return this.svc.transfers(id, q.routeId)
  }

  @Get(':id/delete-check')
  deleteCheck(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCheck(id)
  }

  @Post()
  create(@Body(new ZodPipe(lineInput)) body: LineInput) {
    return this.svc.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(lineUpdateInput)) body: LineUpdateInput) {
    return this.svc.update(id, body)
  }

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(revInput)) body: RevInput) {
    return this.svc.setStatus(id, body.rev, 'suspended')
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(revInput)) body: RevInput) {
    return this.svc.setStatus(id, body.rev, 'running')
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id)
  }
}
