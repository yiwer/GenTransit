// 单元测试与集成测试共用一套配置；集成测试在 globalSetup 里用 Testcontainers 起真实 PostgreSQL
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }] },
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // 所有测试文件共用一个数据库，串行执行，每个用例前清空数据
  maxWorkers: 1,
  testTimeout: 60_000,
}
