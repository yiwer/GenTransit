// PROTOTYPE — 编辑器变体 A：结构示意图（需求 Q26 原方案）。左线路池 · 中按比例绘制的站架/站牌/插片 · 右属性面板
import { DndContext, DragOverlay, pointerWithin, rectIntersection, useDraggable, useDroppable, type CollisionDetection } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, GripVertical, Layers, MoreHorizontal, Plus, X, ZoomIn } from 'lucide-react'
import { useState } from 'react'
import type { Board, Schedule, Shelf } from '../../data/types'
import { cnNum, keyOf, STATUS_ORDER, type PoolItem, type ScheduleStatus } from '../../lib/domain'
import { Button, IconButton, MenuItem, Popover, RoutePlate, Tag, cn, statusClass, statusDot } from '../../ui'
import * as M from './model'
import { EditorHeader, Inspector, PassageLabel, PlaceMenu, TemplateDialog } from './parts'
import { useEditorDnd, type Editor } from './useEditor'

export const preferInner: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length) {
    const inner = within.find((c) => String(c.id).startsWith('sch:') || String(c.id).startsWith('slot:'))
    return [inner ?? within[0]]
  }
  return rectIntersection(args)
}

const whereText = (ed: Editor, item: PoolItem) =>
  item.schedules
    .map((s) => {
      if (s.place.type === 'board') {
        const b = M.findBoard(ed.draft, s.place.boardId)
        return b ? `${cnNum(b.board.no)}号牌` : ''
      }
      if (s.place.type === 'slot') {
        const f = M.findSlot(ed.draft, s.place.slotId)
        return f ? `${cnNum(f.board.no)}号牌·${f.slot.no}` : ''
      }
      return ''
    })
    .filter(Boolean)
    .join('、')

function PoolRow({ ed, item }: { ed: Editor; item: PoolItem }) {
  const disabled = item.status === '失效'
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool:${item.key}`, disabled })
  return (
    <li ref={setNodeRef} className={cn('group flex items-center gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-surface-2', isDragging && 'opacity-40')}>
      <button {...listeners} {...attributes} aria-label={`拖动 ${item.lineName}`} disabled={disabled} className="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center text-fg-3 disabled:cursor-default disabled:opacity-30">
        <GripVertical size={14} />
      </button>
      <span className={cn('size-2 shrink-0 rounded-full', statusDot(item.status))} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <PassageLabel item={item} />
        {item.status === '已编排' && <span className="block truncate text-[11.5px] text-fg-3">在 {whereText(ed, item)}</span>}
        {item.status === '失效' && <span className="block text-[11.5px] text-st-bad">线路已不经过本站（停运或站序调整）</span>}
      </span>
      <PlaceMenu ed={ed} item={item} trigger={(t) => <IconButton label={`${item.lineName} 的操作`} className="size-7 opacity-70 group-hover:opacity-100" onClick={t}><MoreHorizontal size={15} /></IconButton>} />
    </li>
  )
}

function PoolGroup({ ed, status, items }: { ed: Editor; status: ScheduleStatus; items: PoolItem[] }) {
  const [open, setOpen] = useState(status !== '已编排' || items.length < 8)
  const { setNodeRef, isOver } = useDroppable({ id: status === '隐藏' ? 'hidden' : `group:${status}`, disabled: status !== '隐藏' })
  return (
    <section ref={setNodeRef} className={cn('rounded-lg', isOver && 'bg-st-hide-bg ring-2 ring-st-hide-line')}>
      <header className="flex h-8 items-center gap-1.5 px-1.5">
        <button className="flex flex-1 items-center gap-1.5 text-left text-[12.5px] font-semibold text-fg" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDown size={14} className={cn('text-fg-3 transition-transform', !open && '-rotate-90')} />
          <span className={cn('inline-flex h-5 items-center rounded-full border px-1.5 text-[11px]', statusClass(status))}>{status}</span>
          <span className="text-fg-3 tabular-nums">{items.length}</span>
        </button>
        {status === '失效' && items.length > 0 && (
          <Button size="sm" variant="ghost" className="text-st-bad" onClick={() => ed.ops.clearInvalid()}>全部清理</Button>
        )}
      </header>
      {open && (
        <ul className="pb-1">
          {items.map((it) => <PoolRow key={it.key} ed={ed} item={it} />)}
          {items.length === 0 && (
            <li className="px-7 py-1.5 text-xs text-fg-3">{status === '隐藏' ? '拖到这里即隐藏' : status === '待编排' ? '全部经过本站的线路都已处理' : '无'}</li>
          )}
        </ul>
      )}
    </section>
  )
}

function Pool({ ed }: { ed: Editor }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })
  return (
    <aside ref={setNodeRef} className={cn('flex w-[310px] shrink-0 flex-col border-r border-line bg-surface', isOver && 'bg-primary-soft')}>
      <div className="border-b border-line px-4 py-3">
        <div className="text-sm font-semibold">本站线路</div>
        <div className="text-xs text-fg-3">拖到站牌上，或点 ⋯ 选择"放到…"。把站牌上的线路拖回这里即移除。</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {STATUS_ORDER.map((st) => (
          <PoolGroup key={st} ed={ed} status={st} items={ed.pool.filter((p) => p.status === st)} />
        ))}
      </div>
    </aside>
  )
}

function Chip({ ed, s, item, dragProps, dragging, compact }: { ed: Editor; s: Schedule; item?: PoolItem; dragProps?: any; dragging?: boolean; compact?: boolean }) {
  const bad = item?.status === '失效'
  return (
    <div className={cn('group/chip flex items-center gap-1 rounded border bg-surface pl-0.5 pr-0.5 shadow-[0_1px_0_rgba(0,0,0,0.03)]', compact ? 'h-[24px]' : 'h-[26px]', bad ? 'border-st-bad-line bg-st-bad-bg' : 'border-line-strong', dragging && 'opacity-40')}>
      <button {...dragProps} aria-label={`拖动 ${s.lineName}`} className="flex h-full w-3.5 shrink-0 cursor-grab items-center justify-center text-fg-3">
        <GripVertical size={12} />
      </button>
      <span className="min-w-0 flex-1 truncate"><RoutePlate name={s.lineName} size="xs" state={bad ? 'invalid' : 'normal'} /></span>
      {(!compact || bad) && <span className={cn('shrink-0 text-[10.5px]', bad ? 'text-st-bad' : 'text-fg-3')}>{bad ? '失效' : s.kind}</span>}
      <IconButton label={`从这块站牌移除 ${s.lineName}`} className="size-5 opacity-0 group-hover/chip:opacity-100 focus:opacity-100" onClick={(e) => { e.stopPropagation(); ed.ops.removeSchedule(s.id) }}>
        <X size={11} />
      </IconButton>
    </div>
  )
}

function SortableChip({ ed, s }: { ed: Editor; s: Schedule }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `sch:${s.id}` })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Chip ed={ed} s={s} item={ed.itemOf(keyOf(s.routeId, s.nth))} dragProps={{ ...attributes, ...listeners }} dragging={isDragging} />
    </div>
  )
}

function SlotBox({ ed, slot, width, height }: { ed: Editor; slot: Board['slots'][number]; width: number; height: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.id}` })
  const s = M.inSlot(ed.draft, slot.id)
  const drag = useDraggable({ id: s ? `sch:${s.id}` : `none:${slot.id}`, disabled: !s })
  const selected = ed.sel?.type === 'slot' && ed.sel.id === slot.id
  const nonRoute = slot.kind === '非线路'
  return (
    <div
      ref={setNodeRef}
      onClick={(e) => { e.stopPropagation(); ed.setSel({ type: 'slot', id: slot.id }) }}
      style={{ width, height }}
      className={cn(
        'relative flex cursor-pointer flex-col justify-center rounded-[3px] border px-1 text-[11px]',
        nonRoute ? 'border-dashed border-line-strong bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_6px,var(--surface)_6px_12px)]' : 'border-line-strong bg-surface-2',
        isOver && !nonRoute && 'border-primary bg-primary-soft',
        isOver && nonRoute && 'border-danger',
        selected && 'ring-2 ring-primary',
      )}
    >
      <span className="absolute left-1 top-0.5 text-[10px] text-fg-3">{slot.no}</span>
      {nonRoute ? (
        <span className="text-center text-fg-2">{slot.note || '非线路'}</span>
      ) : s ? (
        <div ref={drag.setNodeRef} className="mt-2">
          <Chip ed={ed} s={s} item={ed.itemOf(keyOf(s.routeId, s.nth))} dragProps={{ ...drag.attributes, ...drag.listeners }} dragging={drag.isDragging} compact />
        </div>
      ) : (
        <span className="text-center text-fg-3">空</span>
      )}
    </div>
  )
}

function BoardBox({ ed, board, scale }: { ed: Editor; board: Board; scale: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `board:${board.id}` })
  const list = M.onBoard(ed.draft, board.id)
  const selected = ed.sel?.type === 'board' && ed.sel.id === board.id
  const w = board.w * scale
  const h = board.h * scale
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={setNodeRef}
        onClick={(e) => { e.stopPropagation(); ed.setSel({ type: 'board', id: board.id }) }}
        style={{ width: w, height: h }}
        className={cn(
          'relative cursor-pointer rounded-[5px] border-[1.5px] bg-surface p-1.5 pt-5 transition-colors',
          board.kind === '分片' ? 'border-fg-3/60' : 'border-fg-3/60',
          isOver && board.kind === '整版' && 'border-primary bg-primary-soft',
          isOver && board.kind === '分片' && 'border-danger',
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface-2)]',
        )}
      >
        <span className="absolute left-1.5 top-1 text-[11px] font-semibold text-fg">{cnNum(board.no)}号牌</span>
        <span className="absolute right-1.5 top-1 text-[10.5px] text-fg-3">{board.face}</span>
        {board.kind === '整版' ? (
          <SortableContext items={list.map((s) => `sch:${s.id}`)} strategy={verticalListSortingStrategy}>
            <div className="flex h-full flex-col gap-[3px] overflow-auto">
              {list.map((s) => <SortableChip key={s.id} ed={ed} s={s} />)}
              {list.length === 0 && <div className="flex flex-1 items-center justify-center rounded border border-dashed border-line-strong text-[11px] text-fg-3">拖入线路</div>}
            </div>
          </SortableContext>
        ) : (
          <div className="flex h-full flex-wrap content-start gap-1 overflow-auto">
            {(() => {
              // 按站牌宽度能并排几片来排插片，插片按比例缩放填满一行
              const inner = w - 15
              const cols = Math.max(1, Math.floor(board.w / Math.max(...board.slots.map((s) => s.w), 1)))
              const cw = (inner - 4 * (cols - 1)) / cols
              return board.slots.map((sl) => <SlotBox key={sl.id} ed={ed} slot={sl} width={cw} height={Math.max(30, sl.h * (cw / sl.w))} />)
            })()}
            {board.slots.length === 0 && <div className="flex size-full items-center justify-center text-[11px] text-fg-3">没有插片</div>}
          </div>
        )}
      </div>
      <span className="text-[11px] text-fg-3 tabular-nums">{board.kind} · {board.w}×{board.h}</span>
    </div>
  )
}

function ShelfFrame({ ed, shelf, scale }: { ed: Editor; shelf: Shelf; scale: number }) {
  const selected = ed.sel?.type === 'shelf' && ed.sel.id === shelf.id
  return (
    <div
      onClick={() => ed.setSel({ type: 'shelf', id: shelf.id })}
      className={cn('flex shrink-0 cursor-pointer flex-col rounded-xl border bg-surface/70 p-3 backdrop-blur-sm', selected ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-line-strong')}
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="text-[14px] font-semibold">{cnNum(shelf.no)}号架</span>
        <span className="text-[12.5px] text-fg-2">{shelf.type}</span>
        {shelf.name && <span className="text-[12.5px] text-fg-3">· {shelf.name}</span>}
        {shelf.noPhysical && <Tag>无实物</Tag>}
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          <IconButton label={`给${cnNum(shelf.no)}号架添加站牌`} className="size-7" onClick={() => ed.ops.addBoard(shelf.id)}><Plus size={14} /></IconButton>
        </span>
      </header>
      <div className="flex items-end gap-5">
        {shelf.boards.map((b) => <BoardBox key={b.id} ed={ed} board={b} scale={scale} />)}
        {shelf.boards.length === 0 && (
          <button onClick={(e) => { e.stopPropagation(); ed.ops.addBoard(shelf.id) }} className="flex h-[160px] w-[120px] items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-fg-3 hover:border-primary hover:text-primary">
            <Plus size={14} /> 添加站牌
          </button>
        )}
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-[repeating-linear-gradient(90deg,var(--line-strong)_0_8px,transparent_8px_12px)]" aria-hidden="true" />
    </div>
  )
}

export function EditorA({ ed }: { ed: Editor }) {
  const dnd = useEditorDnd(ed)
  const [scale, setScale] = useState(0.15)
  const [tpl, setTpl] = useState(false)
  return (
    <DndContext sensors={dnd.sensors} collisionDetection={preferInner} onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onDragCancel={dnd.onDragCancel}>
      <div className="flex h-full flex-col">
        <EditorHeader ed={ed} />
        <div className="flex min-h-0 flex-1">
          <Pool ed={ed} />
          <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
            <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
              <Popover trigger={({ toggle }) => <Button size="sm" onClick={toggle}><Plus size={13} /> 添加站架</Button>} width={200}>
                {(close) => (
                  <>
                    <MenuItem onClick={() => { close(); setTpl(true) }}><Layers size={14} /> 从模板添加…</MenuItem>
                    <MenuItem onClick={() => { close(); ed.ops.addShelf() }}><Plus size={14} /> 空白站架</MenuItem>
                  </>
                )}
              </Popover>
              <span className="text-xs text-fg-3">按实际宽高比例绘制 · 点选查看属性</span>
              <label className="ml-auto flex items-center gap-2 text-xs text-fg-2">
                <ZoomIn size={14} /> 比例
                <input type="range" min={0.09} max={0.24} step={0.01} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-28 accent-[var(--primary)]" aria-label="示意图比例" />
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(var(--line)_1px,transparent_1px)] [background-size:16px_16px]" onClick={() => ed.setSel(null)}>
              <div className="flex min-h-full items-start gap-6 p-6">
                {ed.draft.shelves.map((sh) => <ShelfFrame key={sh.id} ed={ed} shelf={sh} scale={scale} />)}
                {ed.draft.shelves.length === 0 && (
                  <div className="m-auto flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-8 text-center">
                    <div className="text-[15px] font-semibold">这个站点还没有站架</div>
                    <p className="max-w-[280px] text-[13px] text-fg-3">从站架模板一键生成站架和站牌结构，或先添加一个空白站架。</p>
                    <div className="flex gap-2">
                      <Button variant="primary" onClick={(e) => { e.stopPropagation(); setTpl(true) }}><Layers size={14} /> 从模板添加</Button>
                      <Button onClick={(e) => { e.stopPropagation(); ed.ops.addShelf() }}>空白站架</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          <Inspector ed={ed} />
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dnd.active && (
          <div className="flex h-[30px] items-center gap-2 rounded-md border border-primary bg-surface px-2.5 shadow-[var(--shadow-pop)]">
            <PassageLabel item={dnd.active.item} terminal={false} size="sm" />
          </div>
        )}
      </DragOverlay>
      <TemplateDialog open={tpl} onClose={() => setTpl(false)} title="从站架模板添加" onPick={(t) => ed.ops.addShelf(t.id)} />
    </DndContext>
  )
}
