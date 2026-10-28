import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { ERROR_CODES, UPLOAD_MAX_BYTES, type Upload } from '@gentransit/shared'
import { AppError, notFound } from '../common/errors'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** 按文件头判断真实类型，不只信浏览器给的 MIME */
export function sniffImage(buf: Buffer): keyof typeof EXT | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return null
}

/** multer 解析出的文件（内存存储） */
export interface IncomingFile {
  buffer: Buffer
  originalname: string
  mimetype: string
  size: number
}

export const rejected = (message: string, status = 415) => new AppError(status, ERROR_CODES.uploadRejected, message)

@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  toDto(u: { id: string; originalName: string; mime: string; size: number }): Upload {
    return { id: u.id, url: `/api/uploads/${u.id}`, originalName: u.originalName, mime: u.mime, size: u.size }
  }

  async save(file: IncomingFile | undefined): Promise<Upload> {
    if (!file) throw rejected('请选择要上传的文件', 400)
    if (file.size > UPLOAD_MAX_BYTES) throw rejected('文件不能超过 10 MB', 413)
    const mime = sniffImage(file.buffer)
    if (!mime || mime !== (file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype))
      throw rejected('只支持 jpg、png、webp 图片')
    const now = new Date()
    const rel = path.join(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${EXT[mime]}`,
    )
    const abs = path.join(this.env.uploadDir, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, file.buffer)
    const row = await this.prisma.upload.create({
      data: {
        path: rel.split(path.sep).join('/'),
        originalName: file.originalname.slice(0, 200),
        mime,
        size: file.size,
      },
    })
    return this.toDto(row)
  }

  async locate(id: string) {
    const row = await this.prisma.upload.findUnique({ where: { id } })
    if (!row) throw notFound('文件')
    return { abs: path.join(this.env.uploadDir, row.path), mime: row.mime, name: row.originalName }
  }
}
