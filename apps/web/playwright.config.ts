import { defineConfig } from '@playwright/test'
import { E2E_BASE_URL } from './e2e/env'

// 端到端测试：globalSetup 起真实 PostgreSQL 容器与构建后的服务端（同时托管前端构建产物），
// 高德变量置空，地图固定使用示意平面，不依赖外网与密钥。先执行 pnpm -r build
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    // 使用本机 Chrome，不下载浏览器
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
})
