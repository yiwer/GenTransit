import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Res } from '@nestjs/common'
import { signSetInput, signSetListQuery, type SignSetInput, type SignSetListQuery } from '@gentransit/shared'
import type { Response } from 'express'
import { ZodPipe } from '../common/zod.pipe'
import { writeWorkbook } from '../import/excel'
import { signSetSheets } from './sign-set-export'
import { SignSetService } from './sign-set.service'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

@Controller('api')
export class SignSetController {
  constructor(private readonly svc: SignSetService) {}

  @Get('sign-sets')
  list(@Query(new ZodPipe(signSetListQuery)) q: SignSetListQuery) {
    return this.svc.list(q)
  }

  @Get('sign-sets/board-sizes')
  boardSizes() {
    return this.svc.boardSizes()
  }

  @Get('sign-sets/summary')
  summary() {
    return this.svc.summary()
  }

  /** 编辑器与预览 */
  @Get('stops/:stopId/sign-set')
  get(@Param('stopId', ParseUUIDPipe) stopId: string) {
    return this.svc.get(stopId)
  }

  @Put('sign-sets/:id')
  save(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(signSetInput)) body: SignSetInput) {
    return this.svc.save(id, body)
  }

  /** 站牌集导出：当前筛选结果，四个 sheet */
  @Get('export/sign-sets')
  async export(@Query(new ZodPipe(signSetListQuery)) q: SignSetListQuery, @Res() res: Response) {
    const { items } = await this.svc.ids(q)
    const ids = items.map((x) => x.id)
    const name = `站牌集_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader('Content-Type', XLSX)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
    res.setHeader('Cache-Control', 'no-store')
    await writeWorkbook(
      res,
      signSetSheets(() => this.svc.exportBatches(ids)),
    )
  }
}
