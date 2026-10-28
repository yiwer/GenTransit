import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import { changePasswordInput, loginInput, type ChangePasswordInput, type LoginInput, type Me } from '@gentransit/shared'
import type { Request, Response } from 'express'
import { CurrentSession, Public, type SessionInfo } from '../common/decorators'
import { ZodPipe } from '../common/zod.pipe'
import { AuthService } from './auth.service'
import { clearSessionCookie, setSessionCookie } from './cookie'

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginInput)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    const { token, username } = await this.auth.login(body.username, body.password)
    setSessionCookie(req, res, token)
    return { username }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentSession() s: SessionInfo, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(s.id)
    clearSessionCookie(req, res)
  }

  @Get('me')
  me(@CurrentSession() s: SessionInfo): Me {
    return { username: s.username }
  }

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentSession() s: SessionInfo,
    @Body(new ZodPipe(changePasswordInput)) body: ChangePasswordInput,
  ) {
    await this.auth.changePassword(s, body.oldPassword, body.newPassword)
  }
}
