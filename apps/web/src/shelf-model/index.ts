// 站架模型（M7 计划第 4 节）：按站架类型与站牌算出各面的 2D 图元、挂牌位置与 3D 部件。纯函数，不依赖 React。
// 结构只在站架坐标里定义一次（parts），每个面的立面是这些部件朝这个面的正投影，2D 与 3D 同源。
// 坐标：毫米；x 沿路缘、从站台看从左到右；y 向上；z 指向站台（车行道在 −z）。
// 计划写的是"z 指向车行道"，与"x 从站台看从左到右"合在一起是左手系；这里取右手系，与 three.js 一致
import {
  SHELF_FORM_LABEL,
  shelfFaceLabel,
  shelfFaces,
  type BoardFace,
  type ShelfForm,
  type ShelfSpec,
} from '@gentransit/shared'

export type V3 = [number, number, number]

/** 结构部件的种类：立面与 3D 按它选画法与材质（data-part） */
export type PartKind =
  'post' | 'arm' | 'canopy' | 'backPanel' | 'endPanel' | 'column' | 'cap' | 'base' | 'box' | 'screen' | 'wall' | 'pole'

/** 3D 部件（站架坐标，毫米）。rotY：绕 y 轴，从 +z 转向 +x 为正；prism 的第 0 个侧面法线朝 rotY 方向 */
export type Part3D =
  | { shape: 'box'; part: PartKind; center: V3; size: V3; rotY: number }
  | { shape: 'cylinder'; part: PartKind; center: V3; radius: number; height: number }
  | { shape: 'prism'; part: PartKind; center: V3; sides: number; radius: number; height: number; rotY: number }

/** 2D 图元（面内坐标，毫米，y 向上，y 是下沿） */
export type Prim2D =
  | { kind: 'rect'; part: PartKind; x: number; y: number; w: number; h: number; round: boolean; depth: number }
  | { kind: 'ground'; x: number; w: number }
  /** 折断号：画在被压缩或截断的部件上 */
  | { kind: 'break'; x: number; y: number; w: number }

export interface Mount {
  boardId: string
  x: number
  y: number
  w: number
  h: number
}

/** 4×4 矩阵（列主序，可直接给 three.js Matrix4.fromArray）：面内（x 向右，y 向上，z 朝看这一面的人）→ 站架坐标 */
export type Matrix4Like = number[]

export interface FaceModel {
  face: BoardFace | 'other'
  label: string
  width: number
  height: number
  view: Prim2D[]
  mounts: Mount[]
  toShelf: Matrix4Like
}

export interface ShelfModel {
  form: ShelfForm
  ghost: boolean
  faces: FaceModel[]
  parts: Part3D[]
  /** 站架在路缘方向（x）与进深方向（z）上占的尺寸；站架坐标以占地中心为原点 */
  footprint: { width: number; depth: number }
  /** 牌面下方压缩掉的高度（折断号），0 表示按实际尺寸 */
  fold: number
  /** 立面里站牌下沿的高度（mountBottom − fold） */
  bottom: number
  warnings: string[]
}

export interface ShelfModelBoard {
  id: string
  width: number
  height: number
}

export interface ShelfModelFace {
  face: BoardFace
  boards: ShelfModelBoard[]
}

/** 同一个面上站牌之间的间距 */
export const BOARD_GAP_MM = 120
/** 站牌板厚 */
export const BOARD_THICKNESS_MM = 40
/** 面上没有站牌时按这个宽度画结构 */
const EMPTY_GROUP_MM = 1200
/** 立面两侧留白 */
const SIDE_PAD = 150
/** 牌面下方的柱身超过这个高度时画折断号，压缩到它（4.2 节） */
const FOLD_MAX = 1000
/** 立柱、杆、墙高出牌组顶超过这么多时截断 */
const TOP_ROOM = 800

/* ---------------- 向量与面坐标系 ---------------- */

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const dir = (angle: number): V3 => [Math.sin(angle), 0, Math.cos(angle)]
const round = (n: number) => Math.round(n * 1000) / 1000

/** 面坐标系：o 为面内原点（站牌组左下、挂牌面上），r 为向右，n 为朝看这一面的人 */
interface Frame {
  o: V3
  r: V3
  n: V3
}

/** angle：法线方向（从 +z 转向 +x）；dist：挂牌面离站架中心多远；left：站牌组左端离中线多远 */
function frameAt(angle: number, dist: number, left: number, x = 0): Frame {
  const n = dir(angle)
  const r: V3 = [Math.cos(angle), 0, -Math.sin(angle)]
  return { o: add(add([x, 0, 0], n, dist), r, -left), r, n }
}

const toMatrix = (f: Frame): Matrix4Like =>
  [f.r[0], f.r[1], f.r[2], 0, 0, 1, 0, 0, f.n[0], f.n[1], f.n[2], 0, f.o[0], f.o[1], f.o[2], 1].map(round)

/** 部件在 xz 平面上的轮廓点 */
function outline(p: Part3D): V3[] {
  if (p.shape === 'cylinder') {
    return Array.from({ length: 16 }, (_, i) => add(p.center, dir((i / 16) * Math.PI * 2), p.radius))
  }
  if (p.shape === 'prism') {
    return Array.from({ length: p.sides }, (_, i) =>
      add(p.center, dir(p.rotY + Math.PI / p.sides + (i * 2 * Math.PI) / p.sides), p.radius),
    )
  }
  const [w, , d] = p.size
  const ax = dir(p.rotY + Math.PI / 2)
  const az = dir(p.rotY)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => add(add(p.center, ax, (i * w) / 2), az, (j * d) / 2))
}

const heightOf = (p: Part3D) => (p.shape === 'box' ? p.size[1] : p.height)

/** 部件朝某个面的正投影：面内 x 范围、离挂牌面的远近（负数在挂牌面后面） */
function project(p: Part3D, f: Frame) {
  const pts = outline(p).map((q) => add(q, f.o, -1))
  const us = pts.map((q) => dot(q, f.r))
  const ds = pts.map((q) => dot(q, f.n))
  const h = heightOf(p)
  return {
    x: Math.min(...us),
    w: Math.max(...us) - Math.min(...us),
    y: p.center[1] - h / 2,
    h,
    near: Math.min(...ds),
    far: Math.max(...ds),
    mid: (Math.min(...ds) + Math.max(...ds)) / 2,
  }
}

/* ---------------- 各形式的结构 ---------------- */

interface Built {
  parts: Part3D[]
  frames: Partial<Record<BoardFace, Frame>>
  warnings: string[]
}

interface Ctx {
  /** 各面站牌组宽度（没有站牌的面不在其中） */
  groups: Partial<Record<BoardFace, number>>
  /** 各面的最高站牌 */
  tallest: number
  faces: BoardFace[]
}

const box = (part: PartKind, center: V3, size: V3, rotY = 0): Part3D => ({ shape: 'box', part, center, size, rotY })
const cyl = (part: PartKind, x: number, z: number, y0: number, y1: number, radius: number): Part3D => ({
  shape: 'cylinder',
  part,
  center: [x, (y0 + y1) / 2, z],
  radius,
  height: y1 - y0,
})

/** 平行路缘的正面、背面：正面朝站台（+z），背面朝车行道 */
function frontBack(ctx: Ctx, dist: number, x = 0): Partial<Record<BoardFace, Frame>> {
  const w = (f: BoardFace) => (ctx.groups[f] ?? 0) / 2
  return { front: frameAt(0, dist, w('front'), x), back: frameAt(Math.PI, dist, w('back'), x) }
}

/** 所有面里最宽的站牌组；都没有站牌时取 fallback */
const widest = (ctx: Ctx, fallback = EMPTY_GROUP_MM) => Math.max(0, ...Object.values(ctx.groups)) || fallback

function singlePost(spec: Extract<ShelfSpec, { form: 'singlePost' }>, ctx: Ctx): Built {
  const p = spec.params
  const r = p.postDiameter / 2
  const parts = [cyl('post', 0, 0, 0, p.postHeight, r)]
  if (p.mount === 'center') return { parts, frames: frontBack(ctx, r + 5), warnings: [] }
  // 旗式：牌组伸出在柱子右侧，上下两根横臂；双面时两面背靠背
  const W = widest(ctx)
  const gap = 60
  const cx = r + gap + W / 2
  const top = p.mountBottom + ctx.tallest
  const arm = (y: number) => box('arm', [(r + gap + W) / 2, y, 0], [r + gap + W, 50, 40])
  parts.push(arm(top - 120), arm(p.mountBottom + 120))
  return { parts, frames: frontBack(ctx, 10, cx), warnings: [] }
}

function doublePost(spec: Extract<ShelfSpec, { form: 'doublePost' }>, ctx: Ctx): Built {
  const p = spec.params
  const W = widest(ctx)
  const r = p.postDiameter / 2
  const x = W / 2 - p.postInset
  return {
    parts: [cyl('post', -x, 0, 0, p.postHeight, r), cyl('post', x, 0, 0, p.postHeight, r)],
    frames: frontBack(ctx, r + 5),
    warnings: [],
  }
}

function shelter(spec: Extract<ShelfSpec, { form: 'shelter' }>, ctx: Ctx): Built {
  const p = spec.params
  const warnings: string[] = []
  const W = widest(ctx)
  const top = p.mountBottom + ctx.tallest
  if (Object.keys(ctx.groups).length && top > p.canopyBottom - 50)
    warnings.push(`站牌顶边离地 ${top} mm，高于顶棚下沿 ${p.canopyBottom} mm`)
  const panelZ = p.depth / 2 - 80
  const postR = 50
  const parts: Part3D[] = []
  let length = p.length
  let frames: Partial<Record<BoardFace, Frame>>
  if (p.mount === 'back') {
    if (length < W + 600) {
      warnings.push(`牌组宽 ${W} mm，超出候车亭长度 ${p.length} mm，按 ${W + 600} mm 画`)
      length = W + 600
    }
    // 背板在靠站台一侧，亭内（正面）朝车行道
    const w = (f: BoardFace) => (ctx.groups[f] ?? 0) / 2
    frames = { front: frameAt(Math.PI, -panelZ + 15, w('front')), back: frameAt(0, panelZ + 15, w('back')) }
  } else {
    // 端板在左端，垂直路缘；亭内朝 +x
    const endW = Math.max(p.depth - 200, W + 200)
    const endX = -length / 2 + 60
    const w = (f: BoardFace) => (ctx.groups[f] ?? 0) / 2
    frames = {
      front: frameAt(Math.PI / 2, 15, w('front'), 0),
      back: frameAt(-Math.PI / 2, 15, w('back'), 0),
    }
    for (const k of ['front', 'back'] as const) {
      const f = frames[k]!
      f.o = add(f.o, [endX, 0, 0])
    }
    parts.push(box('endPanel', [endX, (p.canopyBottom - 100) / 2 + 100, 0], [30, p.canopyBottom - 200, endW]))
  }
  parts.push(box('canopy', [0, p.canopyBottom + p.canopyThickness / 2, 0], [length + 200, p.canopyThickness, p.depth]))
  if (p.backPanel)
    parts.push(
      box('backPanel', [0, (p.canopyBottom - 150) / 2 + 150, panelZ], [length - 100, p.canopyBottom - 250, 20]),
    )
  for (let i = 0; i < p.posts; i++) {
    const x = -length / 2 + 100 + ((length - 200) * i) / (p.posts - 1)
    parts.push(cyl('post', x, panelZ - 70, 0, p.canopyBottom, postR))
  }
  return { parts, frames, warnings }
}

function totem(spec: Extract<ShelfSpec, { form: 'totem' }>, ctx: Ctx): Built {
  const p = spec.params
  const n = p.faces
  const side = widest(ctx, 600) + 2 * p.margin
  const radius = side / (2 * Math.sin(Math.PI / n))
  const apothem = side / (2 * Math.tan(Math.PI / n))
  const frames: Partial<Record<BoardFace, Frame>> = {}
  ctx.faces.forEach((f, i) => (frames[f] = frameAt((i * 2 * Math.PI) / n, apothem + 2, (ctx.groups[f] ?? 0) / 2)))
  const colTop = Math.max(p.height, p.mountBottom + ctx.tallest + 100)
  const warnings = colTop > p.height ? [`站牌高出柱顶，柱身按 ${colTop} mm 画`] : ([] as string[])
  const prism = (part: PartKind, y0: number, y1: number, r: number): Part3D => ({
    shape: 'prism',
    part,
    center: [0, (y0 + y1) / 2, 0],
    sides: n,
    radius: r,
    height: y1 - y0,
    rotY: 0,
  })
  const parts = [prism('column', p.baseHeight, colTop - 60, radius), prism('cap', colTop - 60, colTop, radius + 25)]
  if (p.baseHeight > 0) parts.unshift(prism('base', 0, p.baseHeight, radius + 70))
  return { parts, frames, warnings }
}

function attached(spec: Extract<ShelfSpec, { form: 'attached' }>, ctx: Ctx): Built {
  const p = spec.params
  const W = widest(ctx)
  if (p.host === 'wall') {
    const top = p.mountBottom + ctx.tallest
    const h = Math.max(3000, top + 600)
    // 墙面在牌后，比牌组宽 400
    return {
      parts: [box('wall', [0, h / 2, -120 - p.standoff], [W + 400, h, 240])],
      frames: { front: frameAt(0, 0, (ctx.groups.front ?? 0) / 2) },
      warnings: [],
    }
  }
  const r = p.poleDiameter / 2
  return { parts: [cyl('pole', 0, 0, 0, p.poleHeight, r)], frames: frontBack(ctx, r + p.standoff), warnings: [] }
}

function ePost(spec: Extract<ShelfSpec, { form: 'ePost' }>, ctx: Ctx): Built {
  const p = spec.params
  const W = widest(ctx)
  const warnings: string[] = []
  const groupTop = p.mountBottom + ctx.tallest
  const screenY = groupTop + 100
  const need = (p.screenHeight ? screenY + p.screenHeight : groupTop) + 100
  const top = Math.max(p.height, need)
  if (top > p.height) warnings.push(`箱体放不下牌组${p.screenHeight ? '和屏幕' : ''}，按 ${top} mm 高画`)
  const boxW = W + 120
  const parts: Part3D[] = [box('box', [0, (p.baseHeight + top) / 2, 0], [boxW, top - p.baseHeight, p.boxDepth])]
  if (p.baseHeight > 0)
    parts.unshift(box('base', [0, p.baseHeight / 2, 0], [boxW + 120, p.baseHeight, p.boxDepth + 120]))
  const faces = shelfFaces(spec)
  for (const f of faces) {
    const s = f === 'front' ? 1 : -1
    if (p.screenHeight)
      parts.push(box('screen', [0, screenY + p.screenHeight / 2, (s * p.boxDepth) / 2 + 3], [W, p.screenHeight, 6]))
  }
  return { parts, frames: frontBack(ctx, p.boxDepth / 2 + 2), warnings }
}

function structure(spec: ShelfSpec, ctx: Ctx): Built {
  switch (spec.form) {
    case 'singlePost':
      return singlePost(spec, ctx)
    case 'doublePost':
      return doublePost(spec, ctx)
    case 'shelter':
      return shelter(spec, ctx)
    case 'totem':
      return totem(spec, ctx)
    case 'attached':
      return attached(spec, ctx)
    case 'ePost':
      return ePost(spec, ctx)
  }
}

/* ---------------- 朝向 ---------------- */

const rotV = (v: V3, a: number): V3 => [
  v[0] * Math.cos(a) + v[2] * Math.sin(a),
  v[1],
  -v[0] * Math.sin(a) + v[2] * Math.cos(a),
]

/** 垂直路缘：整体转 −90°，正面从朝站台（+z）转为朝来车方向（−x；右侧通行，来车从站台看的左边驶来） */
function rotate(b: Built, a: number): Built {
  const part = (p: Part3D): Part3D =>
    p.shape === 'cylinder' ? { ...p, center: rotV(p.center, a) } : { ...p, center: rotV(p.center, a), rotY: p.rotY + a }
  const frames: Partial<Record<BoardFace, Frame>> = {}
  for (const [k, f] of Object.entries(b.frames))
    frames[k as BoardFace] = { o: rotV(f.o, a), r: rotV(f.r, a), n: rotV(f.n, a) }
  return { parts: b.parts.map(part), frames, warnings: b.warnings }
}

/* ---------------- 立面 ---------------- */

/** 面内站牌从左到右排开，下沿对齐 */
function layout(boards: ShelfModelBoard[], bottom: number): Mount[] {
  let x = 0
  return boards.map((b) => {
    const m = { boardId: b.id, x, y: bottom, w: b.width, h: b.height }
    x += b.width + BOARD_GAP_MM
    return m
  })
}

const groupWidth = (boards: ShelfModelBoard[]) =>
  boards.reduce((n, b) => n + b.width, 0) + BOARD_GAP_MM * Math.max(0, boards.length - 1)

const CUTTABLE: PartKind[] = ['post', 'pole', 'column', 'wall', 'box']

/**
 * 一个面的立面：可见部件（挂牌面后面的，加上跨过挂牌面的）按远近排序，牌面下方过长时压缩并画折断号，
 * 柱、杆、墙高出太多时截断；最后整体平移，使最左边留 SIDE_PAD
 */
function faceView(
  parts: Part3D[],
  f: Frame | null,
  mounts: Mount[],
  ctx: { mountBottom: number; tallest: number; fold: boolean },
): { view: Prim2D[]; mounts: Mount[]; width: number; height: number; shift: number } {
  const fold = ctx.fold && ctx.mountBottom > FOLD_MAX ? ctx.mountBottom - FOLD_MAX : 0
  const lo = FOLD_MAX / 2
  const hi = ctx.mountBottom - FOLD_MAX / 2
  const fy = (y: number) => (!fold || y <= lo ? y : y >= hi ? y - fold : lo)

  const rects: Extract<Prim2D, { kind: 'rect' }>[] = []
  const breaks: Prim2D[] = []
  if (f) {
    const projected = parts
      .map((p) => ({ p, q: project(p, f) }))
      // 站在这一面前看：完全在看的人这边（挂牌面前方）的部件不画，例如候车亭亭内看不到前排立柱
      .filter(({ q }) => q.near < BOARD_THICKNESS_MM + 50)
    const fixedTop = Math.max(
      ctx.mountBottom + ctx.tallest + TOP_ROOM,
      ...projected.filter(({ p }) => !CUTTABLE.includes(p.part)).map(({ q }) => q.y + q.h),
    )
    for (const { p, q } of projected.sort((a, b) => a.q.mid - b.q.mid)) {
      let top = q.y + q.h
      if (CUTTABLE.includes(p.part) && top > fixedTop + 300) {
        top = fixedTop
        breaks.push({ kind: 'break', x: q.x, y: fy(top), w: q.w })
      }
      const y0 = fy(q.y)
      const y1 = fy(top)
      if (y1 - y0 < 1) continue
      if (fold && q.y < lo && q.y + q.h > hi) breaks.push({ kind: 'break', x: q.x, y: lo, w: q.w })
      rects.push({
        kind: 'rect',
        part: p.part,
        x: q.x,
        y: y0,
        w: q.w,
        h: y1 - y0,
        round: p.shape === 'cylinder',
        depth: round(q.mid),
      })
    }
  }
  const ms = mounts.map((m) => ({ ...m, y: fy(m.y) }))
  const xs = [...rects.map((r) => [r.x, r.x + r.w]), ...ms.map((m) => [m.x, m.x + m.w])].flat()
  const min = xs.length ? Math.min(...xs) : 0
  const max = xs.length ? Math.max(...xs) : EMPTY_GROUP_MM
  const shift = SIDE_PAD - min
  const width = max - min + SIDE_PAD * 2
  const tops = [
    ...rects.map((r) => r.y + r.h),
    ...ms.map((m) => m.y + m.h),
    ...breaks.map((b) => (b as { y: number }).y),
  ]
  const height = Math.max(0, ...tops) + 60
  const move = <T extends { x: number }>(p: T): T => ({ ...p, x: round(p.x + shift) })
  return {
    view: [{ kind: 'ground', x: 0, w: round(width) }, ...rects.map(move), ...breaks.map(move)],
    mounts: ms.map(move),
    width: round(width),
    height: round(height),
    shift,
  }
}

/* ---------------- 入口 ---------------- */

/**
 * 按站架类型与各面的站牌算出模型。faces 里不属于这个类型的面归入"其他面"（不画结构，给出提示）。
 * 同一输入总是得到同一输出
 */
export function buildShelfModel(
  type: ShelfSpec,
  faces: ShelfModelFace[],
  opts: { ghost?: boolean; fold?: boolean } = {},
): ShelfModel {
  const own = shelfFaces(type)
  const byFace = new Map<BoardFace, ShelfModelBoard[]>()
  for (const f of faces) byFace.set(f.face, [...(byFace.get(f.face) ?? []), ...f.boards])
  const groups: Partial<Record<BoardFace, number>> = {}
  for (const f of own) {
    const boards = byFace.get(f)
    if (boards?.length) groups[f] = groupWidth(boards)
  }
  const strays = [...byFace].filter(([f, bs]) => !own.includes(f) && bs.length)
  const all = [...byFace.values()].flat()
  const tallest = Math.max(0, ...all.map((b) => b.height)) || 1800
  const ctx: Ctx = { groups, tallest, faces: own }
  let built = structure(type, ctx)
  if (type.params.orientation === 'perpendicular') built = rotate(built, -Math.PI / 2)
  const { mountBottom } = type.params
  // 不压缩时也按实际的牌面下沿算截断高度，否则柱、杆会截在牌组顶边以下
  const viewCtx = { mountBottom, tallest, fold: opts.fold !== false }
  const foldBy = opts.fold === false ? 0 : Math.max(0, mountBottom - FOLD_MAX)
  const warnings = [...built.warnings]

  const out: FaceModel[] = own.map((face) => {
    const frame = built.frames[face]!
    const boards = byFace.get(face) ?? []
    const v = faceView(built.parts, frame, layout(boards, mountBottom), viewCtx)
    // 折断时 fy 把下沿压低了；面内 y 与 3D 的对应要按实际高度，toShelf 只平移 x
    const o = add(frame.o, frame.r, -v.shift)
    return {
      face,
      label: shelfFaceLabel(type.form, face),
      width: v.width,
      height: v.height,
      view: v.view,
      mounts: v.mounts,
      toShelf: toMatrix({ ...frame, o }),
    }
  })

  // 其他面：站牌放在站架右侧的地面上，正面朝站台
  let footprint = footprintOf(built.parts, out)
  if (strays.length) {
    const boards = strays.flatMap(([, bs]) => bs)
    const labels = strays.map(([f]) => shelfFaceLabel(type.form, f)).join('、')
    warnings.push(
      `${boards.length} 块站牌在${labels}，不属于${SHELF_FORM_LABEL[type.form]}「${own.map((f) => shelfFaceLabel(type.form, f)).join('、')}」，归入其他面`,
    )
    const v = faceView([], null, layout(boards, mountBottom), viewCtx)
    const x = footprint.maxX + 400
    out.push({
      face: 'other',
      label: '其他面',
      width: v.width,
      height: v.height,
      view: v.view,
      mounts: v.mounts,
      toShelf: toMatrix({ o: [x - v.shift, 0, 0], r: [1, 0, 0], n: [0, 0, 1] }),
    })
    footprint = footprintOf(built.parts, out)
  }

  // 以占地中心为原点
  const cx = (footprint.minX + footprint.maxX) / 2
  const cz = (footprint.minZ + footprint.maxZ) / 2
  const shiftPart = (p: Part3D): Part3D => ({
    ...p,
    center: [round(p.center[0] - cx), p.center[1], round(p.center[2] - cz)],
  })
  for (const f of out) {
    f.toShelf[12] = round(f.toShelf[12] - cx)
    f.toShelf[14] = round(f.toShelf[14] - cz)
  }
  return {
    form: type.form,
    ghost: opts.ghost ?? false,
    faces: out,
    parts: built.parts.map(shiftPart).map(roundPart),
    footprint: { width: round(footprint.maxX - footprint.minX), depth: round(footprint.maxZ - footprint.minZ) },
    fold: foldBy,
    bottom: mountBottom - foldBy,
    warnings,
  }
}

const roundPart = (p: Part3D): Part3D => ({
  ...p,
  center: p.center.map(round) as V3,
  ...(p.shape === 'box' ? { size: p.size.map(round) as V3, rotY: round(p.rotY) } : {}),
  ...(p.shape === 'prism' ? { radius: round(p.radius), rotY: round(p.rotY) } : {}),
})

/** 站牌在站架坐标里的四个角（xz） */
export function mountCorners(f: FaceModel, m: Mount): V3[] {
  const t = f.toShelf
  const at = (x: number, z: number): V3 => [t[0] * x + t[8] * z + t[12], 0, t[2] * x + t[10] * z + t[14]]
  return [at(m.x, 0), at(m.x + m.w, 0), at(m.x, BOARD_THICKNESS_MM), at(m.x + m.w, BOARD_THICKNESS_MM)]
}

function footprintOf(parts: Part3D[], faces: FaceModel[]) {
  const pts = [...parts.flatMap(outline), ...faces.flatMap((f) => f.mounts.flatMap((m) => mountCorners(f, m)))]
  if (!pts.length) return { minX: -EMPTY_GROUP_MM / 2, maxX: EMPTY_GROUP_MM / 2, minZ: -100, maxZ: 100 }
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[2])),
    maxZ: Math.max(...pts.map((p) => p[2])),
  }
}

/** 草稿里的一个站架 → 模型输入：按面归组，面的顺序按类型 */
export function shelfFacesOf(
  boards: { id: string; face: BoardFace; width: number; height: number }[],
): ShelfModelFace[] {
  const map = new Map<BoardFace, ShelfModelBoard[]>()
  for (const b of boards) map.set(b.face, [...(map.get(b.face) ?? []), { id: b.id, width: b.width, height: b.height }])
  return [...map].map(([face, bs]) => ({ face, boards: bs }))
}
