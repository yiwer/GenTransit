// PROTOTYPE — 编辑器变体 B：站牌泳道。每块站牌一列，线路是卡片；不画比例，信息以列表为主
import { DndContext, DragOverlay, useDraggable, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDownUp, EyeOff, Layers, MoreHorizontal, Plus, Settings2, X } from 'lucide-react'
import { useId, useState } from 'react'
import type { Board, Schedule, Shelf } from '../../data/types'
import { cnNum, keyOf, type PoolItem } from '../../lib/domain'
import { Button, Drawer, IconButton, MenuItem, Popover, RoutePlate, cn, statusDot } from '../../ui'
import { preferInner } from './EditorA'
import * as M from './model'
import { EditorHeader, Inspector, PassageLabel, PlaceMenu, TemplateDialog } from './parts'
import { useEditorDnd, type Editor } from './useEditor'

function Card({ ed, item, s, dragProps, dragging }: { ed: Editor; item: PoolItem; s?: Schedule; dragProps?: any; dragging?: boolean }) {
  const bad = item.status === '失效'
  return (
    <div className={cn('group flex items-start gap-2 rounded-lg border bg-surface p-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]', bad ? 'border-st-bad-line bg-st-bad-bg' : 'border-line', dragging && 'opacity-40')}>
      <button {...dragProps} aria-label={`拖动 ${item.lineName}`} className="mt-0.5 cursor-grab text-fg-3 disabled:cursor-default" disabled={!dragProps}>
        <span className={cn('block size-2.5 rounded-full', statusDot(item.status))} />
      </button>
      <div className="min-w-0 flex-1">
        <RoutePlate name={item.lineName} size="md" state={bad ? 'invalid' : 'normal'} />
        <div className="mt-0.5 text-xs text-fg-2">
          {item.kind}
          {item.timesAtStop > 1 && ` · 第${item.nth}次途经`}
          {item.terminal !== '—' && <span className="text-fg-3"> · 开往 {item.terminal}</span>}
          {bad && <span className="text-st-bad"> · 已不经过本站</span>}
        </div>
      </div>
      {s ? (
        <IconButton label={`移除 ${item.lineName}`} className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => ed.ops.removeSchedule(s.id)}><X size={13} /></IconButton>
      ) : (
        <PlaceMenu ed={ed} item={item} trigger={(t) => <IconButton label={`${item.lineName} 的操作`} className="size-6" onClick={t}><MoreHorizontal size={14} /></IconButton>} />
      )}
    </div>
  )
}

function PoolCard({ ed, item }: { ed: Editor; item: PoolItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `pool:${item.key}`, disabled: item.status === '失效' })
  return (
    <div ref={setNodeRef}>
      <Card ed={ed} item={item} dragProps={item.status === '失效' ? undefined : { ...attributes, ...listeners }} dragging={isDragging} />
    </div>
  )
}

function SortCard({ ed, s }: { ed: Editor; s: Schedule }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `sch:${s.id}` })
  const item = ed.itemOf(keyOf(s.routeId, s.nth))
  if (!item) return null
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Card ed={ed} item={item} s={s} dragProps={{ ...attributes, ...listeners }} dragging={isDragging} />
    </div>
  )
}

function Lane({ title, sub, actions, children, dropId, tone, width = 260 }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; dropId?: string; tone?: 'pool' | 'hidden'; width?: number }) {
  const fallback = useId()
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? `lane:${fallback}`, disabled: !dropId })
  return (
    <section ref={setNodeRef} style={{ width }} className={cn('flex max-h-full shrink-0 flex-col rounded-xl border bg-surface-2', isOver ? 'border-primary bg-primary-soft' : 'border-line', tone === 'pool' && 'bg-surface')}>
      <header className="flex items-start gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">{title}</div>
          {sub && <div className="text-xs text-fg-3">{sub}</div>}
        </div>
        {actions}
      </header>
      <div className="flex min-h-[64px] flex-1 flex-col gap-1.5 overflow-auto px-2 pb-2">{children}</div>
    </section>
  )
}

function SlotRow({ ed, slot }: { ed: Editor; slot: Board['slots'][number] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.id}` })
  const s = M.inSlot(ed.draft, slot.id)
  const drag = useDraggable({ id: s ? `sch:${s.id}` : `none:${slot.id}`, disabled: !s })
  const item = s && ed.itemOf(keyOf(s.routeId, s.nth))
  return (
    <div ref={setNodeRef} className={cn('rounded-lg border border-dashed p-1.5', isOver ? (slot.kind === '线路' ? 'border-primary bg-primary-soft' : 'border-danger') : 'border-line-strong')}>
      <div className="mb-1 flex items-center justify-between px-1 text-[11.5px] text-fg-3">
        <span>{slot.no} 号插片 · {slot.w}×{slot.h}</span>
        <button className="hover:text-fg" onClick={() => ed.setSel({ type: 'slot', id: slot.id })}>属性</button>
      </div>
      {slot.kind === '非线路' ? (
        <div className="rounded-md bg-surface px-2 py-2 text-xs text-fg-2">非线路：{slot.note || '未说明'}</div>
      ) : item && s ? (
        <div ref={drag.setNodeRef}>
          <Card ed={ed} item={item} s={s} dragProps={{ ...drag.attributes, ...drag.listeners }} dragging={drag.isDragging} />
        </div>
      ) : (
        <div className="rounded-md px-2 py-2 text-center text-xs text-fg-3">拖入一条线路</div>
      )}
    </div>
  )
}

function BoardLane({ ed, shelf, board }: { ed: Editor; shelf: Shelf; board: Board }) {
  const list = M.onBoard(ed.draft, board.id)
  const actions = (
    <Popover align="right" width={180} trigger={({ toggle }) => <IconButton label={`${cnNum(board.no)}号牌 的操作`} className="size-7" onClick={toggle}><MoreHorizontal size={15} /></IconButton>}>
      {(close) => (
        <>
          {board.kind === '整版' ? (
            <MenuItem disabled={list.length < 2} onClick={() => { close(); ed.ops.autoSort(board.id) }}><ArrowDownUp size={14} /> 自动排序</MenuItem>
          ) : (
            <MenuItem onClick={() => { close(); ed.ops.addSlot(board.id) }}><Plus size={14} /> 添加插片</MenuItem>
          )}
          <MenuItem onClick={() => { close(); ed.setSel({ type: 'board', id: board.id }) }}><Settings2 size={14} /> 站牌属性</MenuItem>
          <MenuItem danger onClick={() => { close(); window.confirm(`删除${cnNum(board.no)}号牌？`) && ed.ops.deleteBoard(board.id) }}><X size={14} /> 删除站牌</MenuItem>
        </>
      )}
    </Popover>
  )
  return (
    <Lane
      dropId={board.kind === '整版' ? `board:${board.id}` : undefined}
      title={<>{cnNum(board.no)}号牌 <span className="font-normal text-fg-2">· {board.face}</span></>}
      sub={`${board.kind} · ${board.w}×${board.h}${board.kind === '整版' ? ` · ${list.length} 条线路` : ` · ${board.slots.length} 个插片`}`}
      actions={actions}
    >
      {board.kind === '整版' ? (
        <SortableContext items={list.map((s) => `sch:${s.id}`)} strategy={verticalListSortingStrategy}>
          {list.map((s) => <SortCard key={s.id} ed={ed} s={s} />)}
          {list.length === 0 && <div className="rounded-lg border border-dashed border-line-strong py-5 text-center text-xs text-fg-3">拖入线路</div>}
        </SortableContext>
      ) : (
        board.slots.map((sl) => <SlotRow key={sl.id} ed={ed} slot={sl} />)
      )}
    </Lane>
  )
}

export function EditorB({ ed }: { ed: Editor }) {
  const dnd = useEditorDnd(ed)
  const [tpl, setTpl] = useState(false)
  const [overview, setOverview] = useState(false)
  const pool = ed.pool.filter((p) => p.status !== '隐藏')
  const hidden = ed.pool.filter((p) => p.status === '隐藏')
  return (
    <DndContext sensors={dnd.sensors} collisionDetection={preferInner} onDragStart={dnd.onDragStart} onDragEnd={dnd.onDragEnd} onDragCancel={dnd.onDragCancel}>
      <div className="flex h-full flex-col">
        <EditorHeader ed={ed} />
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex h-full items-stretch gap-3 p-4">
            <Lane tone="pool" dropId="pool" title="线路池" sub="待编排在前；已编排的拖到别的站牌即复制" width={280}>
              {(['待编排', '失效', '已编排'] as const).map((st) => {
                const items = pool.filter((p) => p.status === st)
                if (!items.length) return null
                return (
                  <div key={st} className="flex flex-col gap-1.5">
                    <div className="mt-1 flex items-center justify-between px-1 text-xs font-medium text-fg-2">
                      <span>{st} {items.length}</span>
                      {st === '失效' && <button className="text-st-bad hover:underline" onClick={() => ed.ops.clearInvalid()}>全部清理</button>}
                    </div>
                    {items.map((it) => <PoolCard key={it.key} ed={ed} item={it} />)}
                  </div>
                )
              })}
            </Lane>
            {ed.draft.shelves.map((sh) => (
              <div key={sh.id} className="flex shrink-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-2">
                <div className="flex items-center gap-2 px-2 pt-1">
                  <span className="text-[13.5px] font-semibold">{cnNum(sh.no)}号架</span>
                  <span className="text-xs text-fg-3">{sh.type}{sh.name && ` · ${sh.name}`}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => ed.ops.addBoard(sh.id)}><Plus size={13} /> 站牌</Button>
                  <Button size="sm" variant="ghost" onClick={() => ed.setSel({ type: 'shelf', id: sh.id })}><Settings2 size={13} /> 站架</Button>
                </div>
                <div className="flex min-h-0 flex-1 gap-2">
                  {sh.boards.map((b) => <BoardLane key={b.id} ed={ed} shelf={sh} board={b} />)}
                </div>
              </div>
            ))}
            <div className="flex shrink-0 flex-col gap-2">
              <Button onClick={() => setTpl(true)}><Layers size={14} /> 从模板添加站架</Button>
              <Button onClick={() => ed.ops.addShelf()}><Plus size={14} /> 空白站架</Button>
              <Button variant="ghost" onClick={() => { ed.setSel(null); setOverview(true) }}>温馨提示…</Button>
            </div>
            <Lane dropId="hidden" tone="hidden" title={<span className="inline-flex items-center gap-1.5"><EyeOff size={14} /> 隐藏</span>} sub="不在本站任何站牌展示" width={240}>
              {hidden.map((it) => <PoolCard key={it.key} ed={ed} item={it} />)}
              {hidden.length === 0 && <div className="py-4 text-center text-xs text-fg-3">拖到这里即隐藏</div>}
            </Lane>
          </div>
        </div>
      </div>
      <Drawer open={!!ed.sel || overview} onClose={() => { ed.setSel(null); setOverview(false) }} title="属性" width={320}>
        <div className="-m-5 h-[calc(100%+40px)]"><Inspector ed={ed} /></div>
      </Drawer>
      <DragOverlay dropAnimation={null}>
        {dnd.active && (
          <div className="w-[240px] rounded-lg border border-primary bg-surface p-2.5 shadow-[var(--shadow-pop)]">
            <PassageLabel item={dnd.active.item} />
          </div>
        )}
      </DragOverlay>
      <TemplateDialog open={tpl} onClose={() => setTpl(false)} title="从站架模板添加" onPick={(t) => ed.ops.addShelf(t.id)} />
    </DndContext>
  )
}
