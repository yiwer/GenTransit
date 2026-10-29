// 站名标注的避让布局：标注之间、标注与其他站点圆点之间都不重叠。
// 按优先级逐个放置（选中 > 悬停 > 强调 > 其余按原顺序），每个标注依次试右上、右下、左上、左下、正上、正下六个位置，
// 第一个不相交的位置就用；都放不下就不显示。选中和悬停的标注一定显示，放不下时用右上。
// 布局只依赖点与点的相对位置，平移地图时结果不变，不会闪烁

export interface LabelInput {
  id: string
  /** 圆点中心（容器像素） */
  x: number
  y: number
  /** 圆点半径 */
  r: number
  /** 标注框宽高（含描边光晕） */
  w: number
  h: number
  /** 越大越先放；≥ 2 的一定显示 */
  priority: number
}

/** 标注框左上角 */
export interface LabelBox {
  left: number
  top: number
}

interface Rect {
  l: number
  t: number
  r: number
  b: number
}

const GAP = 3
const hit = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/** 六个候选位置：贴着圆点外侧 */
function candidates(p: LabelInput): LabelBox[] {
  const { x, y, r, w, h } = p
  const right = x + r + GAP
  const left = x - r - GAP - w
  const up = y - r - h + 5
  const down = y + r - 5
  return [
    { left: right, top: up },
    { left: right, top: down },
    { left, top: up },
    { left, top: down },
    { left: x - w / 2, top: y - r - GAP - h },
    { left: x - w / 2, top: y + r + GAP },
  ]
}

export function layoutLabels(items: LabelInput[]): Map<string, LabelBox> {
  const out = new Map<string, LabelBox>()
  const dots: (Rect & { id: string })[] = items.map((p) => ({
    id: p.id,
    l: p.x - p.r,
    t: p.y - p.r,
    r: p.x + p.r,
    b: p.y + p.r,
  }))
  const placed: Rect[] = []
  const order = items.map((p, i) => ({ p, i })).sort((a, b) => b.p.priority - a.p.priority || a.i - b.i)
  for (const { p } of order) {
    const boxes = candidates(p)
    const free = boxes.find((c) => {
      const rect = { l: c.left, t: c.top, r: c.left + p.w, b: c.top + p.h }
      return !placed.some((q) => hit(rect, q)) && !dots.some((d) => d.id !== p.id && hit(rect, d))
    })
    const box = free ?? (p.priority >= 2 ? boxes[0] : null)
    if (!box) continue
    out.set(p.id, box)
    placed.push({ l: box.left, t: box.top, r: box.left + p.w, b: box.top + p.h })
  }
  return out
}

/* ---------- 文字宽度 ---------- */

/** 中日韩文字与全角符号按一个字宽估算 */
const isWide = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0
  return (c >= 0x3000 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)
}

let ctx: CanvasRenderingContext2D | null | undefined
const widths = new Map<string, number>()

/** 量文字宽度（canvas，按字体缓存）；没有 canvas 时（测试环境）按中文 1 个字号、其他 0.6 个字号估算 */
export function textWidth(text: string, size: number, weight: number, family: string) {
  const font = `${weight} ${size}px ${family}`
  const key = `${font}|${text}`
  const hitW = widths.get(key)
  if (hitW !== undefined) return hitW
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d')
    } catch {
      ctx = null
    }
  }
  let w: number
  if (ctx) {
    ctx.font = font
    w = ctx.measureText(text).width
  } else {
    w = [...text].reduce((s, ch) => s + (isWide(ch) ? size : size * 0.6), 0)
  }
  if (widths.size > 5000) widths.clear()
  widths.set(key, w)
  return w
}
