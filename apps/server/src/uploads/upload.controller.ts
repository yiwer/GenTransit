import fs from 'node:fs'
import { Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { UPLOAD_MAX_BYTES, type Upload } from '@gentransit/shared'
import type { Response } from 'express'
import { AllowMultipart } from '../common/decorators'
import { notFound } from '../common/errors'
import { UploadService, type IncomingFile } from './upload.service'

@Controller('api/uploads')
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  /** 上传图片：jpg / png / webp，单张 ≤10 MB；M1 不生成缩略图。未指定存储时 multer 放在内存里 */
  @Post()
  @AllowMultipart()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
      defParamCharset: 'utf8',
    }),
  )
  upload(@UploadedFile() file: IncomingFile | undefined): Promise<Upload> {
    return this.uploads.save(file)
  }

  /** 下载需要登录会话；API Token 用户走 /api/v1/files/{id}（M4 计划 3.7 节） */
  @Get(':id')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.uploads.locate(id)
    if (!fs.existsSync(f.abs)) throw notFound('文件')
    res.setHeader('Content-Type', f.mime)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    fs.createReadStream(f.abs).pipe(res)
  }
}
