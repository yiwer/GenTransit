import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { apiTokenInput, type ApiTokenInput } from '@gentransit/shared'
import { ZodPipe } from '../common/zod.pipe'
import { ApiTokenService } from './api-token.service'

/** 设置"API Token"页签：只认登录会话，Token 不能用来管理 Token（默认决定 3） */
@Controller('api/api-tokens')
export class ApiTokenController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  list() {
    return this.tokens.list()
  }

  @Post()
  create(@Body(new ZodPipe(apiTokenInput)) body: ApiTokenInput) {
    return this.tokens.create(body.name)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.tokens.remove(id)
  }
}
