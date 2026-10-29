// 端到端测试启动服务端进程的公共代码：globalSetup 起主服务端，AC-18 用例另起一个带哨兵密钥的服务端
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const serverDir = path.resolve(here, '../../server')
export const webDist = path.resolve(here, '../dist')

export async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // 服务还没起来
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`等待 ${url} 超时`)
}

export interface StartedServer {
  process: ChildProcess
  baseUrl: string
  stop: () => Promise<void>
}

/**
 * 启动构建后的服务端（dist/main.js），等健康检查通过。
 * logFile：把标准输出与标准错误写到文件（AC-18 检查服务端日志）；不传则继承到测试进程
 */
export async function startServer(env: NodeJS.ProcessEnv, opts: { logFile?: string } = {}): Promise<StartedServer> {
  const out = opts.logFile ? fs.openSync(opts.logFile, 'a') : 'inherit'
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: serverDir, env, stdio: ['ignore', out, out] })
  const baseUrl = `http://127.0.0.1:${env.PORT}`
  await waitFor(`${baseUrl}/api/health`, 60_000)
  return {
    process: child,
    baseUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        // 被信号结束的进程 exitCode 为 null、signalCode 有值
        if (child.exitCode !== null || child.signalCode !== null) return resolve()
        child.once('exit', () => {
          if (typeof out === 'number') fs.closeSync(out)
          resolve()
        })
        child.kill()
      }),
  }
}
