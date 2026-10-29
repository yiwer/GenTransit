import fs from 'node:fs'
import path from 'node:path'
import {
  Controller,
  Get,
  Header,
  Inject,
  Injectable,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import { v1DeletedQuery, v1DictQuery, type V1ListQuery } from '@gentransit/shared'
import type { Response } from 'express'
import type { z } from 'zod'
import { Public, TokenAuth } from '../common/decorators'
import { notFound } from '../common/errors'
import { ZodPipe } from '../common/zod.pipe'
import { ENV, type Env } from '../config/env'
import { UploadService } from '../uploads/upload.service'
import { ApiV1Service } from './api-v1.service'
import { buildOpenApi, v1HeavyListQuery, v1StopListQuery } from './openapi'

/** 只读 API 的 JSON 响应不缓存（文件除外） */
@Injectable()
class NoStore implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    ctx.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store')
    return next.handle()
  }
}

const list = new ZodPipe(v1StopListQuery)
const heavy = new ZodPipe(v1HeavyListQuery)
const uuid = new ParseUUIDPipe()

/** 站点、线路、站牌集（M4 计划 3.2 节） */
@Controller('api/v1')
@TokenAuth()
@UseInterceptors(NoStore)
export class V1CoreController {
  constructor(private readonly api: ApiV1Service) {}

  @Get('stops')
  stops(@Query(list) q: V1ListQuery) {
    return this.api.stops(q)
  }

  @Get('stops/:id')
  stop(@Param('id', uuid) id: string) {
    return this.api.stop(id)
  }

  @Get('stops/:stopId/sign-set')
  signSetOfStop(@Param('stopId', uuid) stopId: string) {
    return this.api.signSetOfStop(stopId)
  }

  @Get('lines')
  lines(@Query(heavy) q: V1ListQuery) {
    return this.api.lines(q)
  }

  @Get('lines/:id')
  line(@Param('id', uuid) id: string) {
    return this.api.line(id)
  }

  @Get('sign-sets')
  signSets(@Query(heavy) q: V1ListQuery) {
    return this.api.signSetPage(q)
  }
}

/** 地标与参考数据、已删除对象 */
@Controller('api/v1')
@TokenAuth()
@UseInterceptors(NoStore)
export class V1ReferenceController {
  constructor(private readonly api: ApiV1Service) {}

  @Get('landmarks')
  landmarks(@Query(list) q: V1ListQuery) {
    return this.api.landmarks(q)
  }

  @Get('landmarks/:id')
  landmark(@Param('id', uuid) id: string) {
    return this.api.landmark(id)
  }

  @Get('landmark-categories')
  landmarkCategories(@Query(list) q: V1ListQuery) {
    return this.api.landmarkCategories(q)
  }

  @Get('landmark-categories/:id')
  landmarkCategory(@Param('id', uuid) id: string) {
    return this.api.landmarkCategory(id)
  }

  @Get('dict-items')
  dictItems(@Query(new ZodPipe(v1DictQuery)) q: z.infer<typeof v1DictQuery>) {
    return this.api.dictItems(q)
  }

  @Get('regions')
  regions(@Query(list) q: V1ListQuery) {
    return this.api.regions(q)
  }

  @Get('bus-companies')
  busCompanies(@Query(list) q: V1ListQuery) {
    return this.api.busCompanies(q)
  }

  @Get('shelf-templates')
  shelfTemplates(@Query(list) q: V1ListQuery) {
    return this.api.shelfTemplates(q)
  }

  @Get('ext-fields')
  extFields(@Query(list) q: V1ListQuery) {
    return this.api.extFields(q)
  }

  @Get('deleted')
  deleted(@Query(new ZodPipe(v1DeletedQuery)) q: z.infer<typeof v1DeletedQuery>) {
    return this.api.deleted(q)
  }
}

/** 文件：Token 用户走这里；内部 /api/uploads/:id 仍只认登录会话（默认决定 11） */
@Controller('api/v1')
@TokenAuth()
export class V1FileController {
  constructor(private readonly uploads: UploadService) {}

  @Get('files/:id')
  async file(@Param('id', uuid) id: string, @Res() res: Response) {
    const f = await this.uploads.locate(id)
    if (!fs.existsSync(f.abs)) throw notFound('文件')
    res.setHeader('Content-Type', f.mime)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    fs.createReadStream(f.abs).pipe(res)
  }
}

/** swagger-ui-dist 的本地静态文件，内网也能打开；只放行这几个 */
const SWAGGER_DIR = path.dirname(require.resolve('swagger-ui-dist/package.json'))
const SWAGGER_FILES: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  'favicon-32x32.png': 'image/png',
}

const DOCS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GenTransit 只读 API</title>
<link rel="icon" type="image/png" href="/api/v1/docs/favicon-32x32.png">
<link rel="stylesheet" href="/api/v1/docs/swagger-ui.css">
<style>body{margin:0;background:#faf6ee}.swagger-ui .topbar{display:none}.swagger-ui .info .title{font-family:"Noto Serif SC",serif}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/api/v1/docs/swagger-ui-bundle.js"></script>
<script src="/api/v1/docs/init.js"></script>
</body>
</html>`

// Token 不存进浏览器存储；默认折叠接口列表
const DOCS_INIT = `window.ui = SwaggerUIBundle({
  url: '/api/v1/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: false,
  docExpansion: 'list',
  defaultModelsExpandDepth: 0,
})`

/** OpenAPI 文档与文档页不需要 Token：里面没有业务数据（默认决定 10） */
@Controller('api/v1')
@Public()
export class V1DocsController {
  private doc?: unknown

  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('openapi.json')
  @Header('Cache-Control', 'no-cache')
  openapi() {
    this.doc ??= buildOpenApi(this.env.APP_VERSION ?? 'dev')
    return this.doc
  }

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  docs() {
    return DOCS_HTML
  }

  @Get('docs/init.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  init() {
    return DOCS_INIT
  }

  @Get('docs/:file')
  asset(@Param('file') file: string, @Res() res: Response) {
    const type = SWAGGER_FILES[file]
    if (!type) throw notFound('文件')
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    // pnpm 的依赖目录在 .pnpm 下：send 默认拒绝带点开头的路径段
    res.sendFile(path.join(SWAGGER_DIR, file), { dotfiles: 'allow' })
  }
}
