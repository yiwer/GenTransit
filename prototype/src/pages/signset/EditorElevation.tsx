// PROTOTYPE — 站牌编排编辑器（定稿 A3「立面 + 线路托盘」）
// 站台立面：站架按页面宽度自动折成多行，站牌画成带金属边框和墨绿牌头的实物样式；
// 底部托盘只有两个区：待编排、隐藏（独立投放区，拖进去即隐藏）。已编排看站牌本身，失效编排在站牌上标红、工具条一键清理。
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownUp, ChevronDown, ChevronUp, EyeOff, GripVertical, Layers, MoreHorizontal, Plus, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Board, Schedule, Shelf } from '../../data/types'
import { cnNum, keyOf, type PoolItem, type ScheduleStatus } from '../../lib/domain'
import { Button, IconButton, MenuItem, Popover, RoutePlate, Segmented, cn } from '../../ui'
import { EmptyShelfArt } from '../../ui/lively'
import { KIND_MARK } from '../shared'
import { preferInner } from './EditorA'
import * as M from './model'
import { EditorHeader, Inspector, PassageLabel, PlaceMenu, TemplateDialog } from './parts'
import { useEditorDnd, type Editor } from './useEditor'

const POST_MM = 420 // 站牌下沿到地面（示意）
const GAP_MM = 120 // 同一站架内站牌间距
const ZOOMS = { 紧凑: 230, 标准: 320, 大: 430 } as const // 最高那块站牌显示多高（px）
type Zoom = keyof typeof ZOOMS

const shelfWidthMm = (sh: Shelf) => sh.boards.reduce((n, b) => n + b.w, 0) + GAP_MM * Math.max(0, sh.boards.length - 1) + 240

function useStoredZoom() {
  const [z, setZ] = useState<Zoom>(() => {
    try {
      const v = localStorage.getItem('gt-elev-zoom') as Zoom
      return v && v in ZOOMS ? v : '标准'
    } catch {
      return '标准'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('gt-elev-zoom', z)
    } catch {
      /* 忽略 */
    }
  }, [z])
  return [z, setZ] as const
}

/* ---------------- 站牌 ---------------- */

/** 站牌行按牌面宽度分三级：窄 = 线路牌 + 方向；中 = 再加终点站；宽 = 序号 + "开往"全文 */
function SignRow({ ed, s, index, width }: { ed: Editor; s: Schedule; index: number; width: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `sch:${s.id}` })
  const item = ed.itemOf(keyOf(s.routeId, s.nth))
  const bad = item?.status === '失效'
  const level = width < 160 ? 'narrow' : width < 290 ? 'mid' : 'wide'
  const compact = level !== 'wide'
  const tip = `${s.lineName} ${s.kind}${bad ? ' · 已不经过本站' : item ? ` · 开往 ${item.terminal}` : ''}`
  if (level === 'narrow')
    return (
      <div
        ref={setNodeRef}
        title={tip}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn('group/row relative flex h-9 shrink-0 items-center gap-1.5 border-b border-dashed border-hairline-2 pl-1 pr-1 last:border-b-0', bad && 'bg-danger-soft', isDragging && 'z-10 rounded-lg bg-surface opacity-60 shadow-pop')}
      >
        <button {...attributes} {...listeners} aria-label={`拖动 ${s.lineName}`} className="flex h-full w-4 shrink-0 cursor-grab items-center justify-center text-ink-4 opacity-40 group-hover/row:opacity-100 focus:opacity-100">
          <GripVertical size={13} />
        </button>
        <RoutePlate name={s.lineName} size="sm" state={bad ? 'invalid' : 'normal'} />
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] text-ink-2">{KIND_MARK[s.kind]}</span>
        <button aria-label={`从这块牌移除 ${s.lineName}`} onClick={(e) => { e.stopPropagation(); ed.ops.removeSchedule(s.id) }} className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-ink-4 opacity-0 hover:bg-sunken hover:text-ink group-hover/row:opacity-100 focus:opacity-100">
          <X size={13} />
        </button>
      </div>
    )
  return (
    <div
      ref={setNodeRef}
      title={tip}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/row relative flex shrink-0 items-center border-b border-dashed border-hairline-2 last:border-b-0', compact ? 'h-9 gap-1.5 pl-1 pr-1' : 'h-11 gap-2 pl-1.5 pr-2', bad && 'bg-danger-soft', isDragging && 'z-10 rounded-lg bg-surface opacity-60 shadow-pop')}
    >
      <button {...attributes} {...listeners} aria-label={`拖动 ${s.lineName}`} className="flex h-full w-4 shrink-0 cursor-grab items-center justify-center text-ink-4 opacity-40 group-hover/row:opacity-100 focus:opacity-100">
        <GripVertical size={13} />
      </button>
      {!compact && <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-ink-4">{index + 1}</span>}
      <RoutePlate name={s.lineName} size={compact ? 'sm' : 'md'} state={bad ? 'invalid' : 'normal'} />
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] text-ink-2" title={s.kind}>{KIND_MARK[s.kind]}</span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">
        {bad ? (
          <span className="text-[12px] text-danger">{compact ? '失效' : '已不经过本站'}</span>
        ) : (
          <>
            {!compact && <span className="text-[11.5px] text-ink-3">开往 </span>}
            <span className={cn('font-display font-semibold text-ink', compact ? 'text-[12.5px]' : 'text-[14px]')}>{item?.terminal}</span>
          </>
        )}
      </span>
      {/* 操作浮在行尾，悬停才出现，不占布局空间 */}
      <span
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute inset-y-0 right-0.5 flex items-center gap-0.5 rounded-md bg-gradient-to-l from-surface from-60% to-transparent pl-4 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"
      >
        {item && !bad && (
          <PlaceMenu ed={ed} item={item} trigger={(t) => <IconButton label={`${s.lineName} 复制到其他站牌或隐藏`} className="size-6" onClick={t}><MoreHorizontal size={13} /></IconButton>} />
        )}
        <IconButton label={`从这块牌移除 ${s.lineName}`} className="size-6" onClick={() => ed.ops.removeSchedule(s.id)}>
          <X size={13} />
        </IconButton>
      </span>
    </div>
  )
}

function SignSlot({ ed, slot, w, h }: { ed: Editor; slot: Board['slots'][number]; w: number; h: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.id}` })
  const s = M.inSlot(ed.draft, slot.id)
  const drag = useDraggable({ id: s ? `sch:${s.id}` : `none:${slot.id}`, disabled: !s })
  const item = s && ed.itemOf(keyOf(s.routeId, s.nth))
  const nonRoute = slot.kind === '非线路'
  const small = w < 140 || h < 64
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); ed.setSel({ type: 'slot', id: slot.id }) }}
      style={{ width: w, height: h }}
      className={cn(
        'group/slot relative flex flex-col justify-center rounded-md transition-all duration-200',
        small ? 'px-1.5 pt-2.5' : 'px-2.5 pt-3',
        nonRoute
          ? 'bg-[repeating-linear-gradient(135deg,var(--sunken)_0_6px,var(--surface-2)_6px_12px)] ring-1 ring-inset ring-hairline-2'
          : s
            ? 'bg-surface shadow-xs ring-1 ring-hairline'
            : 'border border-dashed border-hairline-2 bg-surface/50',
        isOver && !nonRoute && 'scale-[1.03] bg-accent-soft ring-2 ring-accent',
        isOver && nonRoute && 'ring-2 ring-danger',
        ed.sel?.type === 'slot' && ed.sel.id === slot.id && 'ring-2 ring-coral',
      )}
    >
      {/* 插片编号小标签，像实物插片上的号码牌 */}
      <span className="absolute left-1.5 top-0 rounded-b-[4px] bg-plate px-1 text-[9.5px] font-semibold leading-[14px] text-plate-ink">{slot.no}</span>
      {nonRoute ? (
        <span className={cn('text-center leading-tight text-ink-2', small ? 'text-[10.5px]' : 'text-[12px]')}>{slot.note || '非线路'}</span>
      ) : s && item ? (
        <div ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} className={cn('flex min-w-0 cursor-grab items-center gap-1.5', drag.isDragging && 'opacity-40')}>
          <RoutePlate name={s.lineName} size={small ? 'sm' : 'md'} state={item.status === '失效' ? 'invalid' : 'normal'} />
          {!small && (
            <span className="min-w-0 truncate whitespace-nowrap text-[11.5px] text-ink-3">
              {KIND_MARK[s.kind]} {item.status === '失效' ? '失效' : item.terminal}
            </span>
          )}
          <button aria-label="移出插片" onClick={(e) => { e.stopPropagation(); ed.ops.removeSchedule(s.id) }} className="ml-auto hidden text-ink-4 hover:text-ink group-hover/slot:block">
            <X size={12} />
          </button>
        </div>
      ) : (
        <span className={cn('text-center text-ink-4', small ? 'text-[10.5px]' : 'text-[11.5px]')}>空</span>
      )}
    </div>
  )
}

function SignBoard({ ed, board, scale }: { ed: Editor; board: Board; scale: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `board:${board.id}` })
  const list = M.onBoard(ed.draft, board.id)
  const W = board.w * scale
  const H = board.h * scale
  const selected = ed.sel?.type === 'board' && ed.sel.id === board.id
  const frame = 5
  const head = 30
  const innerW = W - frame * 2
  const cols = Math.max(1, Math.floor(board.w / Math.max(...board.slots.map((s) => s.w), 1)))
  const pad = 8
  const cw = (innerW - pad * 2 - 6 * (cols - 1)) / cols
  const count = board.kind === '整版' ? list.length : board.slots.filter((sl) => M.inSlot(ed.draft, sl.id)).length
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={setNodeRef}
        onClick={(e) => { e.stopPropagation(); ed.setSel({ type: 'board', id: board.id }) }}
        style={{ width: W, height: H, padding: frame }}
        className={cn(
          'relative cursor-pointer rounded-[12px] bg-[linear-gradient(160deg,var(--surface)_0%,var(--sunken)_55%,var(--surface-2)_100%)] shadow-float ring-1 ring-hairline-2 transition-[box-shadow,transform] duration-300 ease-[var(--spring)]',
          isOver && board.kind === '整版' && '-translate-y-1 ring-2 ring-accent',
          selected && 'shadow-pop ring-2 ring-coral',
        )}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-[8px] bg-surface ring-1 ring-hairline">
          {/* 牌头：编号、朝向、类型 */}
          {/* 牌头按宽度分级：宽 = 编号 + 朝向 + 类型与数量；中 = 编号 + 数量；窄 = 只有编号 */}
          <div title={`${cnNum(board.no)}号牌 · ${board.face} · ${board.kind} · ${count} 条`} className={cn('flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap bg-plate text-plate-ink', innerW < 110 ? 'justify-center px-1' : 'px-2.5')} style={{ height: head }}>
            <span className="font-display text-[13.5px] font-bold">{innerW < 110 ? cnNum(board.no) : `${cnNum(board.no)}号牌`}</span>
            {innerW >= 170 && <span className="rounded-[4px] bg-plate-ink/15 px-1 text-[10.5px] leading-4">{board.face}</span>}
            {innerW >= 110 && <span className="ml-auto text-[10.5px] opacity-75">{innerW >= 170 ? `${board.kind} · ${count}` : count}</span>}
          </div>
          {board.kind === '整版' ? (
            <SortableContext items={list.map((s) => `sch:${s.id}`)} strategy={verticalListSortingStrategy}>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto px-1.5 py-1">
                {list.map((s, i) => <SignRow key={s.id} ed={ed} s={s} index={i} width={innerW} />)}
                {list.length === 0 && <div className={cn('m-1 flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-2 text-center text-ink-4', innerW < 110 ? 'text-[10.5px]' : 'text-[12px]')}>{innerW < 110 ? '拖入' : '拖线路到这里'}</div>}
              </div>
            </SortableContext>
          ) : (
            <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-auto bg-sunken/60" style={{ padding: pad }}>
              {board.slots.map((sl) => <SignSlot key={sl.id} ed={ed} slot={sl} w={cw} h={Math.max(40, sl.h * (cw / sl.w))} />)}
            </div>
          )}
        </div>
        {isOver && board.kind === '整版' && (
          <div className="pointer-events-none absolute inset-x-0 -top-7 text-center text-[11.5px] font-medium text-accent">松手放到{cnNum(board.no)}号牌</div>
        )}
      </div>
      <span className="text-[11px] tabular-nums text-ink-3">{board.w}×{board.h}</span>
    </div>
  )
}

function SignShelf({ ed, shelf, scale }: { ed: Editor; shelf: Shelf; scale: number }) {
  const shelter = shelf.type.includes('候车亭')
  const single = shelf.type.includes('单立柱')
  const w = shelfWidthMm(shelf) * scale
  const selected = ed.sel?.type === 'shelf' && ed.sel.id === shelf.id
  const post = <span className="w-[8px] rounded-t-[2px] bg-[linear-gradient(90deg,var(--ink-2),var(--ink-4)_45%,var(--ink-2))]" style={{ height: POST_MM * scale }} />
  return (
    <div className="group/shelf flex shrink-0 flex-col items-center" style={{ minWidth: w }}>
      {shelter && (
        <div className="relative mb-2 h-[16px] rounded-[6px] bg-[linear-gradient(180deg,var(--plate),color-mix(in_oklab,var(--plate)_70%,black))] shadow-xs" style={{ width: w + 36 }}>
          <span className="absolute inset-x-6 -bottom-[3px] h-[3px] rounded-b bg-plate/40" />
        </div>
      )}
      <div className="flex items-end" style={{ gap: GAP_MM * scale }}>
        {shelf.boards.map((b) => <SignBoard key={b.id} ed={ed} board={b} scale={scale} />)}
        <button
          onClick={(e) => { e.stopPropagation(); ed.ops.addBoard(shelf.id) }}
          aria-label={`给${cnNum(shelf.no)}号架加站牌`}
          className={cn('mb-5 flex items-center justify-center rounded-[10px] border-2 border-dashed border-hairline-2 text-ink-4 transition-opacity hover:border-accent hover:text-accent', shelf.boards.length ? 'w-8 opacity-0 group-hover/shelf:opacity-100 focus:opacity-100' : 'opacity-100')}
          style={{ height: 900 * scale, width: shelf.boards.length ? undefined : 600 * scale }}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className={cn('flex w-full', single ? 'justify-center' : 'justify-between px-[12%]')}>
        {post}
        {!single && post}
      </div>
      <div className="h-[4px] rounded-full bg-[linear-gradient(90deg,transparent,var(--ink-3)_12%,var(--ink-3)_88%,transparent)] opacity-50" style={{ width: w + 70 }} />
      <button
        onClick={(e) => { e.stopPropagation(); ed.setSel({ type: 'shelf', id: shelf.id }) }}
        className={cn('mt-2.5 flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] transition-colors', selected ? 'bg-coral text-paper' : 'bg-surface text-ink-2 shadow-xs ring-1 ring-hairline hover:text-ink')}
      >
        <b className="font-display">{cnNum(shelf.no)}号架</b> {shelf.type}
        {shelf.name && <span className={selected ? 'text-paper/80' : 'text-ink-3'}>· {shelf.name}</span>}
        {shelf.noPhysical && <span className="rounded bg-sunken px-1 text-[10.5px] text-ink-3">无实物</span>}
      </button>
    </div>
  )
}

/* ---------------- 底部托盘：待编排 + 隐藏 ---------------- */

function TrayChip({ ed, item, variant }: { ed: Editor; item: PoolItem; variant: 'wait' | 'hidden' }) {
  const bad = false
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool:${item.key}` })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'group/chip relative flex h-[46px] shrink-0 items-center gap-2 rounded-xl pl-1.5 pr-1 shadow-xs ring-1 transition-transform',
        bad ? 'cursor-default bg-surface ring-danger/30' : 'cursor-grab ring-hairline hover:-translate-y-0.5 hover:shadow-float',
        variant === 'hidden' ? 'bg-surface-2' : 'bg-surface',
        isDragging && 'opacity-40',
      )}
    >
      <RoutePlate name={item.lineName} size="md" state={bad ? 'invalid' : variant === 'hidden' ? 'ghost' : 'normal'} />
      <span className="min-w-0 leading-tight">
        <span className="block whitespace-nowrap text-[11.5px] text-ink-2">
          {KIND_MARK[item.kind]} {item.kind}
          {item.timesAtStop > 1 && ` · 第${item.nth}次`}
        </span>
        <span className="block max-w-[110px] truncate whitespace-nowrap text-[11.5px] text-ink-3">
          开往 {item.terminal}
        </span>
      </span>
      <span onPointerDown={(e) => e.stopPropagation()} className="ml-0.5">
        {variant === 'hidden' ? (
          <IconButton label={`取消隐藏 ${item.lineName}`} className="size-7" onClick={() => ed.ops.unhide(item)}><Undo2 size={13} /></IconButton>
        ) : (
          <PlaceMenu ed={ed} item={item} trigger={(t) => <IconButton label={`${item.lineName} 的操作`} className="size-7 opacity-50 group-hover/chip:opacity-100" onClick={t}><MoreHorizontal size={14} /></IconButton>} />
        )}
      </span>
    </div>
  )
}

const ZONE_DOT: Record<ScheduleStatus, string> = { 待编排: 'bg-signal gt-breathe', 已编排: 'bg-sage', 隐藏: 'border border-ink-3', 失效: 'bg-danger' }

function Zone({ id, status, hint, count, action, dragging, children }: { id?: string; status: ScheduleStatus; hint: string; count: number; action?: ReactNode; dragging: boolean; children: ReactNode }) {
  const drop = useDroppable({ id: id ?? `zone:${status}`, disabled: !id })
  const isHidden = status === '隐藏'
  const target = !!id && dragging
  return (
    <section
      ref={drop.setNodeRef}
      className={cn(
        'flex min-w-0 flex-col rounded-2xl p-2.5 transition-all duration-200',
        isHidden ? 'border-2 border-dashed bg-surface-2' : 'bg-surface ring-1',
        isHidden ? (drop.isOver ? 'scale-[1.01] border-ink-2 bg-sunken' : target ? 'border-ink-3' : 'border-hairline-2') : drop.isOver ? 'bg-accent-soft ring-2 ring-accent' : target ? 'ring-accent/40' : 'ring-hairline',
      )}
    >
      <header className="mb-2 flex items-center gap-2 px-0.5">
        <span className={cn('size-2 shrink-0 rounded-full', ZONE_DOT[status])} />
        <span className="shrink-0 text-[13px] font-semibold">{status}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{count}</span>
        <span className="ml-auto truncate text-[11.5px] text-ink-3">{drop.isOver ? (isHidden ? '松手即隐藏' : '松手放回待编排') : hint}</span>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-auto pb-0.5">{children}</div>
    </section>
  )
}

function Tray({ ed, dragging, open, onToggle }: { ed: Editor; dragging: boolean; open: boolean; onToggle: () => void }) {
  const wait = ed.pool.filter((p) => p.status === '待编排')
  const hidden = ed.pool.filter((p) => p.status === '隐藏')
  if (!open)
    return (
      <div className="flex h-12 shrink-0 items-center gap-4 border-t border-hairline bg-surface-2 px-4">
        <span className="text-[13px] font-semibold">线路托盘</span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span className={cn('size-2 rounded-full', ZONE_DOT['待编排'])} /> 待编排 <b className="tabular-nums">{wait.length}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <span className={cn('size-2 rounded-full', ZONE_DOT['隐藏'])} /> 隐藏 <b className="tabular-nums">{hidden.length}</b>
        </span>
        <Button size="sm" className="ml-auto" onClick={onToggle}><ChevronUp size={14} /> 展开托盘</Button>
      </div>
    )
  return (
    <div className="relative grid h-[172px] shrink-0 grid-cols-[minmax(0,2.8fr)_minmax(0,1fr)] gap-2.5 border-t border-hairline bg-surface-2 p-2.5">
      <button onClick={onToggle} aria-label="收起托盘" className="absolute -top-[13px] left-1/2 z-[6] flex h-[26px] -translate-x-1/2 items-center gap-1 rounded-full bg-surface px-3 text-[11.5px] text-ink-3 shadow-xs ring-1 ring-hairline hover:text-ink">
        <ChevronDown size={13} /> 收起托盘
      </button>
      <Zone id="pool" status="待编排" count={wait.length} hint="往上拖到站牌；站牌上的线路拖回这里即移除" dragging={dragging}>
        {wait.map((it) => <TrayChip key={it.key} ed={ed} item={it} variant="wait" />)}
        {wait.length === 0 && <span className="m-auto text-[12.5px] text-ink-4">经过本站的线路都已编排或隐藏</span>}
      </Zone>
      <Zone id="hidden" status="隐藏" count={hidden.length} hint="拖进来即隐藏" dragging={dragging}>
        {hidden.map((it) => <TrayChip key={it.key} ed={ed} item={it} variant="hidden" />)}
        {hidden.length === 0 && (
          <span className="m-auto flex flex-col items-center gap-1 text-[12px] text-ink-4">
            <EyeOff size={18} /> 不在本站展示的线路拖到这里
          </span>
        )}
      </Zone>
    </div>
  )
}

/* ---------------- 页面 ---------------- */

export function EditorElevation({ ed }: { ed: Editor }) {
  const dnd = useEditorDnd(ed)
  const [zoom, setZoom] = useStoredZoom()
  const [trayOpen, setTrayOpen] = useState(true)
  const [tpl, setTpl] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const [sw, setSw] = useState(1100)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setSw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const shelves = ed.draft.shelves
  const maxH = Math.max(...M.allBoards(ed.draft).map((x) => x.board.h), 900)
  const widest = Math.max(...shelves.map(shelfWidthMm), 1)
  // 按选定档位决定最高站牌的显示高度；再保证最宽的站架一行放得下。多个站架按宽度自动折行
  const scale = Math.max(0.09, Math.min(ZOOMS[zoom] / maxH, (sw - 120) / widest))
  const selBoard = ed.sel?.type === 'board' ? M.findBoard(ed.draft, ed.sel.id)?.board : undefined

  return (
    <DndContext sensors={dnd.sensors} collisionDetection={preferInner} onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onDragCancel={dnd.onDragCancel}>
      <div className="flex h-full flex-col">
        <EditorHeader ed={ed} />
        <div className="relative min-h-0 flex-1">
          <div ref={stage} className="absolute inset-0 overflow-auto bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_55%,var(--sunken)_130%)]" onClick={() => ed.setSel(null)}>
            {/* 工具条 */}
            <div className="sticky left-0 top-0 z-[5] flex items-center gap-2 px-4 pt-3" onClick={(e) => e.stopPropagation()}>
              <Popover trigger={({ toggle }) => <Button size="sm" onClick={toggle}><Plus size={13} /> 站架</Button>} width={190}>
                {(close) => (
                  <>
                    <MenuItem onClick={() => { close(); setTpl(true) }}><Layers size={14} /> 从模板添加…</MenuItem>
                    <MenuItem onClick={() => { close(); ed.ops.addShelf() }}><Plus size={14} /> 空白站架</MenuItem>
                  </>
                )}
              </Popover>
              <Segmented<Zoom> size="sm" value={zoom} onChange={setZoom} options={(Object.keys(ZOOMS) as Zoom[]).map((z) => ({ value: z, label: z }))} />
              <span className="text-[12px] text-ink-3">
                {shelves.length} 个站架 · 按 {Math.round(scale * 1000) / 10}% 比例 · 点站牌、插片或站架编辑属性
              </span>
              {ed.counts.失效 > 0 && (
                <Button size="sm" variant="danger" className="ml-auto" onClick={() => ed.ops.clearInvalid()}>
                  <Trash2 size={13} /> 清理 {ed.counts.失效} 条失效编排
                </Button>
              )}
            </div>
            {shelves.length ? (
              <div className="flex flex-wrap items-end justify-center gap-x-14 gap-y-12 px-10 pb-10 pt-8">
                {shelves.map((sh) => <SignShelf key={sh.id} ed={ed} shelf={sh} scale={scale} />)}
              </div>
            ) : (
              <div className="flex h-[calc(100%-48px)] flex-col items-center justify-center gap-3 text-center">
                <EmptyShelfArt />
                <div className="font-display text-[17px] font-semibold">这个站点还没有站牌</div>
                <Button variant="primary" onClick={(e) => { e.stopPropagation(); setTpl(true) }}><Layers size={14} /> 从模板添加站架</Button>
              </div>
            )}
          </div>
          {ed.sel && (
            <div className="gt-rise absolute right-4 top-4 z-10 flex max-h-[calc(100%-32px)] w-[300px] flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline">
              <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
                <span className="text-[12.5px] font-semibold text-ink-2">属性</span>
                <div className="flex items-center">
                  {selBoard?.kind === '整版' && (
                    <IconButton label="自动排序" className="size-7" onClick={() => ed.ops.autoSort(selBoard.id)}><ArrowDownUp size={14} /></IconButton>
                  )}
                  <IconButton label="关闭属性" className="size-7" onClick={() => ed.setSel(null)}><X size={14} /></IconButton>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto [&>aside]:w-full [&>aside]:border-0">
                <Inspector ed={ed} />
              </div>
            </div>
          )}
        </div>
        <Tray ed={ed} dragging={!!dnd.active} open={trayOpen} onToggle={() => setTrayOpen((o) => !o)} />
      </div>
      <DragOverlay dropAnimation={null}>
        {dnd.active && (
          <div className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3 shadow-pop ring-2 ring-accent">
            <PassageLabel item={dnd.active.item} />
          </div>
        )}
      </DragOverlay>
      <TemplateDialog open={tpl} onClose={() => setTpl(false)} title="从站架模板添加" onPick={(t) => ed.ops.addShelf(t.id)} />
    </DndContext>
  )
}
