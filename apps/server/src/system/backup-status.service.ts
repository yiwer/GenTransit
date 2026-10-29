import fs from 'node:fs/promises'
import path from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import { BACKUP_STALE_MS, type BackupDay, type BackupStatus } from '@gentransit/shared'
import { ENV, type Env } from '../config/env'

/** 备份目录名：本地时间 YYYYMMDD-HHMMSS，可带后缀（-manual、-pre-restore） */
const NAME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{6})(-[a-z-]+)?$/
const DAYS = 30

interface StatusFile {
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
  lastError?: string | null
}

interface Manifest {
  createdAt?: string
  db?: { size?: number }
  uploads?: { size?: number }
}

const readJson = async <T>(file: string): Promise<T | null> => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

const dateOf = (name: string) => {
  const m = NAME_RE.exec(name)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const later = (a: string | null | undefined, b: string | null | undefined) =>
  !a ? (b ?? null) : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b

/**
 * 备份状态（M4 计划 5.5 节）：读 BACKUP_DIR/status.json、各份备份的 manifest.json 与 failures/ 下的失败记录。
 * 备份由独立的 backup 容器完成，应用只读这个目录
 */
@Injectable()
export class BackupStatusService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async status(now = new Date()): Promise<BackupStatus> {
    const empty: BackupStatus = {
      configured: false,
      retentionDays: this.env.BACKUP_RETENTION_DAYS,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      latest: null,
      days: [],
      alert: null,
    }
    const dir = this.env.BACKUP_DIR
    if (!dir) return empty
    const status = (await readJson<StatusFile>(path.join(dir, 'status.json'))) ?? {}
    let names: string[]
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return { ...empty, configured: true, lastError: '读不到备份目录', alert: 'failed' }
    }
    // 成功的备份：目录名合法且有 manifest.json（.partial 不算）
    const ok = (
      await Promise.all(
        names
          .filter((n) => NAME_RE.test(n))
          .map(async (name) => {
            const m = await readJson<Manifest>(path.join(dir, name, 'manifest.json'))
            return m && { name, createdAt: m.createdAt ?? null, size: (m.db?.size ?? 0) + (m.uploads?.size ?? 0) }
          }),
      )
    ).filter((x): x is { name: string; createdAt: string | null; size: number } => Boolean(x))
    ok.sort((a, b) => (a.name < b.name ? -1 : 1))
    let failures: string[] = []
    try {
      failures = (await fs.readdir(path.join(dir, 'failures'))).map((f) => f.replace(/\.txt$/, ''))
    } catch {
      // 没有失败记录
    }

    const latestOk = ok.at(-1) ?? null
    const lastSuccessAt = later(status.lastSuccessAt, latestOk?.createdAt)
    const lastAttemptAt = later(status.lastAttemptAt, lastSuccessAt)
    const failedLast = Boolean(status.lastError) && lastAttemptAt !== null && lastAttemptAt !== lastSuccessAt

    const days: BackupDay[] = []
    for (let i = DAYS - 1; i >= 0; i--) {
      const date = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
      const good = ok.filter((x) => dateOf(x.name) === date)
      const bad = failures.some((f) => dateOf(f) === date)
      days.push({
        date,
        status: good.length ? 'ok' : bad ? 'failed' : 'missing',
        size: good.at(-1)?.size ?? null,
      })
    }
    const stale = !lastSuccessAt || now.getTime() - Date.parse(lastSuccessAt) > BACKUP_STALE_MS
    return {
      configured: true,
      retentionDays: this.env.BACKUP_RETENTION_DAYS,
      lastSuccessAt,
      lastAttemptAt,
      lastError: failedLast ? (status.lastError ?? null) : null,
      latest: latestOk && { name: latestOk.name, size: latestOk.size, createdAt: latestOk.createdAt ?? '' },
      days,
      alert: failedLast ? 'failed' : stale ? 'stale' : null,
    }
  }
}
