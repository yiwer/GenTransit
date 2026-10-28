// PROTOTYPE — 编辑器变体 C：编排矩阵。行是本站途经，列是整版站牌与线路插片；点单元格放置/移除，全程可用键盘
import { ArrowDownUp, Check, EyeOff, Info, Plus, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cnNum, STATUS_ORDER, type PoolItem } from '../../lib/domain'
import { Button, IconButton, StatusChip, cn } from '../../ui'
import * as M from './model'
import { EditorHeader, PassageLabel, TemplateDialog } from './parts'
import { targetsOf, type Editor } from './useEditor'

export function EditorC({ ed }: { ed: Editor }) {
  const cols = targetsOf(ed)
  const [tpl, setTpl] = useState(false)
  const [onlyOpen, setOnlyOpen] = useState(false)

  const cellState = (item: PoolItem, col: (typeof cols)[number]) => {
    const s = item.schedules.find((x) => (col.kind === 'board' ? x.place.type === 'board' && x.place.boardId === col.id : x.place.type === 'slot' && x.place.slotId === col.id))
    return s
  }
  const toggle = (item: PoolItem, col: (typeof cols)[number]) => {
    const s = cellState(item, col)
    if (s) return ed.ops.removeSchedule(s.id)
    if (item.status === '失效') return
    col.kind === 'board' ? ed.ops.placeOnBoard(item, col.id) : ed.ops.placeOnSlot(item, col.id)
  }

  // 列分组：按站牌
  const groups: { boardId: string; label: string; sub: string; span: number; whole: boolean }[] = []
  for (const c of cols) {
    const g = groups[groups.length - 1]
    if (g && g.boardId === c.board.id) g.span++
    else groups.push({ boardId: c.board.id, label: `${cnNum(c.board.no)}号牌`, sub: `${cnNum(c.shelf.no)}号架 · ${c.board.face} · ${c.board.kind}`, span: 1, whole: c.kind === 'board' })
  }
  const rows = STATUS_ORDER.map((st) => ({ st, items: ed.pool.filter((p) => p.status === st) })).filter((g) => g.items.length && (!onlyOpen || g.st === '待编排' || g.st === '失效'))

  return (
    <div className="flex h-full flex-col">
      <EditorHeader ed={ed} />
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface px-5 text-xs text-fg-2">
        <Info size={14} className="text-fg-3" />
        点单元格放置或移除；整版列里的数字是展示顺序。站架和站牌结构在变体 A / B 中编辑。
        <label className="ml-auto inline-flex items-center gap-1.5">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="accent-[var(--primary)]" />
          只看待处理
        </label>
        <Button size="sm" onClick={() => setTpl(true)}><Plus size={13} /> 从模板添加站架</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        {cols.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong bg-surface p-10 text-center text-[13px] text-fg-3">还没有可放置线路的站牌。先从模板添加站架。</div>
        ) : (
          <table className="border-separate border-spacing-0 rounded-[10px] border border-line bg-surface text-[13px]">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky left-0 top-0 z-20 min-w-[280px] border-b border-r border-line bg-surface-2 px-3 text-left text-xs font-medium text-fg-2">本站途经</th>
                {groups.map((g) => (
                  <th key={g.boardId} colSpan={g.span} className="sticky top-0 z-10 h-11 border-b border-r border-line bg-surface-2 px-2 text-left align-middle">
                    <div className="flex items-center gap-1">
                      <div>
                        <div className="text-[13px] font-semibold text-fg">{g.label}</div>
                        <div className="text-[11px] font-normal text-fg-3">{g.sub}</div>
                      </div>
                      {g.whole && (
                        <IconButton label={`${g.label} 自动排序`} className="ml-auto size-7" disabled={M.onBoard(ed.draft, g.boardId).length < 2} onClick={() => ed.ops.autoSort(g.boardId)}>
                          <ArrowDownUp size={14} />
                        </IconButton>
                      )}
                    </div>
                  </th>
                ))}
                <th rowSpan={2} className="sticky top-0 z-10 w-[72px] border-b border-line bg-surface-2 px-2 text-center text-xs font-medium text-fg-2">
                  <EyeOff size={14} className="mx-auto mb-0.5" />隐藏
                </th>
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.id} className="sticky top-11 z-10 h-7 min-w-[76px] border-b border-r border-line bg-surface-2 px-2 text-center text-[11px] font-normal text-fg-3">
                    {c.kind === 'board' ? '整版' : `${c.slot!.no} 号插片`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <Fragment key={g.st}>
                  <tr>
                    <td colSpan={cols.length + 2} className="sticky left-0 border-b border-line bg-surface px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <StatusChip status={g.st} count={g.items.length} />
                        {g.st === '失效' && <Button size="sm" variant="ghost" className="text-st-bad" onClick={() => ed.ops.clearInvalid()}><Trash2 size={13} /> 全部清理</Button>}
                      </span>
                    </td>
                  </tr>
                  {g.items.map((it) => (
                    <tr key={it.key} className="group">
                      <td className="sticky left-0 z-[5] h-10 border-b border-r border-line bg-surface px-3 group-hover:bg-surface-2">
                        <PassageLabel item={it} />
                      </td>
                      {cols.map((c) => {
                        const s = cellState(it, c)
                        const order = s && s.place.type === 'board' ? s.place.order : null
                        const occupiedByOther = c.kind === 'slot' && !s && c.occupant
                        const bad = it.status === '失效'
                        return (
                          <td key={c.id} className="h-10 border-b border-r border-line p-1 text-center group-hover:bg-surface-2">
                            <button
                              onClick={() => toggle(it, c)}
                              disabled={bad && !s}
                              aria-pressed={!!s}
                              aria-label={`${it.lineName} ${it.kind} 放到 ${cnNum(c.board.no)}号牌${c.kind === 'slot' ? ` ${c.slot!.no}号插片` : ''}`}
                              title={occupiedByOther ? `点击替换当前的 ${c.occupant}` : undefined}
                              className={cn(
                                'mx-auto flex h-7 w-full min-w-[60px] items-center justify-center rounded-md text-[12px] font-medium',
                                s && !bad && 'bg-st-done-bg text-st-done ring-1 ring-st-done-line',
                                s && bad && 'bg-st-bad-bg text-st-bad ring-1 ring-st-bad-line',
                                !s && 'text-fg-3 hover:bg-primary-soft hover:text-primary',
                                !s && bad && 'opacity-30',
                              )}
                            >
                              {s ? (order ? `第 ${order}` : <Check size={14} />) : occupiedByOther ? <span className="text-[11px]">{c.occupant}</span> : <Plus size={13} className="opacity-0 group-hover:opacity-60" />}
                            </button>
                          </td>
                        )
                      })}
                      <td className="h-10 border-b border-line p-1 text-center group-hover:bg-surface-2">
                        <button
                          onClick={() => (it.status === '隐藏' ? ed.ops.unhide(it) : ed.ops.hide(it))}
                          disabled={it.status === '失效'}
                          aria-pressed={it.status === '隐藏'}
                          aria-label={`${it.lineName} ${it.kind} 隐藏`}
                          className={cn('mx-auto flex h-7 w-12 items-center justify-center rounded-md', it.status === '隐藏' ? 'bg-st-hide-bg text-st-hide ring-1 ring-st-hide-line' : 'text-fg-3 hover:bg-surface-3 disabled:opacity-30')}
                        >
                          <EyeOff size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <TemplateDialog open={tpl} onClose={() => setTpl(false)} title="从站架模板添加" onPick={(t) => ed.ops.addShelf(t.id)} />
    </div>
  )
}
