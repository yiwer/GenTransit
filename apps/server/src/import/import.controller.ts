import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  COORD_SYSTEMS,
  IMPORT_KINDS,
  IMPORT_MAX_BYTES,
  lineListQuery,
  stopListQuery,
  type ImportKind,
  type LineListQuery,
  type StopListQuery,
} from '@gentransit/shared'
import type { Response } from 'express'
import { z } from 'zod'
import { AllowMultipart } from '../common/decorators'
import { ZodPipe } from '../common/zod.pipe'
import type { IncomingFile } from '../uploads/upload.service'
import { ImportService } from './import.service'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const kindParam = z.enum(IMPORT_KINDS)
const createBody = z.object({ coordSystem: z.enum(COORD_SYSTEMS).optional() })
const today = () => new Date().toISOString().slice(0, 10)

function attach(res: Response, name: string) {
  res.setHeader('Content-Type', XLSX)
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
  res.setHeader('Cache-Control', 'no-store')
}

@Controller('api')
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  @Get('import/:kind/template')
  async template(@Param('kind', new ZodPipe(kindParam)) kind: ImportKind, @Res() res: Response) {
    attach(res, `${kind === 'stop' ? '站点' : '线路'}导入模板.xlsx`)
    await this.svc.template(kind, res)
  }

  /** 上传并生成预览（multipart，≤20 MB） */
  @Post('import/:kind')
  @AllowMultipart()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1 }, defParamCharset: 'utf8' }),
  )
  create(
    @Param('kind', new ZodPipe(kindParam)) kind: ImportKind,
    @UploadedFile() file: IncomingFile | undefined,
    @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>,
  ) {
    return this.svc.create(kind, file, body.coordSystem)
  }

  @Get('import/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id)
  }

  @Post('import/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.confirm(id)
  }

  @Post('import/:id/cancel')
  @HttpCode(204)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(id)
  }

  @Get('import/:id/failures')
  async failures(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.svc.failures(id)
    attach(res, f.name)
    res.send(f.buffer)
  }

  /** 站点导出：当前筛选结果 */
  @Get('export/stops')
  async exportStops(@Query(new ZodPipe(stopListQuery)) q: StopListQuery, @Res() res: Response) {
    attach(res, `站点_${today()}.xlsx`)
    await this.svc.exportStops(q, res)
  }

  /** 线路导出：当前筛选结果 */
  @Get('export/lines')
  async exportLines(@Query(new ZodPipe(lineListQuery)) q: LineListQuery, @Res() res: Response) {
    attach(res, `线路_${today()}.xlsx`)
    await this.svc.exportLines(q, res)
  }
}
