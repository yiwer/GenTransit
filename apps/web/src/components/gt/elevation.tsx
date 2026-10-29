// 站台立面（M3 计划 4.1）：编辑器、预览抽屉、站点详情、站架模板共用。从原型 EditorElevation、parts 按正式规范重写。
// 站架从左到右排开、按容器宽度折行；站牌画成实物：浅金属边框、墨绿牌头、虚线分隔的线路行；插片是嵌入面板。
// 只读模式只画；编辑模式（传 edit）提供放置目标、选中与菜单，拖放由外层 DndContext 处理
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BOARD_FACE_LABEL,
  BOARD_KIND_LABEL,
  ROUTE_KIND_LABEL,
  boardLabel,
  cnNum,
  inSlot,
  keyOf,
  onBoard,
  passageLabel,
  shelfLabel,
  type BoardDraft,
  type PoolItem,
  type RouteKind,
  type ScheduleDraft,
  type ShelfDraft,
  type SignSetDraft,
  type SlotDraft,
} from '@gentransit/shared'
import { GripVertical, Plus, X } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn, useStored } from '@/lib/utils'
import { RoutePlate } from './symbols'

export type Zoom = 'compact' | 'standard' | 'large'
/** 最高一块站牌显示多高（px） */
export const ZOOM_PX: Record<Zoom, number> = { compact: 230, standard: 320, large: 430 }
export const ZOOM_LABEL: Record<Zoom, string> = { compact: '紧凑', standard: '标准', large: '大' }
/** 比例档位记在本浏览器 */
export const useStoredZoom = () => useStored<Zoom>('gt-elev-zoom', 'standard')

export const KIND_MARK: Record<RouteKind, string> = {
  up: '↑',
  down: '↓',
  inner: '⟳',
  outer: '⟲',
  loop: '⟳',
  oneway: '→',
}

const POST_MM = 420 // 站牌下沿到地面（示意）
const GAP_MM = 120 // 同一站架内站牌间距
const shelfWidthMm = (sh: Pick<ShelfDraft, 'boards'>) =>
  sh.boards.reduce((n, b) => n + b.width, 0) + GAP_MM * Math.max(0, sh.boards.length - 1) + 240

export type Sel = { type: 'shelf' | 'board' | 'slot'; id: string }

export interface ElevationEdit {
  sel: Sel | null
  onSelect: (s: Sel | null) => void
  onRemove: (scheduleId: string) => void
  onAddBoard: (shelfId: string) => void
  /** Alt+↑/↓ 在整版站牌内调整顺序 */
  onMove: (scheduleId: string, delta: number) => void
  /** 线路行、插片里的"…"菜单 */
  menu: (s: ScheduleDraft, item: PoolItem | undefined) => ReactNode
  /** 正在拖动：放置目标显出轮廓 */
  dragging: boolean
}

interface Ctx {
  draft: Pick<SignSetDraft, 'shelves' | 'schedules'>
  itemOf: (s: ScheduleDraft) => PoolItem | undefined
  edit?: ElevationEdit
  bare: boolean
}
const ElevCtx = createContext<Ctx | null>(null)
const useElev = () => useContext(ElevCtx)!

/* ---------------- 线路行与插片 ---------------- */

/** 线路行按牌面宽度分三级：窄 = 线路牌 + 方向；中 = 再加终点站；宽 = 序号 + "开往"全文 */
function SignRow({ s, index, width }: { s: ScheduleDraft; index: number; width: number }) {
  const { itemOf, edit } = useElev()
  const sortable = useSortable({ id: `sch:${s.id}`, disabled: !edit })
  const item = itemOf(s)
  const bad = item?.status === 'invalid'
  const level = width < 160 ? 'narrow' : width < 290 ? 'mid' : 'wide'
  const name = item?.lineName ?? '?'
  const label = item ? passageLabel(item) : name
  const tip = `${label}${bad ? ' · 已不经过本站' : item ? ` · 开往 ${item.terminal}` : ''}`
  return (
    <div
      ref={sortable.setNodeRef}
      title={tip}
      tabIndex={edit ? 0 : undefined}
      aria-label={edit ? `${label}，第 ${index + 1} 位${bad ? '，失效' : ''}。Alt+↑↓ 调整顺序` : undefined}
      onKeyDown={(e) => {
        if (!edit || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        edit.onMove(s.id, e.key === 'ArrowUp' ? -1 : 1)
      }}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn(
        'group/row relative flex shrink-0 items-center border-b border-dashed border-hairline-2 last:border-b-0 focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-accent',
        level === 'wide' ? 'h-11 gap-2 pl-1.5 pr-2' : 'h-9 gap-1.5 px-1',
        bad && 'bg-danger-soft/70',
        sortable.isDragging && 'z-10 rounded-lg bg-surface opacity-60 shadow-pop',
      )}
      data-testid="sign-row"
    >
      {edit && (
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          tabIndex={-1}
          aria-label={`拖动 ${label}`}
          className="flex h-full w-4 shrink-0 cursor-grab items-center justify-center text-ink-4 opacity-40 group-hover/row:opacity-100"
        >
          <GripVertical size={13} />
        </button>
      )}
      {level === 'wide' && (
        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-ink-4">{index + 1}</span>
      )}
      <RoutePlate
        name={name}
        size={level === 'wide' ? 'md' : 'sm'}
        state={bad ? (item?.suspended ? 'suspended' : 'invalid') : 'normal'}
      />
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] text-ink-2"
        title={item ? ROUTE_KIND_LABEL[item.kind] : undefined}
      >
        {item ? KIND_MARK[item.kind] : '·'}
      </span>
      {level !== 'narrow' && (
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
          {bad ? (
            <span className="text-[12px] text-danger line-through decoration-1">
              {level === 'wide' ? (item?.suspended ? '线路停运' : '已不经过本站') : '失效'}
            </span>
          ) : (
            <>
              {level === 'wide' && <span className="text-[11.5px] text-ink-3">开往 </span>}
              <span
                className={cn(
                  'font-display font-semibold text-ink',
                  level === 'wide' ? 'text-[14px]' : 'text-[12.5px]',
                )}
              >
                {item?.terminal}
              </span>
              {item && (item.count > 1 || item.pass > 1) && (
                <span className="ml-1 rounded bg-sunken px-1 text-[10.5px] text-ink-3">第{item.pass}次</span>
              )}
            </>
          )}
        </span>
      )}
      {edit && (
        // 操作浮在行尾，悬停或聚焦才出现，不占布局空间
        <span
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0.5 flex items-center gap-0.5 rounded-md bg-gradient-to-l from-surface from-60% to-transparent pl-4 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 group-focus/row:opacity-100"
        >
          {edit.menu(s, item)}
          <button
            type="button"
            aria-label={`从这块牌移除 ${label}`}
            title="移出本牌"
            onClick={() => edit.onRemove(s.id)}
            className="flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
          >
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  )
}

function SignSlot({ slot, w, h }: { slot: SlotDraft; w: number; h: number }) {
  const { draft, itemOf, edit, bare } = useElev()
  const drop = useDroppable({ id: `slot:${slot.id}`, disabled: !edit })
  const s = inSlot(draft, slot.id)
  const drag = useDraggable({ id: s ? `sch:${s.id}` : `none:${slot.id}`, disabled: !edit || !s })
  const item = s ? itemOf(s) : undefined
  const other = slot.kind === 'other'
  const small = w < 140 || h < 64
  const selected = edit?.sel?.type === 'slot' && edit.sel.id === slot.id
  const bad = item?.status === 'invalid'
  return (
    <div
      ref={drop.setNodeRef}
      onClick={
        edit
          ? (e) => {
              e.stopPropagation()
              edit.onSelect({ type: 'slot', id: slot.id })
            }
          : undefined
      }
      style={{ width: w, height: h }}
      title={other ? `${slot.no}号插片 · ${slot.note || '非线路'}` : `${slot.no}号插片`}
      className={cn(
        'group/slot relative flex flex-col justify-center rounded-md transition-all duration-200',
        small ? 'px-1.5 pt-2.5' : 'px-2.5 pt-3',
        other
          ? 'bg-[repeating-linear-gradient(135deg,var(--sunken)_0_6px,var(--surface-2)_6px_12px)] ring-1 ring-inset ring-hairline-2'
          : s
            ? 'bg-surface shadow-xs ring-1 ring-hairline'
            : 'border border-dashed border-hairline-2 bg-surface/50',
        edit && 'cursor-pointer',
        edit?.dragging && !other && !s && 'border-accent/50',
        drop.isOver && !other && 'scale-[1.03] bg-accent-soft ring-2 ring-accent',
        drop.isOver && other && 'ring-2 ring-danger',
        selected && 'ring-2 ring-coral',
      )}
      data-testid="sign-slot"
    >
      {/* 插片编号小标签，像实物插片上的号码牌 */}
      <span className="absolute left-1.5 top-0 rounded-b-[4px] bg-plate px-1 text-[9.5px] font-semibold leading-[14px] text-plate-ink">
        {slot.no}
      </span>
      {bare ? null : other ? (
        <span className={cn('truncate text-center leading-tight text-ink-2', small ? 'text-[10.5px]' : 'text-[12px]')}>
          {slot.note || '非线路'}
        </span>
      ) : s ? (
        <div
          ref={drag.setNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          className={cn('flex min-w-0 items-center gap-1.5', edit && 'cursor-grab', drag.isDragging && 'opacity-40')}
        >
          <RoutePlate
            name={item?.lineName ?? '?'}
            size={small ? 'sm' : 'md'}
            state={bad ? (item?.suspended ? 'suspended' : 'invalid') : 'normal'}
          />
          {!small && item && (
            <span
              className={cn('min-w-0 truncate whitespace-nowrap text-[11.5px]', bad ? 'text-danger' : 'text-ink-3')}
            >
              {KIND_MARK[item.kind]} {bad ? '失效' : item.terminal}
            </span>
          )}
          {edit && (
            <span
              className="ml-auto hidden items-center group-hover/slot:flex"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {edit.menu(s, item)}
              <button
                type="button"
                aria-label={`移出插片 ${item ? passageLabel(item) : ''}`}
                onClick={() => edit.onRemove(s.id)}
                className="flex size-5 items-center justify-center rounded text-ink-4 hover:text-ink"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      ) : (
        <span className={cn('text-center text-ink-4', small ? 'text-[10.5px]' : 'text-[11.5px]')}>空</span>
      )}
    </div>
  )
}

/* ---------------- 站牌 ---------------- */

function SignBoard({ board, scale, ghost }: { board: BoardDraft; scale: number; ghost: boolean }) {
  const { draft, edit, bare } = useElev()
  const drop = useDroppable({ id: `board:${board.id}`, disabled: !edit })
  const list = onBoard(draft, board.id)
  const W = Math.max(36, board.width * scale)
  const H = Math.max(48, board.height * scale)
  const selected = edit?.sel?.type === 'board' && edit.sel.id === board.id
  const frame = bare ? 3 : 5
  const head = bare ? 12 : 30
  const innerW = W - frame * 2
  const whole = board.kind === 'whole'
  const count = whole ? list.length : board.slots.filter((sl) => inSlot(draft, sl.id)).length
  // 插片按最宽的一个排列列数，等比缩放
  const cols = Math.max(1, Math.floor(board.width / Math.max(...board.slots.map((s) => s.width), 1)))
  const pad = bare ? 3 : 8
  const cw = (innerW - pad * 2 - 6 * (cols - 1)) / cols
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={drop.setNodeRef}
        onClick={
          edit
            ? (e) => {
                e.stopPropagation()
                edit.onSelect({ type: 'board', id: board.id })
              }
            : undefined
        }
        style={{ width: W, height: H, padding: frame }}
        className={cn(
          'relative rounded-[12px] transition-[box-shadow,transform] duration-300 ease-[var(--spring)]',
          ghost
            ? 'bg-surface/60 ring-1 ring-dashed ring-hairline-2 [outline:1.5px_dashed_var(--hairline-2)]'
            : 'bg-[linear-gradient(160deg,var(--surface)_0%,var(--sunken)_55%,var(--surface-2)_100%)] shadow-float ring-1 ring-hairline-2',
          edit && 'cursor-pointer',
          edit?.dragging && whole && 'ring-accent/40',
          drop.isOver && whole && '-translate-y-1 ring-2 ring-accent',
          selected && 'shadow-pop ring-2 ring-coral',
        )}
        data-testid="sign-board"
        aria-label={`${boardLabel(board.no)}，${BOARD_FACE_LABEL[board.face]}，${BOARD_KIND_LABEL[board.kind]}，${count} 条线路`}
      >
        <div className="flex h-full flex-col overflow-hidden rounded-[8px] bg-surface ring-1 ring-hairline">
          {/* 牌头按宽度分级：宽 = 编号 + 面 + 类型与数量；中 = 编号 + 数量；窄 = 只有编号 */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap bg-plate text-plate-ink',
              innerW < 110 ? 'justify-center px-1' : 'px-2.5',
            )}
            style={{ height: head }}
          >
            {!bare && (
              <>
                <span className="font-display text-[13.5px] font-bold">
                  {innerW < 110 ? cnNum(board.no) : boardLabel(board.no)}
                </span>
                {innerW >= 170 && (
                  <span className="rounded-[4px] bg-plate-ink/15 px-1 text-[10.5px] leading-4">
                    {BOARD_FACE_LABEL[board.face]}
                  </span>
                )}
                {innerW >= 110 && (
                  <span className="ml-auto text-[10.5px] opacity-75">
                    {innerW >= 170 ? `${BOARD_KIND_LABEL[board.kind]} · ${count}` : count}
                  </span>
                )}
              </>
            )}
          </div>
          {whole ? (
            <SortableContext items={list.map((s) => `sch:${s.id}`)} strategy={verticalListSortingStrategy}>
              <div className="flex min-h-0 flex-1 flex-col overflow-auto px-1.5 py-1">
                {bare
                  ? list.map((s) => <span key={s.id} className="my-[2px] h-[3px] w-2/3 rounded-full bg-plate/40" />)
                  : list.map((s, i) => <SignRow key={s.id} s={s} index={i} width={innerW} />)}
                {!bare && list.length === 0 && (
                  <div
                    className={cn(
                      'm-1 flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-2 text-center text-ink-4',
                      innerW < 110 ? 'text-[10.5px]' : 'text-[12px]',
                    )}
                  >
                    {edit ? (innerW < 110 ? '拖入' : '拖线路到这里') : '空'}
                  </div>
                )}
              </div>
            </SortableContext>
          ) : (
            <div
              className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-auto bg-sunken/60"
              style={{ padding: pad }}
            >
              {board.slots.map((sl) => (
                <SignSlot key={sl.id} slot={sl} w={cw} h={Math.max(bare ? 8 : 40, sl.height * (cw / sl.width))} />
              ))}
            </div>
          )}
        </div>
        {drop.isOver && whole && (
          <div className="pointer-events-none absolute inset-x-0 -top-7 text-center text-[11.5px] font-medium text-accent">
            松手放到{boardLabel(board.no)}
          </div>
        )}
      </div>
      {!bare && (
        <span className="text-[11px] tabular-nums text-ink-3">
          {board.width}×{board.height}
        </span>
      )}
    </div>
  )
}

/* ---------------- 站架 ---------------- */

function SignShelf({ shelf, scale }: { shelf: ShelfDraft; scale: number }) {
  const { edit, bare } = useElev()
  // 站架类型是可改名的字典：名称含"候车亭"画顶棚，含"单立柱"画一根立柱（默认决定 16）
  const shelter = shelf.typeName.includes('候车亭')
  const single = shelf.typeName.includes('单立柱')
  const w = shelfWidthMm(shelf) * scale
  const selected = edit?.sel?.type === 'shelf' && edit.sel.id === shelf.id
  const ghost = shelf.noPhysical
  const post = (
    <span
      className={cn(
        'w-[8px] rounded-t-[2px]',
        ghost
          ? 'border-x-[1.5px] border-dashed border-ink-4'
          : 'bg-[linear-gradient(90deg,var(--ink-2),var(--ink-4)_45%,var(--ink-2))]',
      )}
      style={{ height: POST_MM * scale }}
    />
  )
  return (
    <div className="group/shelf flex shrink-0 flex-col items-center" style={{ minWidth: w }} data-testid="sign-shelf">
      {shelter && (
        <div
          className={cn(
            'relative mb-2 rounded-[6px]',
            ghost
              ? 'border-[1.5px] border-dashed border-ink-4'
              : 'bg-[linear-gradient(180deg,var(--plate),color-mix(in_oklab,var(--plate)_70%,black))] shadow-xs',
          )}
          style={{ width: w + 36, height: bare ? 6 : 16 }}
        />
      )}
      <div className="flex items-end" style={{ gap: GAP_MM * scale }}>
        {shelf.boards.map((b) => (
          <SignBoard key={b.id} board={b} scale={scale} ghost={ghost} />
        ))}
        {edit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              edit.onAddBoard(shelf.id)
            }}
            aria-label={`给${shelfLabel(shelf.no)}加站牌`}
            title="加站牌"
            className={cn(
              'mb-5 flex items-center justify-center rounded-[10px] border-2 border-dashed border-hairline-2 text-ink-4 transition-opacity hover:border-accent hover:text-accent focus-visible:opacity-100',
              shelf.boards.length ? 'w-8 opacity-0 group-hover/shelf:opacity-100' : 'opacity-100',
            )}
            style={{ height: 900 * scale, width: shelf.boards.length ? undefined : 600 * scale }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className={cn('flex w-full', single ? 'justify-center' : 'justify-between px-[12%]')}>
        {post}
        {!single && post}
      </div>
      <div
        className="h-[4px] rounded-full bg-[linear-gradient(90deg,transparent,var(--ink-3)_12%,var(--ink-3)_88%,transparent)] opacity-50"
        style={{ width: w + 70 }}
      />
      {!bare && (
        <button
          type="button"
          disabled={!edit}
          onClick={(e) => {
            e.stopPropagation()
            edit?.onSelect({ type: 'shelf', id: shelf.id })
          }}
          className={cn(
            'mt-2.5 flex max-w-full items-center gap-1.5 truncate rounded-full px-3 py-1 text-[12.5px] transition-colors disabled:cursor-default',
            selected
              ? 'bg-coral text-paper'
              : 'bg-surface text-ink-2 shadow-xs ring-1 ring-hairline enabled:hover:text-ink',
          )}
        >
          <b className="font-display">{shelfLabel(shelf.no)}</b> {shelf.typeName}
          {shelf.name && <span className={selected ? 'text-paper/80' : 'text-ink-3'}>· {shelf.name}</span>}
          {shelf.noPhysical && (
            <span className={cn('rounded px-1 text-[10.5px]', selected ? 'bg-paper/20' : 'bg-sunken text-ink-3')}>
              无实物
            </span>
          )}
        </button>
      )}
    </div>
  )
}

/* ---------------- 立面 ---------------- */

/** 容器宽度（站架按宽度折行、按宽度限制比例） */
function useWidth<T extends HTMLElement>(fallback = 1000) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, w] as const
}

export interface ElevationProps {
  draft: Pick<SignSetDraft, 'shelves' | 'schedules'>
  pool: PoolItem[]
  zoom?: Zoom
  /** 固定最高站牌的显示高度（缩略图） */
  height?: number
  edit?: ElevationEdit
  /** 缩略图：不画文字 */
  bare?: boolean
  className?: string
  empty?: ReactNode
}

export function Elevation({
  draft,
  pool,
  zoom = 'standard',
  height,
  edit,
  bare = false,
  className,
  empty,
}: ElevationProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const byKey = useMemo(() => new Map(pool.map((p) => [p.key, p])), [pool])
  const shelves = draft.shelves
  const maxH = Math.max(...shelves.flatMap((sh) => sh.boards.map((b) => b.height)), 900)
  const widest = Math.max(...shelves.map(shelfWidthMm), 1)
  // 按档位决定最高站牌的显示高度；再保证最宽的站架一行放得下。多个站架按宽度自动折行
  const scale = Math.max(0.02, Math.min((height ?? ZOOM_PX[zoom]) / maxH, (width - (bare ? 16 : 80)) / widest))
  const ctx: Ctx = { draft, itemOf: (s) => byKey.get(keyOf(s)), edit, bare }
  const body = (
    <div ref={ref} className={cn('w-full', className)}>
      {shelves.length ? (
        <div
          className={cn(
            'flex flex-wrap items-end justify-center',
            bare ? 'gap-x-4 gap-y-3 p-2' : 'gap-x-14 gap-y-12 px-6 pb-8 pt-8',
          )}
        >
          {shelves.map((sh) => (
            <SignShelf key={sh.id} shelf={sh} scale={scale} />
          ))}
        </div>
      ) : (
        empty
      )}
    </div>
  )
  return (
    <ElevCtx.Provider value={ctx}>
      {/* 只读时也包一层 DndContext：拖放钩子处于禁用状态 */}
      {edit ? body : <DndContext>{body}</DndContext>}
    </ElevCtx.Provider>
  )
}

/** 线路标签：线路牌 + 走向 + 第几次 + 开往 */
export function PassageLabel({
  item,
  terminal = true,
  size = 'md',
}: {
  item: Pick<PoolItem, 'lineName' | 'kind' | 'pass' | 'count' | 'terminal' | 'status' | 'suspended'>
  terminal?: boolean
  size?: 'sm' | 'md'
}) {
  const bad = item.status === 'invalid'
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <RoutePlate
        name={item.lineName}
        size={size === 'md' ? 'md' : 'sm'}
        state={bad ? (item.suspended ? 'suspended' : 'invalid') : 'normal'}
      />
      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-ink-2">
        {KIND_MARK[item.kind]} {ROUTE_KIND_LABEL[item.kind]}
        {(item.count > 1 || item.pass > 1) && (
          <span className="ml-1 rounded bg-sunken px-1 text-[10.5px]">第 {item.pass} 次</span>
        )}
      </span>
      {terminal && item.terminal && !bad && (
        <span className="truncate whitespace-nowrap text-[11.5px] text-ink-3">开往 {item.terminal}</span>
      )}
    </span>
  )
}
