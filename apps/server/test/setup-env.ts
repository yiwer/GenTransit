// 每个测试进程的环境变量：固定为测试值，不受本机系统环境变量（如真实高德密钥）影响
import os from 'node:os'
import path from 'node:path'

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
  GT_ADMIN_USERNAME: 'admin',
  GT_ADMIN_PASSWORD: 'initial-pass-1',
  AMAP_JSAPI_KEY: 'test-jsapi-key',
  AMAP_JSAPI_SECURITY_CODE: 'test-security-code-7f3a9c',
  AMAP_WEB_SERVICE_KEY: 'test-web-service-key-5b1d',
  UPLOAD_DIR: path.join(os.tmpdir(), `gentransit-test-uploads-${process.pid}`),
  WEB_DIST: '',
})
