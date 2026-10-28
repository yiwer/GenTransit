// PROTOTYPE — 编辑器方案 A2「点选装填」：不用拖拽。先点一块牌或一个插片当装填目标，再点线路放进去；插片放满自动跳到下一个空位
import { ArrowDownUp, CornerDownLeft, EyeOff, Layers, Plus, Settings2, SkipForward, Target, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Board, Shelf } from '../../data/types'
import { cnNum, keyOf, STATUS_ORDER, type PoolItem } from '../../lib/domain'
import { Button, Drawer, IconButton, Kbd, MenuItem, Popover, RoutePlate, cn, statusClass, statusDot, useToast } from '../../ui'
import { EmptyShelfArt } from '../../ui/lively'
import * as M from './model'
import { EditorHeader, Inspector, PassageLabel, TemplateDialog } from './parts'
import type { Editor } from './useEditor'

type FillTarget = { type: 'board' | 'slot'; id: string } | null

/** 装填顺序：按站架、站牌、插片的顺序排出所有可放线路的位置 */
function targetsInOrder(ed: Editor): NonNullable<FillTarget>[] {
  return M.allBoards(ed.draft).flatMap(({ board }): NonNullable<FillTarget>[] =>
    board.kind === '整版' ? [{ type: 'board', id: board.id }] : board.slots.filter((s) => s.kind === '线路').map((s) => ({ type: 'slot', id: s.id })),
  )
}
const isEmpty = (ed: Editor, t: NonNullable<FillTarget>) => (t.type === 'slot' ? !M.inSlot(ed.draft, t.id) : M.onBoard(ed.draft, t.id).length === 0)

function targetLabel(ed: Editor, t: FillTarget) {
  if (!t) return '还没选'
  if (t.type === 'board') {
    const f = M.findBoard(ed.draft, t.id)
    return f ? `${cnNum(f.board.no)}号牌 · 整版（已有 ${M.onBoard(ed.draft, t.id).length} 条）` : '—'
  }
  const f = M.findSlot(ed.draft, t.id)
  if (!f) return '—'
  const occ = M.inSlot(ed.draft, t.id)
  return `${cnNum(f.board.no)}号牌 · ${f.slot.no} 号插片（${occ ? `现为 ${occ.lineName}，放入会替换` : '空'}）`
}

function SlotCell({ ed, slot, w, h, target, setTarget, onProps }: { ed: Editor; slot: Board['slots'][number]; w: number; h: number; target: FillTarget; setTarget: (t: FillTarget) => void; onProps: () => void }) {
  const s = M.inSlot(ed.draft, slot.id)
  const item = s && ed.itemOf(keyOf(s.routeId, s.nth))
  const active = target?.type === 'slot' && target.id === slot.id
  const nonRoute = slot.kind === '非线路'
  return (
    <button
      disabled={nonRoute}
      onClick={(e) => { e.stopPropagation(); setTarget({ type: 'slot', id: slot.id }) }}
      onDoubleClick={onProps}
      style={{ width: w, height: h }}
      className={cn(
        'relative flex flex-col items-start justify-center rounded-lg px-2 text-left transition-all duration-300 ease-[var(--spring)]',
        nonRoute ? 'cursor-default bg-[repeating-linear-gradient(135deg,var(--sunken)_0_6px,var(--surface)_6px_12px)] ring-1 ring-hairline-2' : s ? 'bg-surface ring-1 ring-hairline-2 hover:ring-accent/50' : 'border-2 border-dashed border-hairline-2 hover:border-accent/60',
        active && 'z-[1] scale-[1.03] outline-2 outline-offset-2 outline-coral [outline-style:dashed]',
      )}
    >
      <span className="absolute left-2 top-1 text-[10.5px] tabular-nums text-ink-3">{slot.no}</span>
      {active && <span className="absolute -top-2.5 right-1.5 rounded-full bg-coral px-1.5 text-[10.5px] font-semibold text-paper">装填中</span>}
      {nonRoute ? (
        <span className="mx-auto text-[12px] text-ink-3">{slot.note || '非线路'}</span>
      ) : s ? (
        <span className="mt-2 flex items-center gap-1.5">
          <RoutePlate name={s.lineName} size="sm" state={item?.status === '失效' ? 'invalid' : 'normal'} />
          <span className="text-[11.5px] text-ink-3">{s.kind}</span>
        </span>
      ) : (
        <span className="mx-auto mt-1.5 text-[12px] text-ink-4">空</span>
      )}
    </button>
  )
}

function BoardCard({ ed, board, scale, target, setTarget }: { ed: Editor; board: Board; scale: number; target: FillTarget; setTarget: (t: FillTarget) => void }) {
  const list = M.onBoard(ed.draft, board.id)
  const W = board.w * scale
  const H = board.h * scale
  const active = target?.type === 'board' && target.id === board.id
  const cols = Math.max(1, Math.floor(board.w / Math.max(...board.slots.map((s) => s.w), 1)))
  const cw = (W - 16 - 6 * (cols - 1)) / cols
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        role={board.kind === '整版' ? 'button' : undefined}
        tabIndex={board.kind === '整版' ? 0 : undefined}
        onClick={() => board.kind === '整版' && setTarget({ type: 'board', id: board.id })}
        onKeyDown={(e) => e.key === 'Enter' && board.kind === '整版' && setTarget({ type: 'board', id: board.id })}
        onDoubleClick={() => ed.setSel({ type: 'board', id: board.id })}
        style={{ width: W, height: H }}
        className={cn(
          'relative rounded-[10px] bg-surface p-2 pt-6 shadow-xs ring-1 ring-hairline-2 transition-all duration-300 ease-[var(--spring)]',
          board.kind === '整版' && 'cursor-pointer hover:ring-accent/50',
          active && 'scale-[1.02] outline-2 outline-offset-4 outline-coral [outline-style:dashed]',
        )}
      >
        <span className="absolute left-2.5 top-1.5 text-[12px] font-semibold">{cnNum(board.no)}号牌</span>
        <span className="absolute right-2 top-1.5 text-[11px] text-ink-3">{board.face}</span>
        {active && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-coral px-2 text-[11px] font-semibold text-paper">装填中</span>}
        {board.kind === '整版' ? (
          <div className="flex h-full flex-col gap-1 overflow-auto">
            {list.map((s, i) => {
              const item = ed.itemOf(keyOf(s.routeId, s.nth))
              return (
                <div key={s.id} className="group flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 px-1.5 ring-1 ring-hairline">
                  <span className="w-4 text-right text-[10.5px] tabular-nums text-ink-4">{i + 1}</span>
                  <RoutePlate name={s.lineName} size="xs" state={item?.status === '失效' ? 'invalid' : 'normal'} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{s.kind}</span>
                  <button aria-label={`移除 ${s.lineName}`} onClick={(e) => { e.stopPropagation(); ed.ops.removeSchedule(s.id) }} className="hidden text-ink-4 hover:text-ink group-hover:block"><X size={12} /></button>
                </div>
              )
            })}
            {list.length === 0 && <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-2 text-[11.5px] text-ink-4">点我设为装填目标</div>}
          </div>
        ) : (
          <div className="flex h-full flex-wrap content-start gap-1.5 overflow-auto">
            {board.slots.map((sl) => (
              <SlotCell key={sl.id} ed={ed} slot={sl} w={cw} h={Math.max(40, sl.h * (cw / sl.w))} target={target} setTarget={setTarget} onProps={() => ed.setSel({ type: 'slot', id: sl.id })} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 text-[11.5px] text-ink-3">
        {board.kind} · {board.w}×{board.h}
        {board.kind === '整版' && list.length > 1 && (
          <IconButton label={`${cnNum(board.no)}号牌自动排序`} className="size-6" onClick={() => ed.ops.autoSort(board.id)}><ArrowDownUp size={12} /></IconButton>
        )}
        <IconButton label={`${cnNum(board.no)}号牌属性`} className="size-6" onClick={() => ed.setSel({ type: 'board', id: board.id })}><Settings2 size={12} /></IconButton>
      </div>
    </div>
  )
}

function ShelfBlock({ ed, shelf, scale, target, setTarget }: { ed: Editor; shelf: Shelf; scale: number; target: FillTarget; setTarget: (t: FillTarget) => void }) {
  return (
    <div className="flex shrink-0 flex-col rounded-2xl bg-surface/60 p-3 ring-1 ring-hairline">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13.5px] font-semibold">{cnNum(shelf.no)}号架</span>
        <span className="text-[12px] text-ink-3">{shelf.type}{shelf.name && ` · ${shelf.name}`}</span>
        <IconButton label="站架属性" className="ml-auto size-6" onClick={() => ed.setSel({ type: 'shelf', id: shelf.id })}><Settings2 size={12} /></IconButton>
        <IconButton label="加站牌" className="size-6" onClick={() => ed.ops.addBoard(shelf.id)}><Plus size={13} /></IconButton>
      </div>
      <div className="flex items-end gap-4">{shelf.boards.map((b) => <BoardCard key={b.id} ed={ed} board={b} scale={scale} target={target} setTarget={setTarget} />)}</div>
    </div>
  )
}

export function EditorFill({ ed }: { ed: Editor }) {
  const toast = useToast()
  const [target, setTarget] = useState<FillTarget>(() => targetsInOrder(ed).find((t) => isEmpty(ed, t)) ?? targetsInOrder(ed)[0] ?? null)
  const [tpl, setTpl] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [cs, setCs] = useState({ w: 900, h: 600 })
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ro = new ResizeObserver(() => setCs({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // 装填目标被删除时清掉
  useEffect(() => {
    if (target && !targetsInOrder(ed).some((t) => t.id === target.id)) setTarget(null)
  }, [ed.draft])
  // 双击站牌打开属性后清掉选中，属性抽屉才能关闭
  const all = M.allBoards(ed.draft)
  const maxH = Math.max(...all.map((x) => x.board.h), 1)
  // 一屏放下全部站架：同时按高度和宽度适配，点击目标不至于跑出视野
  const totalW = ed.draft.shelves.reduce((n, sh) => n + sh.boards.reduce((m, b) => m + b.w, 0) + 300 * Math.max(0, sh.boards.length - 1) + 260, 0) + 420 * Math.max(0, ed.draft.shelves.length - 1)
  const scale = Math.max(0.12, Math.min(0.28, (cs.h - 120) / maxH, (cs.w - 160) / Math.max(totalW, 1)))

  const advance = (from: NonNullable<FillTarget>) => {
    const order = targetsInOrder(ed)
    const i = order.findIndex((t) => t.id === from.id)
    const next = [...order.slice(i + 1), ...order.slice(0, i)].find((t) => t.type === 'slot' && t.id !== from.id && isEmpty(ed, t))
    if (next) setTarget(next)
  }

  const place = (item: PoolItem) => {
    if (item.status === '失效') return toast('这条线路已不经过本站，只能清理', 'warn')
    if (!target) return toast('先在右边点一块整版站牌或一个线路插片，作为装填目标', 'warn')
    if (target.type === 'board') {
      if (item.schedules.some((s) => s.place.type === 'board' && s.place.boardId === target.id)) return toast(`${item.lineName} 已在这块牌上`, 'info')
      ed.ops.placeOnBoard(item, target.id)
    } else {
      ed.ops.placeOnSlot(item, target.id)
      advance(target)
    }
  }

  const nextEmpty = () => {
    const order = targetsInOrder(ed)
    const i = target ? order.findIndex((t) => t.id === target.id) : -1
    const next = [...order.slice(i + 1), ...order.slice(0, i + 1)].find((t) => isEmpty(ed, t))
    if (next) setTarget(next)
    else toast('没有空位了', 'info')
  }

  // 线路池键盘操作：↑↓ 移动，回车放入，H 隐藏
  const onListKey = (e: React.KeyboardEvent) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      n?.focus()
    }
    if ((e.key === 'h' || e.key === 'H') && i >= 0) {
      const item = ed.pool.find((p) => p.key === rows[i].dataset.row)
      if (item && item.status !== '失效') ed.ops.hide(item)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <EditorHeader ed={ed} />
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-accent-soft/50 px-5 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent">
          <Target size={15} /> 装填目标
        </span>
        <span className="font-display text-[15px] font-semibold">{targetLabel(ed, target)}</span>
        <Button size="sm" onClick={nextEmpty}><SkipForward size={13} /> 下一个空位</Button>
        {target && <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>取消目标</Button>}
        <span className="ml-auto flex items-center gap-1.5 text-[12px] text-ink-3">
          点线路即放入 · <Kbd>↑</Kbd><Kbd>↓</Kbd> 选择 · <Kbd>回车</Kbd> 放入 · <Kbd>H</Kbd> 隐藏 · 双击站牌改属性
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-hairline bg-surface">
          <ul ref={listRef} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-auto p-2">
            {STATUS_ORDER.map((st) => {
              const items = ed.pool.filter((p) => p.status === st)
              if (!items.length) return null
              return (
                <li key={st} className="mb-2">
                  <div className="flex h-8 items-center gap-2 px-2">
                    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11.5px] font-medium', statusClass(st))}>{st}</span>
                    <span className="text-[12px] tabular-nums text-ink-3">{items.length}</span>
                    {st === '失效' && <button className="ml-auto text-[12px] text-danger hover:underline" onClick={() => ed.ops.clearInvalid()}>全部清理</button>}
                  </div>
                  <ul>
                    {items.map((it) => (
                      <li key={it.key} className="group relative">
                        <button
                          data-row={it.key}
                          onClick={() => place(it)}
                          className={cn('flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors focus:bg-accent-soft focus:outline-none', it.status === '失效' ? 'cursor-default opacity-80' : 'hover:bg-surface-2')}
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', statusDot(it.status))} />
                          <span className="min-w-0 flex-1"><PassageLabel item={it} /></span>
                          {it.status !== '失效' && target && (
                            <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-accent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                              放入 <CornerDownLeft size={12} />
                            </span>
                          )}
                        </button>
                        {it.status !== '失效' && it.status !== '隐藏' && (
                          <IconButton label={`隐藏 ${it.lineName}`} className="absolute right-1 top-1/2 size-7 -translate-y-1/2 bg-surface opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => ed.ops.hide(it)}>
                            <EyeOff size={13} />
                          </IconButton>
                        )}
                        {it.status === '隐藏' && (
                          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-accent opacity-0 hover:underline group-hover:opacity-100 focus:opacity-100" onClick={() => ed.ops.unhide(it)}>取消隐藏</button>
                        )}
                        {it.status === '失效' && (
                          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-danger hover:underline" onClick={() => ed.ops.removeAll(it)}>清理</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </aside>
        <div ref={canvas} className="min-w-0 flex-1 overflow-auto bg-surface-2">
          {ed.draft.shelves.length ? (
            <div className="flex min-h-full items-start gap-5 p-6">
              {ed.draft.shelves.map((sh) => <ShelfBlock key={sh.id} ed={ed} shelf={sh} scale={scale} target={target} setTarget={setTarget} />)}
              <Popover trigger={({ toggle }) => <Button size="sm" variant="ghost" onClick={toggle}><Plus size={13} /> 站架</Button>} width={190}>
                {(close) => (
                  <>
                    <MenuItem onClick={() => { close(); setTpl(true) }}><Layers size={14} /> 从模板添加…</MenuItem>
                    <MenuItem onClick={() => { close(); ed.ops.addShelf() }}><Plus size={14} /> 空白站架</MenuItem>
                  </>
                )}
              </Popover>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <EmptyShelfArt />
              <div className="font-display text-[17px] font-semibold">这个站点还没有站牌</div>
              <Button variant="primary" onClick={() => setTpl(true)}><Layers size={14} /> 从模板添加站架</Button>
            </div>
          )}
        </div>
      </div>
      <Drawer open={!!ed.sel} onClose={() => ed.setSel(null)} title="属性" width={320}>
        <div className="-mx-5 -mb-5 h-[calc(100%+20px)]"><Inspector ed={ed} /></div>
      </Drawer>
      <TemplateDialog open={tpl} onClose={() => setTpl(false)} title="从站架模板添加" onPick={(t) => ed.ops.addShelf(t.id)} />
    </div>
  )
}
