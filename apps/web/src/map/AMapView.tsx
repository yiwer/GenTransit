// 高德底图 + 自绘 SVG 覆盖层。底图只负责街道与平移缩放，默认用滤镜调成暖纸色，可切换标准、卫星、卫星路网；
// 站点、涟漪、地标辐射圈、定位标记由覆盖层绘制。高德 logo 与版权信息保持可见
import AMapLoader from '@amap/amap-jsapi-loader'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { useIsDark } from '@/lib/theme'
import { cn, useStored } from '@/lib/utils'
import { BASEMAP_KEY, BaseMapSwitch, type BaseMap } from './basemap'
import { MapOverlay, ZoomControls } from './overlay'
import { PlaneMap } from './PlaneMap'
import { DEFAULT_CENTER, type LngLat, type MapProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- 高德 JS API 没有官方类型 */

const STYLE = { light: 'amap://styles/whitesmoke', dark: 'amap://styles/dark', normal: 'amap://styles/normal' }
const TINT = {
  light: 'sepia(0.28) saturate(0.78) hue-rotate(-8deg) brightness(1.03) contrast(0.96)',
  dark: 'sepia(0.35) saturate(0.6) hue-rotate(-10deg) brightness(0.92)',
}
/** 暖纸不显示兴趣点，避免和地标打架；标准显示 */
const FEATURES = { plain: ['bg', 'road', 'building'], full: ['bg', 'road', 'building', 'point'] }
/**
 * 聚焦站点、地标与适配视野的动画时长参数（毫秒）。实测高德默认动画约 300～400 毫秒，
 * 传 250 时实际约 110～130 毫秒，约为原来的三分之一
 */
export const FOCUS_MS = 250
/** 放大到这一级起显示站名（方位），标注互相避让 */
const LABEL_ZOOM = 15
const FIT_PADDING = [70, 70, 70, 70]

let loading: Promise<any> | null = null
/** 全局只加载一次。安全密钥不进浏览器：服务请求走服务端 /_AMapService 代理，由代理附加 jscode */
function loadAMap(key: string): Promise<any> {
  if (!loading) {
    ;(window as any)._AMapSecurityConfig = { serviceHost: `${location.origin}/_AMapService` }
    loading = AMapLoader.load({ key, version: '2.0', plugins: ['AMap.Scale'] }).catch((e: unknown) => {
      loading = null
      throw e
    })
  }
  return loading
}

/** 一个点放大到街道级；多个点按范围算出级别与中心。都用同一个短动画 */
function focus(AMap: any, map: any, pts: LngLat[]) {
  if (!pts.length) return
  if (pts.length === 1) {
    map.setZoomAndCenter(17, pts[0], false, FOCUS_MS)
    return
  }
  const lngs = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  const bounds = new AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)])
  const [zoom, center] = map.getFitZoomAndCenterByBounds(bounds, FIT_PADDING, 18)
  map.setZoomAndCenter(zoom, center, false, FOCUS_MS)
}

export function AMapView(props: MapProps & { amapKey: string }) {
  const { amapKey, points = [], circles = [], routes = [], marker, onPick, fit, className, overlay } = props
  const holder = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const AMapRef = useRef<any>(null)
  const tiles = useRef<{ satellite?: any; roadNet?: any }>({})
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [hoverLocal, setHoverLocal] = useState<string | null>(null)
  const [base, setBase] = useStored<BaseMap>(BASEMAP_KEY, 'paper')
  const dark = useIsDark()

  useEffect(() => {
    let dead = false
    loadAMap(amapKey)
      .then((AMap) => {
        if (dead || !holder.current) return
        AMapRef.current = AMap
        const map = new AMap.Map(holder.current, {
          viewMode: '2D',
          zoom: 13,
          center: DEFAULT_CENTER,
          mapStyle: document.documentElement.classList.contains('dark') ? STYLE.dark : STYLE.light,
          features: FEATURES.plain,
          showLabel: true,
          resizeEnable: true,
          doubleClickZoom: false,
        })
        map.addControl(new AMap.Scale({ position: 'LB' }))
        mapRef.current = map
        const bump = () => setTick((t) => t + 1)
        // 覆盖层和底图在同一帧刷新：自定义图层的 render 由高德在绘制每一帧时调用（平移、拖动、惯性、缩放动画都算），
        // 在里面同步重绘覆盖层。原先在事件里排队刷新，覆盖层总比底图晚一两帧，拖动时会脱离底图、停下后才归位
        const frame = document.createElement('canvas')
        frame.width = 1
        frame.height = 1
        const hook = new AMap.CustomLayer(frame, { zIndex: 1, alwaysRender: true, zooms: [2, 30] })
        hook.render = () => {
          if (!dead) flushSync(bump)
        }
        map.add(hook)
        map.on('resize', bump)
        map.on('click', (e: any) => pickRef.current?.(e.lnglat.getLng(), e.lnglat.getLat()))
        map.on('complete', () => {
          setReady(true)
          bump()
        })
      })
      .catch((e) => !dead && setFailed(String(e?.message ?? e)))
    return () => {
      dead = true
      mapRef.current?.destroy()
      mapRef.current = null
      tiles.current = {}
    }
  }, [amapKey])

  // 底图：矢量底图换样式与要素；卫星与路网是叠在上面的瓦片图层
  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!ready || !map) return
    const t = tiles.current
    const want = { satellite: base === 'satellite' || base === 'hybrid', roadNet: base === 'hybrid' }
    const toggle = (k: 'satellite' | 'roadNet', make: () => any) => {
      if (want[k] && !t[k]) map.add((t[k] = make()))
      if (!want[k] && t[k]) {
        map.remove(t[k])
        t[k] = undefined
      }
    }
    toggle('satellite', () => new AMap.TileLayer.Satellite({ zIndex: 2 }))
    toggle('roadNet', () => new AMap.TileLayer.RoadNet({ zIndex: 3 }))
    map.setMapStyle(dark ? STYLE.dark : base === 'standard' ? STYLE.normal : STYLE.light)
    map.setFeatures(base === 'standard' ? FEATURES.full : FEATURES.plain)
  }, [ready, base, dark])

  // 视野：一个点放大到街道级，多个点适配范围
  const fitKey = fit?.key
  useEffect(() => {
    if (ready && mapRef.current && fit) focus(AMapRef.current, mapRef.current, fit.points)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitKey])

  if (failed) {
    return <PlaneMap {...props} notice={`高德底图加载失败，已退回示意平面：${failed}`} />
  }

  const map = mapRef.current
  const toPx = (lng: number, lat: number): [number, number] => {
    const p = map.lngLatToContainer([lng, lat])
    return [p.getX ? p.getX() : p.x, p.getY ? p.getY() : p.y]
  }
  // 每米多少像素：向东 100 米投影后量像素距离
  const pxPerMeter = (lng: number, lat: number) => {
    const dLng = 100 / (111320 * Math.cos((lat * Math.PI) / 180))
    return Math.abs(toPx(lng + dLng, lat)[0] - toPx(lng, lat)[0]) / 100
  }
  const zoom = ready ? map.getZoom() : 13

  const startMarkerDrag = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const AMap = AMapRef.current
    const el = wrap.current!
    map.setStatus({ dragEnable: false })
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect()
      const ll = map.containerToLngLat(new AMap.Pixel(ev.clientX - r.left, ev.clientY - r.top))
      pickRef.current?.(ll.getLng(), ll.getLat())
    }
    const up = () => {
      map.setStatus({ dragEnable: true })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={wrap}
      className={cn(
        'overflow-hidden bg-[var(--map-land)]',
        !/(^|\s)(absolute|fixed)(\s|$)/.test(className ?? '') && 'relative',
        className,
      )}
    >
      {/* 高德会给容器加 .amap-container（position: relative），所以尺寸写在内联样式里；暖纸滤镜只作用于底图 */}
      <div
        ref={holder}
        className={onPick ? 'cursor-crosshair' : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          filter: base === 'paper' ? (dark ? TINT.dark : TINT.light) : undefined,
        }}
      />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-ink-3">
          正在加载高德底图…
        </div>
      )}
      {ready && (
        <MapOverlay
          toPx={toPx}
          pxPerMeter={pxPerMeter}
          points={points}
          circles={circles}
          routes={routes}
          selectedId={props.selectedId}
          hoverId={props.hoverId ?? hoverLocal}
          emphasizeIds={props.emphasizeIds}
          showLabels={zoom >= LABEL_ZOOM}
          onSelect={props.onSelect}
          onOpen={props.onOpen}
          onHover={props.onHover ?? setHoverLocal}
          marker={marker}
          onMarkerDown={startMarkerDrag}
        />
      )}
      <ZoomControls
        onIn={() => map?.zoomIn()}
        onOut={() => map?.zoomOut()}
        onReset={() => {
          const pts = fit?.points.length ? fit.points : points.map((p) => [p.lng, p.lat] as LngLat)
          if (map) focus(AMapRef.current, map, pts)
        }}
      />
      {ready && <BaseMapSwitch value={base} onChange={setBase} />}
      {overlay}
    </div>
  )
}
