import { defineConfig } from '@playwright/test'

// AC-18 的真实 Key 检查（M4 计划第 6 节第 3 项）：对着本机的 Docker 部署跑，默认不运行。
// 不起测试容器（没有 globalSetup）；地址、账号取环境变量，缺省读仓库根目录的 .env。
// 用法：pnpm -F @gentransit/web test:real-amap
export default defineConfig({
  testDir: './e2e',
  testMatch: /real-amap\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  projects: [
    {
      name: 'real-amap',
      use: {
        baseURL: process.env.GT_REAL_BASE_URL ?? 'http://127.0.0.1:8080',
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
        locale: 'zh-CN',
      },
    },
  ],
})
