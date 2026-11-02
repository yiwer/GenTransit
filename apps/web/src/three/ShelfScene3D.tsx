// 3D 预览（M7 计划 5.3 节）：编辑器与站架类型页共用；只读，懒加载单独分包（three + @react-three/fiber）。
// 站架按顺序沿路缘排开，结构与挂牌位置来自 shelf-model（与立面同源），牌面是 Canvas 贴图。
// 按需渲染（frameloop="demand"），几何按类型参数与站牌尺寸缓存，贴图只在牌面内容或配色变化时重画。
// 观感是"画室"的暖纸调：哑光材质、暖色半球光 + 一盏投软阴影的平行光，背景跟随浅色 / 深色主题
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { ShelfSpec } from '@gentransit/shared'
import { Box, Eye, Move3d, RotateCcw, ScanLine, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BoxGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type Texture,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { cn } from '@/lib/utils'
import {
  BOARD_THICKNESS_MM,
  buildShelfModel,
  type FaceModel,
  type Part3D,
  type PartKind,
  type ShelfModel,
  type ShelfModelFace,
} from '@/shelf-model'
import type { BoardContent } from '@/shelf-model/board-content'
import { boardTexture, fontsReady, readPalette, textsOf, textureKey, type Palette } from './board-texture'
import { GlCanvas } from './gl-canvas'

export interface Scene3DShelf {
  id: string
  spec: ShelfSpec
  faces: ShelfModelFace[]
  ghost: boolean
}

export interface ShelfScene3DProps {
  shelves: Scene3DShelf[]
  /** 牌面内容（编辑器）；不给时画示意牌面 */
  contents?: Record<string, BoardContent>
  selectedId?: string | null
  onPick?: (boardId: string) => void
  /** 回到立面（没有 WebGL 时的按钮也用它） */
  onExit: () => void
  /** 站架类型页里的小预览：工具条更紧凑 */
  compact?: boolean
}

/** 相邻站架间隔（毫米） */
export const SHELF_SPACING_MM = 1200
const M = 0.001

/* ---------------- 环境检测 ---------------- */

export function hasWebGL() {
  try {
    if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') return false
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 主题切换（documentElement 的 class / data 属性变化）时重读配色 */
function usePalette() {
  const [p, setP] = useState(readPalette)
  useEffect(() => {
    const el = document.documentElement
    const mo = new MutationObserver(() => setP(readPalette()))
    mo.observe(el, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => mo.disconnect()
  }, [])
  return p
}

/**
 * 点击站牌：只有没拖动（旋转、平移）时才算点击。拆成纯函数便于测试
 */
export function pickOnClick(
  e: { delta: number; stopPropagation: () => void },
  id: string,
  onPick?: (id: string) => void,
) {
  if (e.delta > 4 || !onPick) return false
  e.stopPropagation()
  onPick(id)
  return true
}

/* ---------------- 布局 ---------------- */

interface Placed {
  shelf: Scene3DShelf
  model: ShelfModel
  /** 站架中心的 x（毫米） */
  x: number
}

/** 站架按顺序沿路缘排开，间隔 SHELF_SPACING_MM；几何按（类型参数，站牌尺寸）缓存 */
function useLayout(shelves: Scene3DShelf[]) {
  const cache = useRef(new Map<string, ShelfModel>())
  return useMemo(() => {
    let cursor = 0
    const next = new Map<string, ShelfModel>()
    const placed: Placed[] = shelves.map((s) => {
      const key = JSON.stringify([s.spec, s.faces, s.ghost])
      const model = cache.current.get(key) ?? buildShelfModel(s.spec, s.faces, { ghost: s.ghost, fold: false })
      next.set(key, model)
      const x = cursor + model.footprint.width / 2
      cursor += model.footprint.width + SHELF_SPACING_MM
      return { shelf: s, model, x }
    })
    cache.current = next
    const width = Math.max(1000, cursor - SHELF_SPACING_MM)
    const depth = Math.max(800, ...placed.map((p) => p.model.footprint.depth))
    const height = Math.max(
      2600,
      ...placed.flatMap((p) => p.model.parts.map((q) => q.center[1] + (q.shape === 'box' ? q.size[1] : q.height) / 2)),
    )
    return { placed, width, depth, height, cx: width / 2 }
  }, [shelves])
}

/* ---------------- 材质 ---------------- */

function useMaterials(p: Palette) {
  const mats = useMemo(() => {
    const cs = getComputedStyle(document.documentElement)
    const accentSoft = cs.getPropertyValue('--accent-soft').trim() || '#dce7e3'
    const ink2 = cs.getPropertyValue('--ink-2').trim() || '#574c40'
    const mat = (color: string, o: Partial<MeshStandardMaterial> = {}) =>
      Object.assign(new MeshStandardMaterial({ color: new Color(color), roughness: 0.85, metalness: 0.05 }), o)
    const metal = mat(ink2, { metalness: 0.35, roughness: 0.55 })
    const parts: Record<PartKind, MeshStandardMaterial> = {
      post: metal,
      pole: metal,
      arm: metal,
      canopy: mat(p.plate, { transparent: true, opacity: 0.8, roughness: 0.95 }),
      backPanel: mat(accentSoft, {
        transparent: true,
        opacity: 0.38,
        roughness: 0.25,
        depthWrite: false,
        side: DoubleSide,
      }),
      endPanel: mat(accentSoft, {
        transparent: true,
        opacity: 0.45,
        roughness: 0.25,
        depthWrite: false,
        side: DoubleSide,
      }),
      column: mat(p.surface2, { roughness: 0.92 }),
      cap: mat(p.plate),
      base: mat(p.ink3, { roughness: 0.95 }),
      box: mat(ink2, { roughness: 0.6, metalness: 0.2 }),
      screen: mat(p.plate, { roughness: 0.3, emissive: new Color(p.plate), emissiveIntensity: 0.25 }),
      wall: mat(p.sunken, { roughness: 1 }),
    }
    const ghost = new MeshStandardMaterial({
      color: new Color(p.ink3),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      roughness: 1,
    })
    const boardSide = mat(p.sunken, { metalness: 0.4, roughness: 0.45 })
    return { parts, ghost, boardSide }
  }, [p])
  // 换主题时旧材质不再用
  useEffect(
    () => () => {
      for (const m of new Set([...Object.values(mats.parts), mats.ghost, mats.boardSide])) m.dispose()
    },
    [mats],
  )
  return mats
}

/* ---------------- 部件 ---------------- */

function PartMesh({ part, material }: { part: Part3D; material: MeshStandardMaterial }) {
  const pos = part.center
  if (part.shape === 'box')
    return (
      <mesh position={pos} rotation-y={part.rotY} material={material} castShadow receiveShadow>
        <boxGeometry args={part.size} />
      </mesh>
    )
  if (part.shape === 'cylinder')
    return (
      <mesh position={pos} material={material} castShadow receiveShadow>
        <cylinderGeometry args={[part.radius, part.radius, part.height, 24]} />
      </mesh>
    )
  // 正多棱柱：three 的圆柱第 0 个侧面法线在 π/n，转到 rotY
  return (
    <mesh position={pos} rotation-y={part.rotY - Math.PI / part.sides} material={material} castShadow receiveShadow>
      <cylinderGeometry args={[part.radius, part.radius, part.height, part.sides]} />
    </mesh>
  )
}

/* ---------------- 站牌 ---------------- */

interface BoardProps {
  face: FaceModel
  mount: FaceModel['mounts'][number]
  texture: Texture | undefined
  sides: MeshStandardMaterial
  ghost: boolean
  hovered: boolean
  selected: boolean
  onPick?: (id: string) => void
  onHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void
}

function Board({ face, mount, texture, sides, ghost, hovered, selected, onPick, onHover }: BoardProps) {
  const matrix = useMemo(() => new Matrix4().fromArray(face.toShelf), [face.toShelf])
  const geo = useMemo(() => new BoxGeometry(mount.w, mount.h, BOARD_THICKNESS_MM), [mount.w, mount.h])
  const edges = useMemo(() => new EdgesGeometry(geo), [geo])
  const front = useMemo(
    () =>
      new MeshStandardMaterial({
        map: texture ?? null,
        roughness: 0.8,
        transparent: ghost,
        opacity: ghost ? 0.55 : 1,
      }),
    [texture, ghost],
  )
  useEffect(() => () => front.dispose(), [front])
  useEffect(
    () => () => {
      geo.dispose()
      edges.dispose()
    },
    [geo, edges],
  )
  // 只有一面的站牌：背面画成金属板（BoxGeometry 的材质顺序：+x −x +y −y +z −z）
  const materials = useMemo(() => [sides, sides, sides, sides, front, sides], [sides, front])
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <group position={[mount.x + mount.w / 2, mount.y + mount.h / 2, BOARD_THICKNESS_MM / 2]}>
        <mesh
          geometry={geo}
          material={materials}
          castShadow
          receiveShadow
          onClick={(e) => pickOnClick(e, mount.boardId, onPick)}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(mount.boardId, e)
          }}
          onPointerMove={(e) => onHover(mount.boardId, e)}
          onPointerOut={() => onHover(null)}
          userData={{ boardId: mount.boardId }}
        />
        {(hovered || selected) && (
          <lineSegments geometry={edges} scale={1.01}>
            <lineBasicMaterial color={selected ? '#d97757' : '#c8902e'} />
          </lineSegments>
        )}
      </group>
    </group>
  )
}

/* ---------------- 场景 ---------------- */

type ViewName = 'reset' | 'front' | 'back' | 'top'

function viewOf(name: ViewName, l: { width: number; height: number; depth: number; cx: number }) {
  const span = Math.max(l.width, l.height * 1.6, 3000) * M
  const cx = l.cx * M
  const cy = l.height * 0.45 * M
  const d = span * 1.45 + 1.5
  const target = new Vector3(cx, cy, 0)
  switch (name) {
    case 'front':
      return { position: new Vector3(cx, cy, d), target }
    case 'back':
      return { position: new Vector3(cx, cy, -d), target }
    case 'top':
      return { position: new Vector3(cx, d * 1.1, 0.001), target: new Vector3(cx, 0, 0) }
    default:
      return { position: new Vector3(cx - span * 0.45, cy + span * 0.42, d * 0.92), target }
  }
}

function CameraRig({
  layout,
  request,
}: {
  layout: ReturnType<typeof useLayout>
  request: { name: ViewName; n: number }
}) {
  const { camera, gl, invalidate } = useThree()
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    c.enableDamping = false
    c.maxPolarAngle = Math.PI * 0.495
    c.minDistance = 0.8
    c.maxDistance = 120
    return c
  }, [camera, gl])
  const anim = useRef<null | { from: Vector3; to: Vector3; tFrom: Vector3; tTo: Vector3; t: number }>(null)
  useEffect(() => {
    const on = () => invalidate()
    controls.addEventListener('change', on)
    return () => {
      controls.removeEventListener('change', on)
      controls.dispose()
    }
  }, [controls, invalidate])
  const first = useRef(true)
  useEffect(() => {
    const v = viewOf(request.name, layout)
    if (first.current || reducedMotion()) {
      first.current = false
      camera.position.copy(v.position)
      controls.target.copy(v.target)
      controls.update()
      invalidate()
      return
    }
    anim.current = {
      from: camera.position.clone(),
      to: v.position,
      tFrom: controls.target.clone(),
      tTo: v.target,
      t: 0,
    }
    invalidate()
    // 布局变化（加站架）时不自动换视角，只响应按钮
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  useFrame((_, dt) => {
    const a = anim.current
    if (!a) return
    a.t = Math.min(1, a.t + dt / 0.6)
    const k = 1 - Math.pow(1 - a.t, 3)
    camera.position.lerpVectors(a.from, a.to, k)
    controls.target.lerpVectors(a.tFrom, a.tTo, k)
    controls.update()
    if (a.t >= 1) anim.current = null
    invalidate()
  })
  return null
}

function Ground({ layout, p }: { layout: ReturnType<typeof useLayout>; p: Palette }) {
  const x0 = -1.5
  const x1 = layout.width * M + 1.5
  const w = x1 - x0
  const cx = (x0 + x1) / 2
  const curb = -(layout.depth * M) / 2 - 0.6
  const platform = 3.2
  const road = 3.6
  const cs = getComputedStyle(document.documentElement)
  const roadColor = cs.getPropertyValue('--map-casing').trim() || '#d8cdbb'
  return (
    <group>
      {/* 站台地面（纸色） */}
      <mesh position={[cx, -0.075, curb + platform / 2]} receiveShadow>
        <boxGeometry args={[w, 0.15, platform]} />
        <meshStandardMaterial color={p.surface2} roughness={1} />
      </mesh>
      {/* 路缘石 */}
      <mesh position={[cx, -0.06, curb - 0.08]} receiveShadow>
        <boxGeometry args={[w, 0.18, 0.16]} />
        <meshStandardMaterial color={p.sunken} roughness={0.9} />
      </mesh>
      {/* 车行道与车道线：朝向一眼可辨 */}
      <mesh position={[cx, -0.16, curb - 0.16 - road / 2]} receiveShadow>
        <boxGeometry args={[w, 0.02, road]} />
        <meshStandardMaterial color={roadColor} roughness={1} />
      </mesh>
      {Array.from({ length: Math.ceil(w / 3) }, (_, i) => (
        <mesh key={i} position={[x0 + 0.75 + i * 3, -0.145, curb - 0.16 - road + 0.12]}>
          <boxGeometry args={[1.5, 0.005, 0.12]} />
          <meshStandardMaterial color={p.surface} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

function placeholder(id: string, face: FaceModel, m: FaceModel['mounts'][number]): BoardContent {
  return {
    id,
    title: '示意',
    faceLabel: face.label,
    kindLabel: '整版',
    count: 0,
    whole: true,
    rows: [],
    slots: [],
    width: m.w,
    height: m.h,
    tip: `示意站牌 · ${face.label}`,
  }
}

/** 牌面贴图：内容或配色变了才重画；字体就绪后再画一次 */
function useTextures(
  layout: ReturnType<typeof useLayout>,
  contents: Record<string, BoardContent> | undefined,
  p: Palette,
) {
  const [fontsTick, setFontsTick] = useState(0)
  const list = useMemo(
    () =>
      layout.placed.flatMap((pl) =>
        pl.model.faces.flatMap((f) =>
          f.mounts.map((m) => contents?.[m.boardId] ?? placeholder(`${pl.shelf.id}:${m.boardId}`, f, m)),
        ),
      ),
    [layout, contents],
  )
  const allText = useMemo(() => list.flatMap(textsOf), [list])
  useEffect(() => {
    let alive = true
    void fontsReady(allText).then(() => alive && setFontsTick((n) => n + 1))
    return () => {
      alive = false
    }
  }, [allText])
  const cache = useRef(new Map<string, Texture>())
  return useMemo(() => {
    const next = new Map<string, Texture>()
    const byId = new Map<string, Texture>()
    for (const c of list) {
      const key = `${fontsTick}|${textureKey(c, p)}`
      const t = cache.current.get(key) ?? boardTexture(c, p)
      next.set(key, t)
      byId.set(c.id, t)
    }
    for (const [k, t] of cache.current) if (!next.has(k)) t.dispose()
    cache.current = next
    return byId
  }, [list, p, fontsTick])
}

function Scene({
  layout,
  props,
  request,
  hover,
  setHover,
}: {
  layout: ReturnType<typeof useLayout>
  props: ShelfScene3DProps
  request: { name: ViewName; n: number }
  hover: string | null
  setHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void
}) {
  const p = usePalette()
  const mats = useMaterials(p)
  const textures = useTextures(layout, props.contents, p)
  const { scene, invalidate } = useThree()
  useEffect(() => {
    scene.background = new Color(
      getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || p.surface,
    )
    invalidate()
  }, [p, scene, invalidate])
  const span = Math.max(layout.width, 4000) * M
  return (
    <>
      <hemisphereLight args={['#fff1dc', '#b9a58a', 1.15]} />
      <directionalLight
        position={[layout.cx * M - span * 0.6, span * 0.9 + 4, span * 0.7 + 3]}
        intensity={1.6}
        color="#fff4e2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={5}
        shadow-bias={-0.0004}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-far={span * 4 + 20}
      >
        <object3D attach="target" position={[layout.cx * M, 0, 0]} />
      </directionalLight>
      <Ground layout={layout} p={p} />
      {layout.placed.map((pl) => (
        <group key={pl.shelf.id} position={[pl.x * M, 0, 0]} scale={M}>
          {pl.model.parts.map((part, i) => (
            <PartMesh key={i} part={part} material={pl.shelf.ghost ? mats.ghost : mats.parts[part.part]} />
          ))}
          {pl.model.faces.flatMap((f) =>
            f.mounts.map((m) => {
              const id = props.contents?.[m.boardId] ? m.boardId : `${pl.shelf.id}:${m.boardId}`
              return (
                <Board
                  key={`${f.face}:${m.boardId}`}
                  face={f}
                  mount={m}
                  texture={textures.get(id)}
                  sides={mats.boardSide}
                  ghost={pl.shelf.ghost}
                  hovered={hover === m.boardId}
                  selected={props.selectedId === m.boardId}
                  onPick={props.onPick}
                  onHover={setHover}
                />
              )
            }),
          )}
        </group>
      ))}
      <CameraRig layout={layout} request={request} />
    </>
  )
}

function NoWebGL({ onExit }: { onExit: () => void }) {
  return (
    <div
      className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center text-[13px] text-ink-3"
      role="alert"
    >
      <svg viewBox="0 0 64 48" className="h-12 w-16" aria-hidden>
        <path d="M8 38 32 26l24 12-24 8z" fill="var(--sunken)" stroke="var(--hairline-2)" />
        <path d="M32 6v20M24 12h16" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" />
        <rect
          x="22"
          y="10"
          width="20"
          height="14"
          rx="2"
          fill="var(--surface)"
          stroke="var(--ink-4)"
          strokeDasharray="3 2"
        />
      </svg>
      当前浏览器无法显示 3D
      <button
        type="button"
        onClick={onExit}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-ink hover:bg-accent-hover"
      >
        <Undo2 size={13} /> 回到立面
      </button>
    </div>
  )
}

const VIEWS: { name: ViewName; label: string; icon: typeof Eye }[] = [
  { name: 'reset', label: '重置视角', icon: RotateCcw },
  { name: 'front', label: '正面', icon: Eye },
  { name: 'back', label: '背面', icon: Move3d },
  { name: 'top', label: '俯视', icon: ScanLine },
]

export default function ShelfScene3D(props: ShelfScene3DProps) {
  const [ok] = useState(hasWebGL)
  /** WebGL 初始化失败（上下文创建失败等）时退回提示 */
  const [failed, setFailed] = useState(false)
  const layout = useLayout(props.shelves)
  const [request, setRequest] = useState<{ name: ViewName; n: number }>({ name: 'reset', n: 0 })
  const [hover, setHoverState] = useState<{ id: string; x: number; y: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const setHover = (id: string | null, e?: ThreeEvent<PointerEvent>) => {
    if (!id) return setHoverState(null)
    const r = box.current?.getBoundingClientRect()
    const x = e && r ? e.nativeEvent.clientX - r.left : (hover?.x ?? 0)
    const y = e && r ? e.nativeEvent.clientY - r.top : (hover?.y ?? 0)
    setHoverState({ id, x, y })
  }
  if (!ok) return <NoWebGL onExit={props.onExit} />
  const tip = hover && (props.contents?.[hover.id]?.tip ?? '示意站牌')
  return (
    <div
      ref={box}
      className={cn('relative h-full w-full', hover && props.onPick && 'cursor-pointer')}
      data-testid="scene-3d"
    >
      {failed ? (
        <NoWebGL onExit={props.onExit} />
      ) : (
        <GlCanvas
          frameloop="demand"
          shadows="percentage"
          dpr={[1, 2]}
          camera={{ fov: 38, near: 0.05, far: 400, position: [0, 3, 10] }}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          onPointerMissed={() => setHoverState(null)}
          onError={() => setFailed(true)}
          aria-label="站架 3D 预览"
        >
          <Scene layout={layout} props={props} request={request} hover={hover?.id ?? null} setHover={setHover} />
        </GlCanvas>
      )}
      <div
        className={cn(
          'absolute flex items-center gap-0.5 rounded-xl bg-surface/90 p-1 shadow-xs ring-1 ring-hairline backdrop-blur-sm',
          // 编辑器里属性卡浮在右上角：视角条放左上，不被它盖住
          props.compact ? 'right-2 top-2' : 'left-3 top-3',
        )}
        role="toolbar"
        aria-label="视角"
      >
        {VIEWS.map((v) => (
          <button
            key={v.name}
            type="button"
            title={v.label}
            aria-label={v.label}
            onClick={() => setRequest((r) => ({ name: v.name, n: r.n + 1 }))}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
          >
            <v.icon size={13} />
            {!props.compact && v.label}
          </button>
        ))}
        {!props.compact && (
          <button
            type="button"
            onClick={props.onExit}
            className="ml-1 inline-flex h-7 items-center gap-1 rounded-lg bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:bg-accent-hover"
          >
            <Undo2 size={13} /> 回到立面
          </button>
        )}
      </div>
      {!props.compact && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-surface/80 px-3 py-1 text-[11.5px] text-ink-3 ring-1 ring-hairline">
          <Box size={12} /> 左键旋转 · 右键平移 · 滚轮缩放{props.onPick ? ' · 点站牌编辑属性' : ''}
        </div>
      )}
      {hover && tip && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11.5px] text-paper shadow-pop"
          style={{ left: hover.x + 14, top: hover.y + 12 }}
          role="tooltip"
        >
          {tip}
        </div>
      )}
    </div>
  )
}
