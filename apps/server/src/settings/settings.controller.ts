import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common'
import {
  EXT_OWNERS,
  extFieldCreateInput,
  extFieldUpdateInput,
  landmarkSettingsInput,
  orientationInput,
  reorderInput,
  type ExtFieldCreateInput,
  type ExtFieldUpdateInput,
  type LandmarkSettingsInput,
  type OrientationInput,
  type ReorderInput,
} from '@gentransit/shared'
import { z } from 'zod'
import { ZodPipe } from '../common/zod.pipe'
import { SettingsService } from './settings.service'

@Controller('api/settings')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  get() {
    return this.svc.get()
  }

  @Put('orientation')
  orientation(@Body(new ZodPipe(orientationInput)) body: OrientationInput) {
    return this.svc.setOrientation(body.mode)
  }

  @Put('landmarks')
  landmarks(@Body(new ZodPipe(landmarkSettingsInput)) body: LandmarkSettingsInput) {
    return this.svc.setLandmarks(body)
  }
}

const ownerQuery = z.object({ owner: z.enum(EXT_OWNERS).optional() })

/** 扩展字段：只能停用，不能删除（没有 DELETE 接口） */
@Controller('api/ext-fields')
export class ExtFieldController {
  constructor(private readonly svc: SettingsService) {}

  @Get()
  list(@Query(new ZodPipe(ownerQuery)) q: z.infer<typeof ownerQuery>) {
    return this.svc.listExt(q.owner)
  }

  @Post()
  create(@Body(new ZodPipe(extFieldCreateInput)) body: ExtFieldCreateInput) {
    return this.svc.createExt(body)
  }

  @Put('order')
  reorder(@Body(new ZodPipe(reorderInput)) body: ReorderInput) {
    return this.svc.reorderExt(body.ids)
  }

  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(extFieldUpdateInput)) body: ExtFieldUpdateInput) {
    return this.svc.updateExt(id, body)
  }
}
