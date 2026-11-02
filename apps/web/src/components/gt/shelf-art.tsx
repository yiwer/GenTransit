// 站架结构的 2D 画法（M7 计划 5.2 节）：把 buildShelfModel 算出的一个面的图元画成 SVG。
// 立面（结构层在站牌 DOM 下面）、站架类型卡片的剪影、属性卡下拉里的小剪影共用。
// 笔触与配色见 docs/design-language.md「立面结构」：立柱墨色金属、顶棚墨绿、背板磨砂玻璃、墙面浅砖纹
import {
  SHELF_PARAM_DEFAULTS,
  parseShelfSpec,
  shelfFaces,
  type ShelfSpec,
  type ShelfTypeItem,
  type TemplateBoard,
} from '@gentransit/shared'
import { useId } from 'react'
import { cn } from '@/lib/utils'
import { buildShelfModel, type FaceModel, type PartKind, type Prim2D } from '@/shelf-model'

/** 找不到站架类型时（刚删除、还没读到）按默认双立柱画 */
export const FALLBACK_SPEC: ShelfSpec = { form: 'doublePost', params: SHELF_PARAM_DEFAULTS.doublePost }

export function specOfType(types: Pick<ShelfTypeItem, 'id' | 'form' | 'params'>[] | undefined, typeId: string) {
  const t = types?.find((x) => x.id === typeId)
  return t ? parseShelfSpec(t.form, t.params) : FALLBACK_SPEC
}

type Rect = Extract<Prim2D, { kind: 'rect' }>

const FILL: Partial<Record<PartKind, string>> = {
  canopy: 'url(#canopy)',
  cap: 'var(--plate)',
  backPanel: 'color-mix(in oklab, var(--accent-soft) 55%, transparent)',
  endPanel: 'color-mix(in oklab, var(--accent-soft) 70%, transparent)',
  column: 'url(#column)',
  base: 'color-mix(in oklab, var(--ink-3) 55%, var(--sunken))',
  box: 'url(#box)',
  screen: 'url(#screen)',
  wall: 'url(#wall)',
}
const METAL: PartKind[] = ['post', 'pole', 'arm']

/** 一个面的结构层：viewBox 用毫米，y 向下翻转；线宽不随比例变化 */
export function ShelfFaceArt({
  face,
  ghost = false,
  className,
  style,
  width,
  height,
}: {
  face: Pick<FaceModel, 'width' | 'height' | 'view'>
  ghost?: boolean
  className?: string
  style?: React.CSSProperties
  /** 嵌在另一个 svg 里时的尺寸（父级的用户单位） */
  width?: number
  height?: number
}) {
  const uid = useId().replace(/:/g, '')
  const id = (k: string) => `${uid}-${k}`
  const H = face.height
  const y = (r: { y: number; h?: number }) => H - r.y - (r.h ?? 0)
  const fill = (p: PartKind) => {
    const f = METAL.includes(p) ? 'url(#metal)' : FILL[p]
    return f?.replace(/url\(#(\w+)\)/, (_, k: string) => `url(#${id(k)})`)
  }
  return (
    <svg
      viewBox={`0 0 ${face.width} ${H}`}
      preserveAspectRatio="none"
      width={width}
      height={height}
      className={cn('pointer-events-none overflow-visible', className)}
      style={style}
      aria-hidden
    >
      <defs>
        <linearGradient id={id('metal')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--ink-2)" />
          <stop offset="0.42" stopColor="var(--ink-4)" />
          <stop offset="1" stopColor="var(--ink-2)" />
        </linearGradient>
        <linearGradient id={id('canopy')} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--plate)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--plate) 70%, black)" />
        </linearGradient>
        <linearGradient id={id('column')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--sunken)" />
          <stop offset="0.5" stopColor="var(--surface)" />
          <stop offset="1" stopColor="var(--sunken)" />
        </linearGradient>
        <linearGradient id={id('box')} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="color-mix(in oklab, var(--ink-2) 85%, var(--paper))" />
          <stop offset="0.5" stopColor="color-mix(in oklab, var(--ink-3) 80%, var(--paper))" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--ink-2) 85%, var(--paper))" />
        </linearGradient>
        <linearGradient id={id('screen')} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="color-mix(in oklab, var(--plate) 82%, black)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--plate) 60%, black)" />
        </linearGradient>
        <pattern id={id('wall')} width="240" height="120" patternUnits="userSpaceOnUse">
          <rect width="240" height="120" fill="var(--surface-2)" />
          <path
            d="M0 0H240M0 60H240M60 0V60M180 60V120"
            stroke="var(--hairline-2)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        </pattern>
      </defs>
      {face.view.map((p, i) => {
        if (p.kind === 'ground')
          return (
            <line
              key={i}
              x1={p.x}
              x2={p.x + p.w}
              y1={H}
              y2={H}
              stroke="var(--ink-3)"
              strokeOpacity={0.45}
              strokeWidth={3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              data-part="ground"
            />
          )
        if (p.kind === 'break') {
          const top = H - p.y - 35
          const x0 = p.x - 30
          const x1 = p.x + p.w + 30
          const zig = (yy: number) =>
            `M${x0} ${yy}L${p.x + p.w * 0.38} ${yy}L${p.x + p.w * 0.5} ${yy - 28}L${p.x + p.w * 0.62} ${yy + 28}L${p.x + p.w * 0.74} ${yy}L${x1} ${yy}`
          return (
            <g key={i} data-part="break">
              <rect x={x0} y={top} width={x1 - x0} height={70} fill="var(--surface)" />
              {[top, top + 70].map((yy) => (
                <path
                  key={yy}
                  d={zig(yy)}
                  fill="none"
                  stroke="var(--ink-3)"
                  strokeWidth={1.2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )
        }
        return <Part key={i} p={p} y={y(p)} fill={fill(p.part)} ghost={ghost} />
      })}
    </svg>
  )
}

function Part({ p, y, fill, ghost }: { p: Rect; y: number; fill: string | undefined; ghost: boolean }) {
  const glass = p.part === 'backPanel' || p.part === 'endPanel'
  const rx = p.round ? Math.min(p.w / 2, 30) : p.part === 'canopy' ? 40 : p.part === 'cap' ? 20 : glass ? 24 : 6
  return (
    <rect
      x={p.x}
      y={y}
      width={p.w}
      height={p.h}
      rx={rx}
      fill={ghost ? 'none' : fill}
      stroke={ghost ? 'var(--ink-4)' : glass || p.part === 'column' || p.part === 'wall' ? 'var(--hairline-2)' : 'none'}
      strokeWidth={ghost ? 1.5 : 1}
      strokeDasharray={ghost ? '5 4' : undefined}
      vectorEffect="non-scaling-stroke"
      data-part={p.part}
    />
  )
}

/* ---------------- 剪影与示意 ---------------- */

/** 示意站牌：每面取 boards（第一个站架模板的结构），没有时每面一块 1200 × 1800 */
export function sampleFaces(spec: ShelfSpec, boards?: Pick<TemplateBoard, 'face' | 'width' | 'height'>[]) {
  const own = shelfFaces(spec)
  const sample = boards?.filter((b) => own.includes(b.face))
  return sample?.length
    ? own.map((face) => ({
        face,
        boards: sample.filter((b) => b.face === face).map((b, i) => ({ id: `${face}${i}`, ...b })),
      }))
    : own.map((face) => ({ face, boards: [{ id: face, width: 1200, height: 1800 }] }))
}

/** 一个面的示意：结构 + 墨绿牌头的小牌子（放在父级 svg 里，坐标为毫米） */
export function FaceSketch({ face, ghost }: { face: FaceModel; ghost?: boolean }) {
  return (
    <>
      <ShelfFaceArt face={face} ghost={ghost} width={face.width} height={face.height} />
      {face.mounts.map((m) => {
        const top = face.height - m.y - m.h
        return (
          <g key={m.boardId} data-part="board">
            <rect
              x={m.x}
              y={top}
              width={m.w}
              height={m.h}
              rx={60}
              fill="var(--surface)"
              stroke="var(--hairline-2)"
              strokeWidth={1}
              strokeDasharray={ghost ? '5 4' : undefined}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={m.x + 50}
              y={top + 50}
              width={Math.max(0, m.w - 100)}
              height={Math.min(260, m.h / 5)}
              rx={30}
              fill="var(--plate)"
            />
            {[0.42, 0.58, 0.74].map((k) => (
              <rect
                key={k}
                x={m.x + 110}
                y={top + m.h * k}
                width={Math.max(0, (m.w - 220) * (k === 0.74 ? 0.6 : 1))}
                height={50}
                rx={25}
                fill="var(--plate)"
                opacity={0.28}
              />
            ))}
          </g>
        )
      })}
    </>
  )
}

/** 站架类型的剪影：正面或 A 面，用示意站牌 */
export function ShelfSilhouette({
  spec,
  boards,
  className,
  ghost,
}: {
  spec: ShelfSpec
  boards?: Pick<TemplateBoard, 'face' | 'width' | 'height'>[]
  className?: string
  ghost?: boolean
}) {
  const f = buildShelfModel(spec, sampleFaces(spec, boards), { fold: false }).faces[0]
  return (
    <svg
      viewBox={`0 0 ${f.width} ${f.height}`}
      className={cn('overflow-visible', className)}
      aria-hidden
      data-testid="shelf-silhouette"
      data-form={spec.form}
    >
      <FaceSketch face={f} ghost={ghost} />
    </svg>
  )
}

/** 参考线（M7 计划 1.3 节，DB11/T 650-2009）：只画线，不做校验 */
export const REFERENCE_LINES = [
  { y: 400, label: '0.4 m 最下一块站牌底边' },
  { y: 2200, label: '2.2 m 最上一块站牌顶边' },
  { y: 2500, label: '2.5 m 顶棚下沿' },
] as const

/** 站架类型的 2D 预览：全部面按实际尺寸并排（不压缩），画参考线与面名 */
export function ShelfPreview2D({
  spec,
  boards,
  className,
}: {
  spec: ShelfSpec
  boards?: Pick<TemplateBoard, 'face' | 'width' | 'height'>[]
  className?: string
}) {
  const m = buildShelfModel(spec, sampleFaces(spec, boards), { fold: false })
  const gap = 500
  const top = Math.max(2800, ...m.faces.map((f) => f.height)) + 200
  const W = m.faces.reduce((n, f) => n + f.width, 0) + gap * (m.faces.length - 1)
  const labelW = 2600
  let x = 0
  return (
    <svg
      viewBox={`${-labelW} 0 ${W + labelW + 200} ${top + 420}`}
      className={cn('h-full w-full', className)}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={`${m.faces.map((f) => f.label).join('、')}立面预览`}
      data-testid="shelf-preview-2d"
    >
      {REFERENCE_LINES.map((r) => (
        <g key={r.y} data-testid="reference-line">
          <line
            x1={-labelW + 100}
            x2={W + 200}
            y1={top - r.y}
            y2={top - r.y}
            stroke="var(--coral)"
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray="6 5"
            vectorEffect="non-scaling-stroke"
          />
          <text x={-labelW + 100} y={top - r.y - 50} fontSize={150} fill="var(--ink-3)">
            {r.label}
          </text>
        </g>
      ))}
      {m.faces.map((f) => {
        const at = x
        x += f.width + gap
        return (
          <g key={f.face} transform={`translate(${at} ${top - f.height})`}>
            <FaceSketch face={f} />
            <text
              x={f.width / 2}
              y={f.height + 260}
              fontSize={170}
              textAnchor="middle"
              fontWeight={600}
              fill={f.face === 'other' ? 'var(--danger)' : 'var(--ink-3)'}
              letterSpacing={20}
            >
              {f.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
