// 高德底图 + 自绘 SVG 覆盖层。底图只负责街道与平移缩放，并用滤镜调成暖纸色；
// 站点、涟漪、地标辐射圈、定位标记由覆盖层绘制。高德 logo 与版权信息保持可见
import AMapLoader from '@amap/amap-jsapi-loader'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useIsDark } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { MapOverlay, ZoomControls } from './overlay'
import { PlaneMap } from './PlaneMap'
import { DEFAULT_CENTER, type MapProps } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- 高德 JS API 没有官方类型 */

const STYLE = { light: 'amap://styles/whitesmoke', dark: 'amap://styles/dark' }
const TINT = {
  light: 'sepia(0.28) saturate(0.78) hue-rotate(-8deg) brightness(1.03) contrast(0.96)',
  dark: 'sepia(0.35) saturate(0.6) hue-rotate(-10deg) brightness(0.92)',
}

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

export function AMapView(props: MapProps & { amapKey: string }) {
  const { amapKey, points = [], circles = [], marker, onPick, fit, className, overlay } = props
  const holder = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const AMapRef = useRef<any>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [hoverLocal, setHoverLocal] = useState<string | null>(null)
  const dark = useIsDark()

  useEffect(() => {
    let dead = false
    let anim = false
    loadAMap(amapKey)
      .then((AMap) => {
        if (dead || !holder.current) return
        AMapRef.current = AMap
        const map = new AMap.Map(holder.current, {
          viewMode: '2D',
          zoom: 13,
          center: DEFAULT_CENTER,
          mapStyle: document.documentElement.classList.contains('dark') ? STYLE.dark : STYLE.light,
          // 不显示 POI，避免和地标打架
          features: ['bg', 'road', 'building'],
          showLabel: true,
          resizeEnable: true,
          doubleClickZoom: false,
        })
        map.addControl(new AMap.Scale({ position: 'LB' }))
        mapRef.current = map
        const bump = () => setTick((t) => t + 1)
        // 平移、缩放动画期间逐帧刷新覆盖层
        const loop = () => {
          if (!anim) return
          bump()
          requestAnimationFrame(loop)
        }
        const start = () => {
          if (anim) return
          anim = true
          loop()
        }
        const end = () => {
          anim = false
          bump()
        }
        map.on('movestart', start)
        map.on('zoomstart', start)
        map.on('dragstart', start)
        map.on('moveend', end)
        map.on('zoomend', end)
        map.on('dragend', end)
        map.on('mapmove', bump)
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
      anim = false
      mapRef.current?.destroy()
      mapRef.current = null
    }
  }, [amapKey])

  useEffect(() => {
    mapRef.current?.setMapStyle(dark ? STYLE.dark : STYLE.light)
  }, [dark])

  // 视野：一个点放大到街道级，多个点适配范围
  const fitKey = fit?.key
  useEffect(() => {
    const map = mapRef.current
    const AMap = AMapRef.current
    if (!ready || !map || !fit || !fit.points.length) return
    if (fit.points.length === 1) {
      map.setZoomAndCenter(17, fit.points[0])
      return
    }
    const lngs = fit.points.map((p) => p[0])
    const lats = fit.points.map((p) => p[1])
    map.setBounds(
      new AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]),
      false,
      [70, 70, 70, 70],
    )
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
      {/* 高德会给容器加 .amap-container（position: relative），所以尺寸写在内联样式里；滤镜只作用于底图 */}
      <div
        ref={holder}
        className={onPick ? 'cursor-crosshair' : undefined}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: dark ? TINT.dark : TINT.light }}
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
          selectedId={props.selectedId}
          hoverId={props.hoverId ?? hoverLocal}
          emphasizeIds={props.emphasizeIds}
          showLabels={zoom >= 16}
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
          const pts = fit?.points.length ? fit.points : points.map((p) => [p.lng, p.lat] as [number, number])
          if (!map || !pts.length) return
          if (pts.length === 1) map.setZoomAndCenter(17, pts[0])
          else map.setFitView(null, false, [70, 70, 70, 70])
        }}
      />
      {overlay}
    </div>
  )
}
