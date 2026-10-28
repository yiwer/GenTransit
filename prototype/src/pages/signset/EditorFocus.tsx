// PROTOTYPE — 编辑器方案 A1「聚焦单牌」：顶部缩略导航看全局（也能直接拖进去），下方一次只放大编辑一块牌，属性写在牌头上
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownUp, ChevronRight, CornerDownLeft, GripVertical, Layers, MoreHorizontal, Plus, Settings2, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Board, BoardFace, Schedule } from '../../data/types'
import { cnNum, keyOf, STATUS_ORDER, type PoolItem } from '../../lib/domain'
import { Button, Drawer, GhostInput, GhostSelect, IconButton, MenuItem, Popover, RoutePlate, Segmented, cn, statusClass, statusDot, useToast } from '../../ui'
import { EmptyShelfArt } from '../../ui/lively'
import { preferInner } from './EditorA'
import * as M from './model'
import { EditorHeader, Inspector, PassageLabel, PlaceMenu, TemplateDialog } from './parts'
import { useEditorDnd, type Editor } from './useEditor'

const FACES: BoardFace[] = ['正面', '背面', 'A面', 'B面', 'C面', 'D面', 'E面', 'F面']

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/* ---------- 顶部缩略导航 ---------- */

function Thumb({ ed, board, scale, active, onPick }: { ed: Editor; board: Board; scale: number; active: boolean; onPick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `thumb:${board.id}` })
  const list = board.kind === '整版' ? M.onBoard(ed.draft, board.id) : board.slots.map((sl) => M.inSlot(ed.draft, sl.id)).filter(Boolean)
  const bad = list.filter((s) => s && ed.itemOf(keyOf(s.routeId, s.nth))?.status === '失效').length
  return (
    <button
      ref={setNodeRef}
      onClick={onPick}
      aria-pressed={active}
      title={`${cnNum(board.no)}号牌 · ${board.face} · ${board.kind}`}
      className={cn(
        'relative flex shrink-0 flex-col items-center gap-1 rounded-xl px-1.5 pb-1 pt-1.5 transition-all duration-300 ease-[var(--spring)]',
        active ? 'bg-surface shadow-float ring-2 ring-accent' : 'hover:bg-surface/70',
        isOver && 'scale-105 bg-accent-soft ring-2 ring-accent',
      )}
    >
      <span className="flex flex-col gap-[2px] overflow-hidden rounded-[3px] bg-surface p-[3px] ring-1 ring-hairline-2" style={{ width: board.w * scale, height: board.h * scale }}>
        {board.kind === '整版'
          ? list.slice(0, 8).map((s, i) => <span key={i} className={cn('h-[4px] rounded-full', bad && i >= list.length - bad ? 'bg-danger/60' : 'bg-plate/70')} />)
          : board.slots.map((sl) => <span key={sl.id} className={cn('h-[6px] rounded-[1px]', sl.kind === '非线路' ? 'bg-sunken' : M.inSlot(ed.draft, sl.id) ? 'bg-plate/70' : 'ring-1 ring-inset ring-hairline-2')} />)}
      </span>
      <span className={cn('text-[11.5px] tabular-nums', active ? 'font-semibold text-ink' : 'text-ink-3')}>
        {cnNum(board.no)}号 · {list.length}
      </span>
      {bad > 0 && <span className="absolute right-1 top-1 size-2 rounded-full bg-danger" />}
    </button>
  )
}

function Navigator({ ed, current, setCurrent, onTemplate }: { ed: Editor; current: string | null; setCurrent: (id: string) => void; onTemplate: () => void }) {
  const all = M.allBoards(ed.draft)
  const maxH = Math.max(...all.map((x) => x.board.h), 1)
  const scale = 64 / maxH
  return (
    <div className="flex shrink-0 items-end gap-5 overflow-x-auto border-b border-hairline bg-surface-2 px-5 pb-2.5 pt-3">
      {ed.draft.shelves.map((sh) => (
        <div key={sh.id} className="flex shrink-0 flex-col gap-1.5">
          <div className="flex items-center gap-1.5 px-1 text-[12px]">
            <span className="font-semibold">{cnNum(sh.no)}号架</span>
            <span className="text-ink-3">{sh.type}</span>
            <IconButton label={`编辑${cnNum(sh.no)}号架`} className="size-6" onClick={() => ed.setSel({ type: 'shelf', id: sh.id })}>
              <Settings2 size={12} />
            </IconButton>
          </div>
          <div className="flex items-end gap-1 rounded-2xl border border-dashed border-hairline-2 p-1">
            {sh.boards.map((b) => <Thumb key={b.id} ed={ed} board={b} scale={scale} active={b.id === current} onPick={() => setCurrent(b.id)} />)}
            <button aria-label={`给${cnNum(sh.no)}号架加站牌`} onClick={() => ed.ops.addBoard(sh.id)} className="flex h-[64px] w-8 items-center justify-center rounded-lg text-ink-4 hover:bg-surface hover:text-accent">
              <Plus size={15} />
            </button>
          </div>
        </div>
      ))}
      <Popover trigger={({ toggle }) => <Button size="sm" variant="ghost" onClick={toggle} className="mb-6"><Plus size={13} /> 站架</Button>} width={190}>
        {(close) => (
          <>
            <MenuItem onClick={() => { close(); onTemplate() }}><Layers size={14} /> 从模板添加…</MenuItem>
            <MenuItem onClick={() => { close(); ed.ops.addShelf() }}><Plus size={14} /> 空白站架</MenuItem>
          </>
        )}
      </Popover>
      <span className="mb-7 ml-auto shrink-0 text-[12px] text-ink-3">把线路拖到缩略图上，也能直接放进去</span>
    </div>
  )
}

/* ---------- 左侧线路池（带"放到当前牌"快捷键） ---------- */

function PoolRow({ ed, item, current }: { ed: Editor; item: PoolItem; current: Board | null }) {
  const bad = item.status === '失效'
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool:${item.key}`, disabled: bad })
  const toast = useToast()
  const quick = () => {
    if (!current) return
    if (current.kind === '整版') return ed.ops.placeOnBoard(item, current.id)
    const empty = M.firstEmptySlot(ed.draft, current.id)
    if (!empty) return toast('当前站牌没有空的线路插片了', 'warn')
    ed.ops.placeOnSlot(item, empty.id)
  }
  const onCurrent = current && item.schedules.some((s) => (s.place.type === 'board' && s.place.boardId === current.id) || (s.place.type === 'slot' && current.slots.some((sl) => sl.id === (s.place as any).slotId)))
  return (
    <li ref={setNodeRef} className={cn('group flex items-center gap-1.5 rounded-xl px-1.5 py-1.5 hover:bg-surface-2', isDragging && 'opacity-40')}>
      <button {...listeners} {...attributes} disabled={bad} aria-label={`拖动 ${item.lineName}`} className="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center text-ink-4 disabled:cursor-default disabled:opacity-30">
        <GripVertical size={14} />
      </button>
      <span className={cn('size-2 shrink-0 rounded-full', statusDot(item.status))} />
      <span className="min-w-0 flex-1">
        <PassageLabel item={item} />
      </span>
      {!bad && current && !onCurrent && (
        <button onClick={quick} className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-accent opacity-0 ring-1 ring-accent/30 transition hover:bg-accent-soft group-hover:opacity-100 focus:opacity-100">
          放入 <CornerDownLeft size={12} />
        </button>
      )}
      {onCurrent && <span className="shrink-0 text-[11.5px] text-sage">已在本牌</span>}
      <PlaceMenu ed={ed} item={item} trigger={(t) => <IconButton label={`${item.lineName} 的操作`} className="size-7 opacity-60 group-hover:opacity-100" onClick={t}><MoreHorizontal size={15} /></IconButton>} />
    </li>
  )
}

function Pool({ ed, current }: { ed: Editor; current: Board | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'pool' })
  const hidden = useDroppable({ id: 'hidden' })
  return (
    <aside ref={setNodeRef} className={cn('flex w-[320px] shrink-0 flex-col border-r border-hairline bg-surface', isOver && 'bg-accent-soft/50')}>
      <div className="px-4 pb-2 pt-3">
        <div className="text-[13px] font-semibold">本站线路</div>
        <div className="text-[12px] text-ink-3">拖到右边的大牌或上方缩略图；或悬停点"放入"</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {STATUS_ORDER.map((st) => {
          const items = ed.pool.filter((p) => p.status === st)
          return (
            <section key={st} ref={st === '隐藏' ? hidden.setNodeRef : undefined} className={cn('mb-1 rounded-xl', st === '隐藏' && hidden.isOver && 'bg-sunken ring-2 ring-ink-4')}>
              <div className="flex h-8 items-center gap-2 px-1.5">
                <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11.5px] font-medium', statusClass(st))}>{st}</span>
                <span className="text-[12px] tabular-nums text-ink-3">{items.length}</span>
                {st === '失效' && items.length > 0 && <button className="ml-auto text-[12px] text-danger hover:underline" onClick={() => ed.ops.clearInvalid()}>全部清理</button>}
              </div>
              <ul>{items.map((it) => <PoolRow key={it.key} ed={ed} item={it} current={current} />)}</ul>
              {items.length === 0 && <div className="px-8 pb-1 text-[12px] text-ink-4">{st === '隐藏' ? '拖到这里即隐藏' : '无'}</div>}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

/* ---------- 大牌 ---------- */

export function BigRow({ ed, s, index, compact }: { ed: Editor; s: Schedule; index: number; compact?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `sch:${s.id}` })
  const item = ed.itemOf(keyOf(s.routeId, s.nth))
  const bad = item?.status === '失效'
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group flex shrink-0 items-center rounded-xl ring-1', compact ? 'h-9 gap-1.5 px-1' : 'h-11 gap-2.5 px-2', bad ? 'bg-danger-soft ring-danger/30' : 'bg-surface ring-hairline', isDragging && 'opacity-40 shadow-pop')}>
      <button {...attributes} {...listeners} aria-label={`拖动 ${s.lineName}`} className="flex h-full w-5 shrink-0 cursor-grab items-center justify-center text-ink-4">
        <GripVertical size={15} />
      </button>
      {!compact && <span className="w-6 text-right text-[12px] tabular-nums text-ink-4">{String(index + 1).padStart(2, '0')}</span>}
      <RoutePlate name={s.lineName} size={compact ? 'sm' : 'md'} state={bad ? 'invalid' : 'normal'} />
      <span className="shrink-0 whitespace-nowrap text-[12px] text-ink-2">{bad && compact ? <span className="text-danger">失效</span> : s.kind}</span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[12.5px] text-ink-3">{compact ? '' : bad ? <span className="text-danger">已不经过本站</span> : item && item.terminal !== '—' ? `开往 ${item.terminal}` : ''}</span>
      <IconButton label={`从这块牌移除 ${s.lineName}`} className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => ed.ops.removeSchedule(s.id)}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

export function BigSlot({ ed, slot, w, h }: { ed: Editor; slot: Board['slots'][number]; w: number; h: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.id}` })
  const s = M.inSlot(ed.draft, slot.id)
  const drag = useDraggable({ id: s ? `sch:${s.id}` : `none:${slot.id}`, disabled: !s })
  const item = s && ed.itemOf(keyOf(s.routeId, s.nth))
  const nonRoute = slot.kind === '非线路'
  const compact = w < 150 || h < 72
  return (
    <div
      ref={setNodeRef}
      style={{ width: w, height: h }}
      className={cn(
        'group/slot relative flex flex-col justify-center rounded-xl transition-colors',
        compact ? 'px-2' : 'px-3',
        nonRoute ? 'bg-[repeating-linear-gradient(135deg,var(--sunken)_0_7px,var(--surface)_7px_14px)] ring-1 ring-hairline-2' : s ? 'bg-surface ring-1 ring-hairline-2' : 'border-2 border-dashed border-hairline-2',
        isOver && !nonRoute && 'border-accent bg-accent-soft ring-2 ring-accent',
        isOver && nonRoute && 'ring-2 ring-danger',
      )}
    >
      <span className="absolute left-2 top-1 text-[11px] tabular-nums text-ink-3">{compact ? slot.no : `${slot.no} 号插片`}</span>
      <button className="absolute right-1.5 top-0.5 text-[11px] text-ink-4 opacity-0 transition-opacity hover:text-ink group-hover/slot:opacity-100 focus:opacity-100" onClick={() => ed.setSel({ type: 'slot', id: slot.id })}>属性</button>
      {nonRoute ? (
        <span className={cn('text-center text-ink-2', compact ? 'mt-2 text-[11.5px] leading-tight' : 'text-[13px]')}>{slot.note || '非线路'}</span>
      ) : s && item ? (
        <div ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} className={cn('flex min-w-0 cursor-grab flex-col gap-1', compact ? 'mt-2' : 'mt-3', drag.isDragging && 'opacity-40')}>
          <div className="flex items-center gap-1.5">
            <RoutePlate name={s.lineName} size={compact ? 'sm' : 'lg'} state={item.status === '失效' ? 'invalid' : 'normal'} />
            {compact && <span className="whitespace-nowrap text-[11px] text-ink-3">{s.kind}</span>}
            <IconButton label="移出插片" className="ml-auto size-6 opacity-0 group-hover/slot:opacity-100 focus:opacity-100" onClick={() => ed.ops.removeSchedule(s.id)}><X size={13} /></IconButton>
          </div>
          {!compact && <span className="truncate whitespace-nowrap text-[12px] text-ink-3">{s.kind} · {item.status === '失效' ? '已不经过本站' : `开往 ${item.terminal}`}</span>}
        </div>
      ) : (
        <span className={cn('text-center text-ink-4', compact ? 'mt-1.5 text-[11.5px]' : 'mt-2 text-[13px]')}>{compact ? '空' : '拖入一条线路'}</span>
      )}
    </div>
  )
}

function Stage({ ed, board }: { ed: Editor; board: Board }) {
  const [ref, size] = useSize<HTMLDivElement>()
  const { setNodeRef, isOver } = useDroppable({ id: `board:${board.id}` })
  const shelf = M.findBoard(ed.draft, board.id)!.shelf
  const list = M.onBoard(ed.draft, board.id)
  const scale = Math.min((size.h - 40) / board.h, (size.w - 80) / board.w, 0.42)
  const W = board.w * scale
  const H = board.h * scale
  const cols = Math.max(1, Math.floor(board.w / Math.max(...board.slots.map((s) => s.w), 1)))
  const pad = 14
  const cw = (W - pad * 2 - 10 * (cols - 1)) / cols
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
      {/* 牌头：属性就地编辑 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-surface px-6 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[22px] font-bold">{cnNum(board.no)}号牌</span>
          <button className="inline-flex items-center gap-0.5 text-[12.5px] text-ink-3 hover:text-ink" onClick={() => ed.setSel({ type: 'shelf', id: shelf.id })}>
            {cnNum(shelf.no)}号架 · {shelf.type} <ChevronRight size={12} />
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          面
          <GhostSelect value={board.face} onChange={(e) => ed.ops.updateBoard(board.id, { face: e.target.value as BoardFace })} className="mx-0 w-[84px]">
            {FACES.map((f) => <option key={f}>{f}</option>)}
          </GhostSelect>
        </label>
        <Segmented
          size="sm"
          value={board.kind}
          onChange={(v) => window.confirm(`把${cnNum(board.no)}号牌改为${v}？这块牌上现有的编排会移除。`) && ed.ops.updateBoard(board.id, { kind: v })}
          options={[{ value: '整版', label: '整版' }, { value: '分片', label: '分片' }]}
        />
        <label className="flex items-center gap-1 text-[12.5px] text-ink-3">
          <GhostInput type="number" value={board.w} onChange={(e) => ed.ops.updateBoard(board.id, { w: Number(e.target.value) })} className="mx-0 w-[70px] text-right font-mono text-[13px]" />
          ×
          <GhostInput type="number" value={board.h} onChange={(e) => ed.ops.updateBoard(board.id, { h: Number(e.target.value) })} className="mx-0 w-[70px] font-mono text-[13px]" />
          mm
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          {board.kind === '整版' ? (
            <Button size="sm" onClick={() => ed.ops.autoSort(board.id)} disabled={list.length < 2}><ArrowDownUp size={13} /> 自动排序</Button>
          ) : (
            <Button size="sm" onClick={() => ed.ops.addSlot(board.id)}><Plus size={13} /> 插片</Button>
          )}
          <IconButton label="删除这块站牌" onClick={() => window.confirm(`删除${cnNum(board.no)}号牌？它上面的编排会移除。`) && ed.ops.deleteBoard(board.id)}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>
      <div ref={ref} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5">
        <div className="flex flex-col items-center gap-2">
          <div
            ref={setNodeRef}
            style={{ width: W, height: H }}
            className={cn('gt-rise relative overflow-hidden rounded-[14px] bg-surface shadow-float ring-1 ring-hairline-2 transition-shadow', isOver && board.kind === '整版' && 'ring-2 ring-accent')}
            key={board.id}
          >
            {board.kind === '整版' ? (
              <SortableContext items={list.map((s) => `sch:${s.id}`)} strategy={verticalListSortingStrategy}>
                <div className="flex h-full flex-col gap-1.5 overflow-auto" style={{ padding: pad }}>
                  {list.map((s, i) => <BigRow key={s.id} ed={ed} s={s} index={i} />)}
                  {list.length === 0 && <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-hairline-2 text-[13px] text-ink-4">把线路拖到这里</div>}
                </div>
              </SortableContext>
            ) : (
              <div className="flex h-full flex-wrap content-start gap-2.5 overflow-auto" style={{ padding: pad }}>
                {board.slots.map((sl) => <BigSlot key={sl.id} ed={ed} slot={sl} w={cw} h={Math.max(64, sl.h * (cw / sl.w))} />)}
              </div>
            )}
          </div>
          <span className="text-[12px] tabular-nums text-ink-3">
            {board.face} · {board.kind} · {board.w}×{board.h} mm · 按 {Math.round(scale * 1000) / 10}% 比例显示
          </span>
        </div>
      </div>
    </div>
  )
}

export function EditorFocus({ ed }: { ed: Editor }) {
  const dnd = useEditorDnd(ed)
  const [current, setCurrent] = useState<string | null>(() => M.allBoards(ed.draft)[0]?.board.id ?? null)
  const [tpl, setTpl] = useState(false)
  const board = current ? M.findBoard(ed.draft, current)?.board ?? null : null
  useEffect(() => {
    if (!board) setCurrent(M.allBoards(ed.draft)[0]?.board.id ?? null)
  }, [ed.draft])
  // 新建站牌、从模板添加站架后，直接聚焦到新牌
  useEffect(() => {
    if (ed.sel?.type === 'board') {
      setCurrent(ed.sel.id)
      ed.setSel(null)
    } else if (ed.sel?.type === 'shelf') {
      const sh = ed.draft.shelves.find((x) => x.id === ed.sel!.id)
      if (sh?.boards[0] && !sh.boards.some((b) => b.id === current)) setCurrent(sh.boards[0].id)
    }
  }, [ed.sel])
  const drawerSel = ed.sel && ed.sel.type !== 'board'

  return (
    <DndContext sensors={dnd.sensors} collisionDetection={preferInner} onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onDragCancel={dnd.onDragCancel}>
      <div className="flex h-full flex-col">
        <EditorHeader ed={ed} />
        <Navigator ed={ed} current={current} setCurrent={setCurrent} onTemplate={() => setTpl(true)} />
        <div className="flex min-h-0 flex-1">
          <Pool ed={ed} current={board} />
          {board ? (
            <Stage ed={ed} board={board} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-2 text-center">
              <EmptyShelfArt />
              <div className="font-display text-[17px] font-semibold">这个站点还没有站牌</div>
              <Button variant="primary" onClick={() => setTpl(true)}><Layers size={14} /> 从模板添加站架</Button>
            </div>
          )}
        </div>
      </div>
      <Drawer open={!!drawerSel} onClose={() => ed.setSel(null)} title="属性" width={320}>
        <div className="-mx-5 -mb-5 h-[calc(100%+20px)]"><Inspector ed={ed} /></div>
      </Drawer>
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
