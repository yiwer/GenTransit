/// <reference types="vite/client" />

/** 高德 JS API Key（来自环境变量 AMAP_JSAPI_KEY），为空时退回示意地图 */
declare const __AMAP_JSAPI_KEY__: string
/** 开发服务器是否配置了安全密钥代理（AMAP_JSAPI_SECURITY_CODE） */
declare const __AMAP_PROXY_READY__: boolean
