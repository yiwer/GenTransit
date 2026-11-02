// 精简的 R3F 画布：@react-three/fiber 的 <Canvas> 会 extend(THREE) 把整个 three 打进包里（3D 分包 gzip 约 257 KB，
// 超出 250 KB 的预算）。这里用 createRoot 自己挂载，只注册场景里用到的几个类，three 其余部分可以被摇树去掉
import { createRoot, events, extend, type ReconcilerRoot, type RenderProps } from '@react-three/fiber'
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'

extend({
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Object3D,
})

type Config = Omit<RenderProps<HTMLCanvasElement>, 'size' | 'events'>

/** 场景里抛错（着色器编译失败等）时交给外层退回提示 */
class SceneBoundary extends Component<{ onError: (e: unknown) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(e: unknown) {
    this.props.onError(e)
  }
  override render() {
    return this.state.failed ? null : this.props.children
  }
}

export function GlCanvas({
  children,
  onError,
  'aria-label': label,
  ...config
}: Config & { children: ReactNode; onError: (e: unknown) => void; 'aria-label'?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const root = useRef<ReconcilerRoot<HTMLCanvasElement> | null>(null)
  const [size, setSize] = useState<{ width: number; height: number; top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((s) =>
        s && s.width === r.width && s.height === r.height && s.top === r.top && s.left === r.left
          ? s
          : { width: r.width, height: r.height, top: r.top, left: r.left },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!size || size.width <= 0 || size.height <= 0 || !canvas.current) return
    root.current ??= createRoot(canvas.current)
    const r = root.current
    r.configure({ ...config, size, events })
      .then(() => r.render(<SceneBoundary onError={onError}>{children}</SceneBoundary>))
      .catch(onError)
  })

  useEffect(
    () => () => {
      root.current?.unmount()
      root.current = null
    },
    [],
  )

  return (
    <div ref={box} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvas} className="block h-full w-full" aria-label={label} />
    </div>
  )
}
