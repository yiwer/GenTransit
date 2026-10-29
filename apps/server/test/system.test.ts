import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BackupStatus, SystemTotals } from '@gentransit/shared'
import { BackupStatusService } from '../src/system/backup-status.service'
import type { Env } from '../src/config/env'
import { createTestApp } from './helpers'

const pad = (n: number) => String(n).padStart(2, '0')
/** 本地时间的备份名 YYYYMMDD-HHMMSS */
const nameOf = (d: Date, suffix = '') =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${suffix}`

function backup(dir: string, at: Date, size = 1000, suffix = '') {
  const name = nameOf(at, suffix)
  fs.mkdirSync(path.join(dir, name, 'uploads'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, name, 'manifest.json'),
    JSON.stringify({ createdAt: at.toISOString(), db: { size }, uploads: { size: 24 } }),
  )
  return name
}

describe('备份状态（M4 T6）', () => {
  const NOW = new Date(2026, 9, 28, 10, 0, 0)
  let dir: string
  const svc = (over: Partial<Env> = {}) =>
    new BackupStatusService({ BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: 30, ...over } as Env)

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-backup-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('未配置 BACKUP_DIR', async () => {
    const s = await svc({ BACKUP_DIR: undefined }).status(NOW)
    expect(s).toMatchObject({ configured: false, retentionDays: 30, days: [], alert: null })
  })

  it('正常：30 天日历，成功、缺失；.partial 不算', async () => {
    const day = (n: number, h = 2) => new Date(2026, 9, 28 - n, h, 30, 0)
    backup(dir, day(0), 2000)
    backup(dir, day(1))
    backup(dir, day(1, 15), 3000, '-manual')
    backup(dir, day(5))
    fs.mkdirSync(path.join(dir, `${nameOf(day(2))}.partial`))
    fs.writeFileSync(
      path.join(dir, 'status.json'),
      JSON.stringify({ lastAttemptAt: day(0).toISOString(), lastSuccessAt: day(0).toISOString(), lastError: null }),
    )
    const s = await svc().status(NOW)
    expect(s.configured).toBe(true)
    expect(s.days).toHaveLength(30)
    expect(s.days.at(-1)).toEqual({ date: '2026-10-28', status: 'ok', size: 2024 })
    expect(s.days.at(-2)).toEqual({ date: '2026-10-27', status: 'ok', size: 3024 })
    expect(s.days.at(-3)).toEqual({ date: '2026-10-26', status: 'missing', size: null })
    expect(s.days.at(-6)?.status).toBe('ok')
    expect(s.latest).toEqual({ name: nameOf(day(0)), size: 2024, createdAt: day(0).toISOString() })
    expect(s.lastSuccessAt).toBe(day(0).toISOString())
    expect(s.alert).toBeNull()
  })

  it('过期：最近一次成功超过 48 小时', async () => {
    backup(dir, new Date(2026, 9, 25, 2, 30))
    const s = await svc().status(NOW)
    expect(s.alert).toBe('stale')
    // 一份都没有也算过期
    fs.rmSync(dir, { recursive: true })
    fs.mkdirSync(dir)
    expect((await svc().status(NOW)).alert).toBe('stale')
  })

  it('失败：最近一次尝试失败；失败日在日历上标出', async () => {
    const ok = new Date(2026, 9, 27, 2, 30)
    const bad = new Date(2026, 9, 28, 2, 30)
    backup(dir, ok)
    fs.mkdirSync(path.join(dir, 'failures'))
    fs.writeFileSync(path.join(dir, 'failures', `${nameOf(bad)}.txt`), 'pg_dump: 连接失败')
    fs.writeFileSync(
      path.join(dir, 'status.json'),
      JSON.stringify({
        lastAttemptAt: bad.toISOString(),
        lastSuccessAt: ok.toISOString(),
        lastError: 'pg_dump: 连接失败',
      }),
    )
    const s: BackupStatus = await svc().status(NOW)
    expect(s.alert).toBe('failed')
    expect(s.lastError).toBe('pg_dump: 连接失败')
    expect(s.days.at(-1)).toEqual({ date: '2026-10-28', status: 'failed', size: null })
    expect(s.days.at(-2)?.status).toBe('ok')
  })

  it('接口需要登录会话', async () => {
    const t = await createTestApp(undefined, { BACKUP_DIR: dir })
    try {
      await t.reset()
      await t.anon().get('/api/system/backup').expect(401)
      const api = await t.login()
      const r = await api.get('/api/system/backup').expect(200)
      expect(r.body).toMatchObject({ configured: true, alert: 'stale' })
    } finally {
      await t.close()
    }
  })
})

describe('工作台总数', () => {
  it('站点、线路、站牌总数；需要登录会话', async () => {
    const t = await createTestApp()
    try {
      await t.reset()
      await t.anon().get('/api/system/totals').expect(401)
      const api = await t.login()
      expect((await api.get('/api/system/totals').expect(200)).body).toEqual({ stops: 0, lines: 0, boards: 0 })
      await api.post('/api/stops').send({ name: '总数站', direction: '东', lng: 120.2, lat: 30.25 }).expect(201)
      await api.post('/api/stops').send({ name: '总数站', direction: '西', lng: 120.21, lat: 30.25 }).expect(201)
      const r: SystemTotals = (await api.get('/api/system/totals').expect(200)).body
      expect(r).toEqual({ stops: 2, lines: 0, boards: await t.prisma.board.count() })
    } finally {
      await t.close()
    }
  })
})
