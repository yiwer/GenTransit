import { BootstrapService } from '../src/bootstrap.service'
import { ADMIN, createTestApp, type TestApp } from './helpers'

describe('认证（T3）', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await createTestApp()
  })
  beforeEach(() => t.reset())
  afterAll(() => t.close())

  it('库里没有账号时用环境变量创建初始账号，密码为 argon2id 哈希；之后变量不再生效', async () => {
    const accounts = await t.prisma.account.findMany()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].username).toBe('admin')
    expect(accounts[0].passwordHash).toMatch(/^\$argon2id\$/)
    // 再次启动（即使换了环境变量）也不会新建或改动账号
    t.env.GT_ADMIN_USERNAME = 'someone-else'
    await t.app.get(BootstrapService).run()
    t.env.GT_ADMIN_USERNAME = ADMIN.username
    expect(await t.prisma.account.count()).toBe(1)
    expect((await t.prisma.account.findFirstOrThrow()).username).toBe('admin')
  })

  it('登录成功下发 httpOnly、SameSite=Lax 的会话 Cookie，库里只存令牌哈希', async () => {
    const res = await t.anon().post('/api/auth/login').send(ADMIN).expect(200)
    expect(res.body).toEqual({ username: 'admin' })
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/gt_sid=/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
    const token = /gt_sid=([^;]+)/.exec(cookie)![1]
    const sessions = await t.prisma.session.findMany()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].tokenHash).not.toContain(token)
    expect(sessions[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000)
  })

  it('需要登录的接口：未登录 401，登录后可访问，退出后再次 401', async () => {
    const anon = t.anon()
    const r401 = await anon.get('/api/auth/me').expect(401)
    expect(r401.body.code).toBe('UNAUTHORIZED')
    const agent = await t.login()
    await agent.get('/api/auth/me').expect(200, { username: 'admin' })
    await agent.post('/api/auth/logout').expect(204)
    await agent.get('/api/auth/me').expect(401)
  })

  it('用户名或密码错误返回剩余次数；连续 5 次失败后第 6 次被锁（即使密码正确）', async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await t
        .anon()
        .post('/api/auth/login')
        .send({ username: 'admin', password: `wrong-${i}` })
        .expect(401)
      expect(r.body.code).toBe('AUTH_INVALID')
      expect(r.body.details.remaining).toBe(5 - i)
    }
    const locked = await t.anon().post('/api/auth/login').send(ADMIN).expect(429)
    expect(locked.body.code).toBe('AUTH_LOCKED')
    // 计数存在 Account 上，重启不丢
    const acc = await t.prisma.account.findFirstOrThrow()
    expect(acc.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000)
    // 锁定过期后可以登录，计数清零
    await t.prisma.account.update({ where: { id: acc.id }, data: { lockedUntil: new Date(Date.now() - 1000) } })
    await t.anon().post('/api/auth/login').send(ADMIN).expect(200)
    expect((await t.prisma.account.findFirstOrThrow()).failedCount).toBe(0)
  })

  it('修改密码需要原密码；成功后其他会话失效，当前会话保留', async () => {
    const a = await t.login()
    const b = await t.login()
    const bad = await a
      .post('/api/auth/password')
      .send({ oldPassword: 'nope', newPassword: 'new-password-2' })
      .expect(400)
    expect(bad.body.message).toBe('原密码不正确')
    await a.post('/api/auth/password').send({ oldPassword: ADMIN.password, newPassword: 'new-password-2' }).expect(204)
    await a.get('/api/auth/me').expect(200)
    await b.get('/api/auth/me').expect(401)
    await t.anon().post('/api/auth/login').send(ADMIN).expect(401)
    await t.login('new-password-2')
  })

  it('新密码至少 8 位', async () => {
    const a = await t.login()
    const r = await a.post('/api/auth/password').send({ oldPassword: ADMIN.password, newPassword: 'short' }).expect(400)
    expect(r.body.code).toBe('VALIDATION_FAILED')
  })

  it('CSRF：写请求缺少 X-GT-Request 或不是 JSON 时被拒绝', async () => {
    const r1 = await t.anon().post('/api/auth/login').unset('X-GT-Request').send(ADMIN).expect(403)
    expect(r1.body.code).toBe('CSRF_REJECTED')
    const r2 = await t
      .anon()
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(ADMIN))
      .expect(403)
    expect(r2.body.code).toBe('CSRF_REJECTED')
  })
})
