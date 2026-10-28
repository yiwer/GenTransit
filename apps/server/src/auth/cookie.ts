import type { Request, Response } from 'express'
import { SESSION_COOKIE, SESSION_TTL_MS } from './auth.service'

/** httpOnly + SameSite=Lax；HTTPS 下加 Secure */
export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_TTL_MS,
  })
}

export function clearSessionCookie(req: Request, res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' })
}
