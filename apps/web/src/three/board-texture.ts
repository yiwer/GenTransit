// 3D 牌面贴图（M7 计划 5.3 节）：用 Canvas 按毫米画出与立面相同的内容——牌头、线路行（线路牌、方向、终点）、
// 插片（号码、非线路斜纹）、失效编排（陶土色加删除线）。颜色取页面的 CSS 变量，深色模式跟着变
import { CanvasTexture, SRGBColorSpace } from 'three'
import type { BoardContent, BoardRow } from '@/shelf-model/board-content'

/** 贴图最大边长（像素） */
export const TEXTURE_MAX = 2048
/** 每毫米多少像素（不超过 TEXTURE_MAX） */
const PX_PER_MM = 0.7

export interface Palette {
  surface: string
  sunken: string
  surface2: string
  hairline: string
  ink: string
  ink3: string
  plate: string
  plateInk: string
  danger: string
  dangerSoft: string
}

/** 读页面的颜色令牌（浅色 / 深色） */
export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el)
  const v = (k: string, fb: string) => cs.getPropertyValue(k).trim() || fb
  return {
    surface: v('--surface', '#fffcf7'),
    sunken: v('--sunken', '#ede6d9'),
    surface2: v('--surface-2', '#faf6ef'),
    hairline: v('--ink-4', '#a69a8a'),
    ink: v('--ink', '#221c15'),
    ink3: v('--ink-3', '#72665a'),
    plate: v('--plate', '#1f4547'),
    plateInk: v('--plate-ink', '#fbf6ec'),
    danger: v('--danger', '#b4502f'),
    dangerSoft: v('--danger-soft', '#f6ddd2'),
  }
}

const SANS = '"Noto Sans SC", "Plus Jakarta Sans", sans-serif'
const SERIF = '"Noto Serif SC", serif'
const PLATE = '"Barlow Condensed", "Noto Sans SC", sans-serif'

const FONTS = [`700 48px ${SERIF}`, `600 48px ${SANS}`, `700 48px ${PLATE}`]

/** 画字前等页面已加载的字体（中文按用到的字下载分片）；返回是否新加载了字体（贴图要重画） */
export async function fontsReady(texts: string[]): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts?.load) return false
  const all = texts.join('')
  if (FONTS.every((f) => document.fonts.check(f, all))) return false
  await Promise.all(FONTS.map((f) => document.fonts.load(f, all))).catch(() => undefined)
  return true
}

export const textsOf = (c: BoardContent) => [
  c.title,
  c.faceLabel,
  c.kindLabel,
  ...c.rows.flatMap((r) => [r.name, r.terminal, r.badText]),
  ...c.slots.flatMap((s) => [s.note, s.row?.name ?? '', s.row?.terminal ?? '']),
]

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, w / 2, h / 2))
}

function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** 一行线路：线路牌 + 方向 + 终点（或失效说明） */
function row(g: CanvasRenderingContext2D, p: Palette, r: BoardRow, x: number, y: number, w: number, h: number) {
  const fs = h * 0.42
  if (r.bad) {
    g.fillStyle = p.dangerSoft
    rr(g, x, y + h * 0.08, w, h * 0.84, h * 0.18)
    g.fill()
  }
  g.font = `700 ${fs}px ${PLATE}`
  const pw = Math.min(w * 0.45, g.measureText(r.name).width + fs * 0.8)
  g.fillStyle = r.bad ? p.danger : p.plate
  rr(g, x + h * 0.12, y + h * 0.18, pw, h * 0.64, h * 0.12)
  g.fill()
  g.fillStyle = p.plateInk
  g.textBaseline = 'middle'
  g.fillText(fit(g, r.name, pw - fs * 0.4), x + h * 0.12 + fs * 0.4, y + h / 2)
  const mx = x + h * 0.12 + pw + h * 0.42
  g.fillStyle = p.sunken
  g.beginPath()
  g.arc(mx, y + h / 2, h * 0.24, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = p.ink
  g.font = `600 ${fs * 0.8}px ${SANS}`
  g.textAlign = 'center'
  g.fillText(r.mark, mx, y + h / 2)
  g.textAlign = 'left'
  const tx = mx + h * 0.4
  const tw = x + w - tx - h * 0.1
  if (tw < fs) return
  if (r.bad) {
    g.font = `600 ${fs * 0.86}px ${SANS}`
    g.fillStyle = p.danger
    const t = fit(g, r.badText, tw)
    g.fillText(t, tx, y + h / 2)
    g.fillRect(tx, y + h / 2, g.measureText(t).width, Math.max(1, fs * 0.07))
  } else {
    g.font = `700 ${fs}px ${SERIF}`
    g.fillStyle = p.ink
    g.fillText(fit(g, r.terminal, tw), tx, y + h / 2)
  }
}

/** 按毫米画一块站牌的正面，返回画布 */
export function paintBoard(c: BoardContent, p: Palette): HTMLCanvasElement {
  const k = Math.min(PX_PER_MM, TEXTURE_MAX / Math.max(c.width, c.height))
  const W = Math.max(8, Math.round(c.width * k))
  const H = Math.max(8, Math.round(c.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return canvas
  const mm = (n: number) => n * k
  // 金属边框 + 牌面
  g.fillStyle = p.sunken
  g.fillRect(0, 0, W, H)
  const f = mm(36)
  g.fillStyle = p.surface
  rr(g, f, f, W - f * 2, H - f * 2, mm(30))
  g.fill()
  // 牌头
  const head = Math.min(mm(170), H * 0.18)
  g.fillStyle = p.plate
  rr(g, f, f, W - f * 2, head, mm(30))
  g.fill()
  g.fillRect(f, f + head / 2, W - f * 2, head / 2)
  g.textBaseline = 'middle'
  g.fillStyle = p.plateInk
  g.font = `700 ${head * 0.5}px ${SERIF}`
  g.fillText(c.title, f + head * 0.4, f + head / 2)
  const right = `${c.faceLabel} · ${c.kindLabel} · ${c.count}`
  g.font = `600 ${head * 0.32}px ${SANS}`
  g.globalAlpha = 0.8
  g.textAlign = 'right'
  g.fillText(fit(g, right, (W - f * 2) * 0.5), W - f - head * 0.4, f + head / 2)
  g.textAlign = 'left'
  g.globalAlpha = 1

  const top = f + head + mm(20)
  const inner = W - f * 2
  if (c.whole) {
    const rh = Math.min(mm(240), (H - top - f) / Math.max(1, c.rows.length))
    c.rows.forEach((r, i) => {
      const y = top + i * rh
      row(g, p, r, f + mm(20), y, inner - mm(40), rh)
      if (i < c.rows.length - 1) {
        g.strokeStyle = p.hairline
        g.globalAlpha = 0.5
        g.setLineDash([mm(16), mm(12)])
        g.lineWidth = Math.max(1, mm(4))
        g.beginPath()
        g.moveTo(f + mm(30), y + rh)
        g.lineTo(W - f - mm(30), y + rh)
        g.stroke()
        g.setLineDash([])
        g.globalAlpha = 1
      }
    })
    return canvas
  }
  // 分片：插片按最宽的一个排列列数，等比缩放（与立面相同）
  g.fillStyle = p.surface2
  g.fillRect(f, top - mm(10), inner, H - top - f + mm(10))
  const pad = mm(50)
  const gap = mm(40)
  const cols = Math.max(1, Math.floor(c.width / Math.max(1, ...c.slots.map((s) => s.width))))
  const cw = (inner - pad * 2 - gap * (cols - 1)) / cols
  let x = f + pad
  let y = top + pad
  let lineH = 0
  c.slots.forEach((s, i) => {
    const h = s.height * (cw / Math.max(1, s.width))
    if (i && i % cols === 0) {
      x = f + pad
      y += lineH + gap
      lineH = 0
    }
    lineH = Math.max(lineH, h)
    if (s.other) {
      g.save()
      rr(g, x, y, cw, h, mm(20))
      g.clip()
      g.fillStyle = p.sunken
      g.fillRect(x, y, cw, h)
      g.strokeStyle = p.surface
      g.lineWidth = mm(24)
      for (let d = -h; d < cw + h; d += mm(70)) {
        g.beginPath()
        g.moveTo(x + d, y + h)
        g.lineTo(x + d + h, y)
        g.stroke()
      }
      g.restore()
      g.fillStyle = p.ink3
      g.font = `600 ${Math.min(h * 0.3, mm(90))}px ${SANS}`
      g.textAlign = 'center'
      g.fillText(fit(g, s.note || '非线路', cw * 0.85), x + cw / 2, y + h / 2)
      g.textAlign = 'left'
    } else {
      g.fillStyle = s.row ? p.surface : p.surface2
      rr(g, x, y, cw, h, mm(20))
      g.fill()
      g.strokeStyle = p.hairline
      g.globalAlpha = 0.6
      g.lineWidth = Math.max(1, mm(4))
      if (!s.row) g.setLineDash([mm(16), mm(12)])
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
      if (s.row) row(g, p, s.row, x + mm(10), y + h * 0.18, cw - mm(20), Math.min(h * 0.8, mm(240)))
    }
    // 插片号码小标签
    const tag = Math.min(mm(70), h * 0.3)
    g.fillStyle = p.plate
    rr(g, x + mm(20), y, tag * 1.3, tag, tag * 0.25)
    g.fill()
    g.fillStyle = p.plateInk
    g.font = `700 ${tag * 0.7}px ${SANS}`
    g.textAlign = 'center'
    g.fillText(String(s.no), x + mm(20) + tag * 0.65, y + tag / 2)
    g.textAlign = 'left'
    x += cw + gap
  })
  return canvas
}

export function boardTexture(c: BoardContent, p: Palette) {
  const t = new CanvasTexture(paintBoard(c, p))
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** 内容 + 配色的键：只有它变了才重画 */
export const textureKey = (c: BoardContent, p: Palette) => JSON.stringify([c, p.surface, p.plate, p.ink])
