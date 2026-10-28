// PROTOTYPE — 高德 JS API 2.0 加载（全局只加载一次）
import AMapLoader from '@amap/amap-jsapi-loader'

let loading: Promise<any> | null = null

/** Key 和安全密钥代理都配置了才使用高德底图，否则退回示意地图 */
export const amapAvailable = () => Boolean(__AMAP_JSAPI_KEY__) && __AMAP_PROXY_READY__

export function loadAMap(): Promise<any> {
  if (!loading) {
    // 安全密钥不进浏览器：JS API 的服务请求改走开发服务器的 /_AMapService 代理，由代理附加 jscode
    ;(window as any)._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` }
    loading = AMapLoader.load({ key: __AMAP_JSAPI_KEY__, version: '2.0', plugins: ['AMap.Scale'] }).catch((e: unknown) => {
      loading = null
      throw e
    })
  }
  return loading
}
