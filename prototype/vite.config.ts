import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 高德 JS API：Key 天生会到浏览器，注入为编译期常量；
// 安全密钥只留在开发服务器，由 /_AMapService 代理在转发时附加 jscode，浏览器拿不到。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const key = env.AMAP_JSAPI_KEY ?? ''
  const code = env.AMAP_JSAPI_SECURITY_CODE ?? ''

  const withCode = (prefix: string, target: string) => ({
    target,
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => {
      const rest = p.slice(prefix.length) || '/'
      return `${rest}${rest.includes('?') ? '&' : '?'}jscode=${encodeURIComponent(code)}`
    },
  })

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __AMAP_JSAPI_KEY__: JSON.stringify(key),
      __AMAP_PROXY_READY__: JSON.stringify(Boolean(code)),
    },
    server: {
      host: '127.0.0.1',
      port: 5180,
      strictPort: true,
      proxy: code
        ? {
            '/_AMapService/v4/map/styles': withCode('/_AMapService', 'https://webapi.amap.com'),
            '/_AMapService/v3/vectormap': withCode('/_AMapService', 'https://fmap01.amap.com'),
            '/_AMapService': withCode('/_AMapService', 'https://restapi.amap.com'),
          }
        : undefined,
    },
  }
})
