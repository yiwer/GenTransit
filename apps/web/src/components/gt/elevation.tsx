// 站台立面（M3 计划 4.1，M7 计划 5.2）：编辑器、预览抽屉、站点详情、站架模板共用。
// 站架从左到右排开、按容器宽度折行；每个站架按站架类型画出结构（shelf-model 算出、shelf-art 画成 SVG），
// 各面按类型里的顺序展开，站牌是绝对定位到挂牌位置的 DOM：浅金属边框、墨绿牌头、虚线分隔的线路行；插片是嵌入面板。
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
  type BoardFace,
  type PoolItem,
  type ScheduleDraft,
  type ShelfDraft,
  type ShelfTypeItem,
  type SignSetDraft,
  type SlotDraft,
} from '@gentransit/shared'
import { GripVertical, Plus, TriangleAlert, X } from 'lucide-react'
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn, useStored } from '@/lib/utils'
import { buildShelfModel, shelfFacesOf, type FaceModel, type ShelfModel } from '@/shelf-model'
import { KIND_MARK } from '@/shelf-model/board-content'
import { ShelfFaceArt, specOfType } from './shelf-art'
import { RoutePlate } from './symbols'

export type Zoom = 'compact' | 'standard' | 'large'
/** 最高一块站牌显示多高（px） */
export const ZOOM_PX: Record<Zoom, number> = { compact: 230, standard: 320, large: 430 }
export const ZOOM_LABEL: Record<Zoom, string> = { compact: '紧凑', standard: '标准', large: '大' }
/** 比例档位记在本浏览器 */
export const useStoredZoom = () => useStored<Zoom>('gt-elev-zoom', 'standard')

export { KIND_MARK }

/** 一个站架各面之间的折线（px） */
const FOLD_PX = 18

/** 立面里一个站架的模型：按站架类型与站牌算出（M7 计划第 4 节） */
export function shelfModelOf(shelf: Pick<ShelfDraft, 'typeId' | 'noPhysical' | 'boards'>, types: ShelfTypeItem[]) {
  return buildShelfModel(specOfType(types, shelf.typeId), shelfFacesOf(shelf.boards), { ghost: shelf.noPhysical })
}

export type Sel = { type: 'shelf' | 'board' | 'slot'; id: string }

export interface ElevationEdit {
  sel: Sel | null
  onSelect: (s: Sel | null) => void
  onRemove: (scheduleId: string) => void
  onAddBoard: (shelfId: string, face: BoardFace) => void
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
  const W = Math.max(bare ? 4 : 36, board.width * scale)
  const H = Math.max(bare ? 6 : 48, board.height * scale)
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
    <>
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
        // 尺寸像制图里的标注，挂在牌下沿
        <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface/85 px-1.5 text-[10.5px] leading-4 tabular-nums text-ink-3 ring-1 ring-hairline">
          {board.width}×{board.height}
        </span>
      )}
    </>
  )
}

/* ---------------- 站架 ---------------- */

/** 一个面：结构层 SVG 在下，站牌按挂牌位置绝对定位在上 */
function ShelfFace({
  shelf,
  model,
  face,
  scale,
  label,
}: {
  shelf: ShelfDraft
  model: ShelfModel
  face: FaceModel
  scale: number
  label: boolean
}) {
  const { edit, bare } = useElev()
  const boards = new Map(shelf.boards.map((b) => [b.id, b]))
  const last = face.mounts.at(-1)
  const bottom = model.bottom
  const ghost = shelf.noPhysical
  return (
    <div
      className="relative shrink-0"
      style={{ width: face.width * scale, height: face.height * scale }}
      data-testid="shelf-face"
      data-face={face.face}
      aria-label={label ? face.label : undefined}
    >
      <ShelfFaceArt face={face} ghost={ghost} className="absolute inset-0 size-full" />
      {face.mounts.map((m) => {
        const b = boards.get(m.boardId)
        return (
          b && (
            <div key={m.boardId} className="absolute" style={{ left: m.x * scale, bottom: m.y * scale }}>
              <SignBoard board={b} scale={scale} ghost={ghost} />
            </div>
          )
        )
      })}
      {edit && face.face !== 'other' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            edit.onAddBoard(shelf.id, face.face as BoardFace)
          }}
          aria-label={`给${shelfLabel(shelf.no)}${label ? `的${face.label}` : ''}加站牌`}
          title={label ? `${face.label}加站牌` : '加站牌'}
          className={cn(
            'absolute flex items-center justify-center rounded-[10px] border-2 border-dashed border-hairline-2 bg-surface/40 text-ink-4 transition-opacity hover:border-accent hover:text-accent focus-visible:opacity-100',
            last ? 'w-8 opacity-0 group-hover/shelf:opacity-100' : 'opacity-100',
          )}
          style={
            last
              ? { left: (last.x + last.w) * scale + 8, bottom: bottom * scale, height: 900 * scale }
              : {
                  left: (face.width / 2 - 300) * scale,
                  bottom: bottom * scale,
                  width: 600 * scale,
                  height: 900 * scale,
                }
          }
        >
          <Plus size={14} />
        </button>
      )}
      {label && !bare && (
        <span
          className={cn(
            'pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold tracking-[0.08em]',
            face.face === 'other' ? 'text-danger' : 'text-ink-3',
          )}
        >
          {face.label}
        </span>
      )}
    </div>
  )
}

/** 面与面之间的折线：像一张纸折过去 */
function FaceFold({ height }: { height: number }) {
  return (
    <svg width={FOLD_PX} height={height} className="shrink-0 overflow-visible" aria-hidden>
      <path
        d={`M${FOLD_PX / 2} ${height}V${height * 0.16}l-3 -6 6 -6 -3 -6V0`}
        fill="none"
        stroke="var(--hairline-2)"
        strokeWidth={1.2}
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SignShelf({ shelf, model, scale }: { shelf: ShelfDraft; model: ShelfModel; scale: number }) {
  const { edit, bare } = useElev()
  const selected = edit?.sel?.type === 'shelf' && edit.sel.id === shelf.id
  const labelled = model.faces.length > 1 || model.faces[0]?.face !== 'front'
  const tallest = Math.max(...model.faces.map((f) => f.height)) * scale
  return (
    <div
      className="group/shelf flex shrink-0 flex-col items-center"
      data-testid="sign-shelf"
      data-form={model.form}
      onClick={edit ? () => edit.onSelect({ type: 'shelf', id: shelf.id }) : undefined}
    >
      <div className="flex items-end">
        {model.faces.map((f, i) => (
          <Fragment key={f.face}>
            {i > 0 && <FaceFold height={tallest} />}
            <ShelfFace shelf={shelf} model={model} face={f} scale={scale} label={labelled} />
          </Fragment>
        ))}
      </div>
      {!bare && (
        <button
          type="button"
          disabled={!edit}
          onClick={(e) => {
            e.stopPropagation()
            edit?.onSelect({ type: 'shelf', id: shelf.id })
          }}
          title={model.warnings.join('\n') || undefined}
          className={cn(
            'flex max-w-full items-center gap-1.5 truncate rounded-full px-3 py-1 text-[12.5px] transition-colors disabled:cursor-default',
            labelled ? 'mt-7' : 'mt-2.5',
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
          {model.warnings.length > 0 && (
            <TriangleAlert size={12} className={selected ? 'text-paper' : 'text-signal'} aria-label="有提示" />
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
  /** 站架类型列表；还没读到时画占位，避免结构跳动 */
  types: ShelfTypeItem[] | undefined
  zoom?: Zoom
  /** 固定最高站牌的显示高度（缩略图） */
  height?: number
  /** 整个站架（含结构）最多多高（px，缩略图放在固定高度的框里） */
  maxHeight?: number
  edit?: ElevationEdit
  /** 缩略图：不画文字 */
  bare?: boolean
  className?: string
  empty?: ReactNode
}

export function Elevation({
  draft,
  pool,
  types,
  zoom = 'standard',
  height,
  maxHeight,
  edit,
  bare = false,
  className,
  empty,
}: ElevationProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const byKey = useMemo(() => new Map(pool.map((p) => [p.key, p])), [pool])
  const shelves = draft.shelves
  const models = useMemo(() => (types ? shelves.map((sh) => shelfModelOf(sh, types)) : []), [shelves, types])
  const maxH = Math.max(...shelves.flatMap((sh) => sh.boards.map((b) => b.height)), 900)
  // 按档位决定最高站牌的显示高度；再保证最宽的站架（各面加折线）一行放得下。多个站架按宽度自动折行
  const avail = width - (bare ? 16 : 80)
  const fit = Math.min(
    ...models.map((m) => (avail - FOLD_PX * (m.faces.length - 1)) / m.faces.reduce((n, f) => n + f.width, 0)),
  )
  const tall = maxHeight ? maxHeight / Math.max(1, ...models.flatMap((m) => m.faces.map((f) => f.height))) : Infinity
  const scale = Math.max(0.02, Math.min((height ?? ZOOM_PX[zoom]) / maxH, fit, tall))
  const ctx: Ctx = { draft, itemOf: (s) => byKey.get(keyOf(s)), edit, bare }
  const body = (
    <div ref={ref} className={cn('w-full', className)}>
      {shelves.length && !types ? (
        <div
          className="flex items-end justify-center px-6 py-8 text-[12px] text-ink-4"
          style={{ minHeight: (height ?? ZOOM_PX[zoom]) * 1.4 }}
          data-testid="elevation-loading"
        >
          正在读取站架类型…
        </div>
      ) : shelves.length ? (
        <div
          className={cn(
            'flex flex-wrap items-end justify-center',
            bare ? 'gap-x-4 gap-y-3 p-2' : 'gap-x-14 gap-y-12 px-6 pb-8 pt-8',
          )}
        >
          {shelves.map((sh, i) => (
            <SignShelf key={sh.id} shelf={sh} model={models[i]} scale={scale} />
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
