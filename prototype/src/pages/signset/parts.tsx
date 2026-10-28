// PROTOTYPE — 编辑器变体共用的小部件：线路标签、"放到…"菜单、头部、属性面板、模板选择
import { ArrowDownUp, ChevronLeft, CornerDownRight, EyeOff, History, Layers, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DICT, SHELF_TEMPLATES } from '../../data/mock'
import type { BoardFace, ShelfTemplate } from '../../data/types'
import { cnNum, type PoolItem } from '../../lib/domain'
import { Button, Checkbox, Dialog, Field, IconButton, Input, MenuItem, MenuLabel, Popover, RoutePlate, Select, StatusChip, Textarea, cn, useToast } from '../../ui'
import * as M from './model'
import { targetsOf, type Editor } from './useEditor'
import { HistoryButton } from '../shared'

const KIND_MARK: Record<string, string> = { 上行: '↑', 下行: '↓', 内环: '⟳', 外环: '⟲', 环线: '⟳', 单向: '→' }

export function PassageLabel({ item, terminal = true, size = 'md' }: { item: Pick<PoolItem, 'lineName' | 'kind' | 'nth' | 'timesAtStop' | 'terminal'>; terminal?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <RoutePlate name={item.lineName} size={size === 'md' ? 'sm' : 'xs'} />
      <span className="shrink-0 text-[11.5px] text-fg-2">
        {KIND_MARK[item.kind]} {item.kind}
        {item.timesAtStop > 1 && <span className="ml-1 rounded bg-surface-3 px-1 text-[10.5px]">第{item.nth}次</span>}
      </span>
      {terminal && item.terminal !== '—' && <span className="truncate text-[11.5px] text-fg-3">开往 {item.terminal}</span>}
    </span>
  )
}

/** 不用拖拽也能完成全部放置操作 */
export function PlaceMenu({ ed, item, trigger }: { ed: Editor; item: PoolItem; trigger?: (toggle: () => void) => React.ReactNode }) {
  const targets = targetsOf(ed)
  const placedOn = (id: string) => item.schedules.some((s) => (s.place.type === 'board' && s.place.boardId === id) || (s.place.type === 'slot' && s.place.slotId === id))
  return (
    <Popover
      align="right"
      width={260}
      trigger={({ toggle }) =>
        trigger ? (
          <>{trigger(toggle)}</>
        ) : (
          <Button size="sm" variant="ghost" onClick={toggle} aria-label={`放置 ${item.lineName}`}>
            放到…
          </Button>
        )
      }
    >
      {(close) =>
        item.status === '失效' ? (
          <>
            <MenuLabel>这条线路已不经过本站</MenuLabel>
            <MenuItem danger onClick={() => { ed.ops.removeAll(item); close() }}><Trash2 size={14} /> 清理这条失效编排</MenuItem>
          </>
        ) : (
          <>
            <MenuLabel>放到站牌</MenuLabel>
            {targets.length === 0 && <div className="px-2 py-1.5 text-xs text-fg-3">还没有站牌，先添加站架</div>}
            {targets.map((t) => (
              <MenuItem
                key={t.id}
                disabled={placedOn(t.id)}
                hint={placedOn(t.id) ? '已在' : t.kind === 'slot' ? t.occupant ?? '空' : t.board.face}
                onClick={() => {
                  t.kind === 'board' ? ed.ops.placeOnBoard(item, t.id) : ed.ops.placeOnSlot(item, t.id)
                  close()
                }}
              >
                <CornerDownRight size={13} className="text-fg-3" />
                {cnNum(t.board.no)}号牌{t.kind === 'slot' ? ` · ${t.slot!.no}号插片` : ' · 整版'}
              </MenuItem>
            ))}
            <div className="my-1 border-t border-line" />
            {item.status === '隐藏' ? (
              <MenuItem onClick={() => { ed.ops.unhide(item); close() }}><RotateCcw size={14} /> 取消隐藏（回到待编排）</MenuItem>
            ) : (
              <MenuItem onClick={() => { ed.ops.hide(item); close() }}><EyeOff size={14} /> 隐藏，不在本站展示</MenuItem>
            )}
            {item.status === '已编排' && (
              <MenuItem danger onClick={() => { ed.ops.removeAll(item); close() }}><X size={14} /> 从全部站牌移除</MenuItem>
            )}
          </>
        )
      }
    </Popover>
  )
}

export function EditorHeader({ ed, variantNote }: { ed: Editor; variantNote?: string }) {
  const nav = useNavigate()
  const toast = useToast()
  return (
    <div className="flex h-[64px] shrink-0 items-center gap-4 border-b border-line bg-surface px-6">
      <div className="min-w-0">
        <button onClick={() => nav('/sign-sets')} className="inline-flex items-center text-xs text-fg-3 hover:text-fg">
          <ChevronLeft size={13} /> 站牌集
        </button>
        <h1 className="truncate font-display text-[19px] font-bold leading-7">
          {ed.stop?.name}<span className="font-normal text-fg-3">（{ed.stop?.direction}）</span> <span className="ml-1 font-sans text-[13px] font-normal text-fg-3">站牌集{variantNote ? ` · ${variantNote}` : ''}</span>
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        <StatusChip status="待编排" count={ed.counts.待编排} />
        <StatusChip status="已编排" count={ed.counts.已编排} />
        <StatusChip status="隐藏" count={ed.counts.隐藏} />
        <StatusChip status="失效" count={ed.counts.失效} />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {ed.dirty && <span className="text-xs text-st-wait">● 未保存</span>}
        <HistoryButton
          objType="站牌集"
          objId={ed.draft.stopId}
          objName={`${ed.stop?.name}（${ed.stop?.direction}）站牌集`}
          seed={[
            { at: '2026-10-20 16:05', action: '修改', summary: '编排：K3路 放到三号牌 1 号插片', diff: [{ field: 'K3路 上行', from: '待编排', to: '三号牌 · 1 号插片' }] },
            { at: '2026-09-02 11:30', action: '连带修改', summary: '删除线路 7路，连带移除编排', diff: [{ field: '7路 下行', from: '一号牌 · 第 3', to: '' }] },
            { at: '2026-03-02 10:20', action: '修改', summary: '从模板添加二号架（候车亭灯箱 · 6 插片）' },
            { at: '2025-12-18 15:40', action: '新增', summary: '随站点创建空站牌集' },
          ]}
        />
        <Button onClick={ed.reset} disabled={!ed.dirty}><RotateCcw size={14} /> 撤销修改</Button>
        <Button variant="primary" onClick={ed.save}><Save size={14} /> 保存</Button>
      </div>
    </div>
  )
}

const FACES: BoardFace[] = ['正面', '背面', 'A面', 'B面', 'C面', 'D面', 'E面', 'F面']

export function TemplateDialog({ open, onClose, onPick, title }: { open: boolean; onClose: () => void; onPick: (t: ShelfTemplate) => void; title: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} width={560}>
      <div className="flex flex-col gap-2">
        {SHELF_TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => { onPick(t); onClose() }} className="flex items-center gap-4 rounded-lg border border-line p-3 text-left hover:border-primary hover:bg-primary-soft">
            <span className="flex h-16 w-24 shrink-0 items-end justify-center gap-1 rounded bg-surface-2 p-1.5">
              {t.boards.map((b, i) => (
                <span key={i} className="block rounded-sm border border-line-strong bg-surface" style={{ width: b.w / 60, height: b.h / 40 }} />
              ))}
            </span>
            <span className="flex-1">
              <span className="block text-[14px] font-medium text-fg">{t.name}</span>
              <span className="block text-xs text-fg-3">{t.type} · {t.boards.length} 块站牌 · {t.boards.map((b) => `${b.face}${b.kind}${b.slots.length ? ` ${b.slots.length} 插片` : ''}`).join('、')}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

export function Inspector({ ed }: { ed: Editor }) {
  const [tpl, setTpl] = useState<null | 'add' | string>(null)
  const sel = ed.sel
  const usedBoardNos = M.allBoards(ed.draft).map((x) => x.board.no)
  const usedShelfNos = ed.draft.shelves.map((s) => s.no)

  let body: React.ReactNode
  if (sel?.type === 'shelf') {
    const s = ed.draft.shelves.find((x) => x.id === sel.id)
    if (!s) body = null
    else
      body = (
        <>
          <PanelTitle>{cnNum(s.no)}号架</PanelTitle>
          <div className="flex flex-col gap-3">
            <Field label="站架类型" required>
              <Select value={s.type} onChange={(e) => ed.ops.updateShelf(s.id, { type: e.target.value })}>
                {DICT.shelfType.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="编号" required hint="站牌集内唯一">
              <Select value={s.no} onChange={(e) => ed.ops.updateShelf(s.id, { no: Number(e.target.value) })}>
                {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n} disabled={n !== s.no && usedShelfNos.includes(n)}>{cnNum(n)}号架</option>
                ))}
              </Select>
            </Field>
            <Field label="名称"><Input value={s.name} onChange={(e) => ed.ops.updateShelf(s.id, { name: e.target.value })} /></Field>
            <Field label="说明"><Input value={s.desc} onChange={(e) => ed.ops.updateShelf(s.id, { desc: e.target.value })} /></Field>
            <Field label="材质说明"><Input value={s.material} onChange={(e) => ed.ops.updateShelf(s.id, { material: e.target.value })} /></Field>
            <Checkbox label="无实物站架" checked={s.noPhysical} onChange={(v) => ed.ops.updateShelf(s.id, { noPhysical: v })} />
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => ed.ops.addBoard(s.id)}><Plus size={14} /> 添加站牌</Button>
            <Button onClick={() => setTpl(s.id)}><Layers size={14} /> 重新套用模板…</Button>
            <Button variant="danger" onClick={() => window.confirm(`删除${cnNum(s.no)}号架？其上 ${s.boards.length} 块站牌的编排会移除，线路回到线路池。`) && ed.ops.deleteShelf(s.id)}><Trash2 size={14} /> 删除站架</Button>
          </div>
        </>
      )
  } else if (sel?.type === 'board') {
    const f = M.findBoard(ed.draft, sel.id)
    if (!f) body = null
    else {
      const b = f.board
      body = (
        <>
          <PanelTitle>{cnNum(b.no)}号牌 <span className="font-normal text-fg-3">· {cnNum(f.shelf.no)}号架</span></PanelTitle>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="编号" required>
                <Select value={b.no} onChange={(e) => ed.ops.updateBoard(b.id, { no: Number(e.target.value) })}>
                  {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n} disabled={n !== b.no && usedBoardNos.includes(n)}>{cnNum(n)}号牌</option>
                  ))}
                </Select>
              </Field>
              <Field label="面" required>
                <Select value={b.face} onChange={(e) => ed.ops.updateBoard(b.id, { face: e.target.value as BoardFace })}>
                  {FACES.map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="类型" required hint={b.kind === '整版' ? '改为分片会移除这块牌上的编排' : '改为整版会删除全部插片及其编排'}>
              <Select value={b.kind} onChange={(e) => {
                const v = e.target.value as '整版' | '分片'
                if (window.confirm(`把${cnNum(b.no)}号牌改为${v}？这块牌上现有的编排会移除。`)) ed.ops.updateBoard(b.id, { kind: v })
              }}>
                <option>整版</option>
                <option>分片</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="宽（mm）" required><Input type="number" value={b.w} onChange={(e) => ed.ops.updateBoard(b.id, { w: Number(e.target.value) })} /></Field>
              <Field label="高（mm）" required><Input type="number" value={b.h} onChange={(e) => ed.ops.updateBoard(b.id, { h: Number(e.target.value) })} /></Field>
            </div>
            <Field label="备注"><Textarea value={b.remark} onChange={(e) => ed.ops.updateBoard(b.id, { remark: e.target.value })} /></Field>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            {b.kind === '整版' ? (
              <Button onClick={() => ed.ops.autoSort(b.id)} disabled={M.onBoard(ed.draft, b.id).length < 2}><ArrowDownUp size={14} /> 自动排序</Button>
            ) : (
              <Button onClick={() => ed.ops.addSlot(b.id)}><Plus size={14} /> 添加插片</Button>
            )}
            <Button variant="danger" onClick={() => window.confirm(`删除${cnNum(b.no)}号牌？它上面的编排会移除。`) && ed.ops.deleteBoard(b.id)}><Trash2 size={14} /> 删除站牌</Button>
          </div>
        </>
      )
    }
  } else if (sel?.type === 'slot') {
    const f = M.findSlot(ed.draft, sel.id)
    if (!f) body = null
    else {
      const s = f.slot
      body = (
        <>
          <PanelTitle>{s.no}号插片 <span className="font-normal text-fg-3">· {cnNum(f.board.no)}号牌</span></PanelTitle>
          <div className="flex flex-col gap-3">
            <Field label="编号" required hint="所在站牌内唯一"><Input type="number" value={s.no} onChange={(e) => ed.ops.updateSlot(s.id, { no: Number(e.target.value) })} /></Field>
            <Field label="类型" required>
              <Select value={s.kind} onChange={(e) => ed.ops.updateSlot(s.id, { kind: e.target.value as '线路' | '非线路' })}>
                <option>线路</option>
                <option>非线路</option>
              </Select>
            </Field>
            {s.kind === '非线路' && <Field label="非线路说明" required><Input value={s.note} placeholder="如：广告位、公告栏" onChange={(e) => ed.ops.updateSlot(s.id, { note: e.target.value })} /></Field>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="宽（mm）" required><Input type="number" value={s.w} onChange={(e) => ed.ops.updateSlot(s.id, { w: Number(e.target.value) })} /></Field>
              <Field label="高（mm）" required><Input type="number" value={s.h} onChange={(e) => ed.ops.updateSlot(s.id, { h: Number(e.target.value) })} /></Field>
            </div>
          </div>
          <div className="mt-5">
            <Button variant="danger" className="w-full" onClick={() => ed.ops.deleteSlot(s.id)}><Trash2 size={14} /> 删除插片</Button>
          </div>
        </>
      )
    }
  } else {
    const boards = M.allBoards(ed.draft)
    body = (
      <>
        <PanelTitle>站牌集</PanelTitle>
        <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
          {[['站架', ed.draft.shelves.length], ['站牌', boards.length], ['插片', boards.reduce((n, x) => n + x.board.slots.length, 0)]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-surface-2 py-2">
              <dd className="text-[18px] font-semibold tabular-nums">{v}</dd>
              <dt className="text-xs text-fg-3">{k}</dt>
            </div>
          ))}
        </dl>
        <Field label="温馨提示" hint={`${ed.draft.reminder.length} / 1000`}>
          <Textarea value={ed.draft.reminder} maxLength={1000} onChange={(e) => ed.ops.setReminder(e.target.value)} placeholder="如线路临时调整说明" className="min-h-[96px]" />
        </Field>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => setTpl('add')}><Layers size={14} /> 从模板添加站架</Button>
          <Button onClick={() => ed.ops.addShelf()}><Plus size={14} /> 添加空白站架</Button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-fg-3">点选站架、站牌或插片，在这里编辑属性。</p>
      </>
    )
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-surface">
      {sel && (
        <div className="flex h-10 items-center border-b border-line px-3">
          <button className="inline-flex items-center gap-1 text-xs text-fg-3 hover:text-fg" onClick={() => ed.setSel(null)}>
            <ChevronLeft size={13} /> 站牌集概览
          </button>
          <IconButton label="取消选择" className="ml-auto size-7" onClick={() => ed.setSel(null)}><X size={14} /></IconButton>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">{body}</div>
      <TemplateDialog
        open={!!tpl}
        onClose={() => setTpl(null)}
        title={tpl === 'add' ? '从站架模板添加' : '重新套用模板（会替换这个站架下的全部站牌）'}
        onPick={(t) => (tpl === 'add' ? ed.ops.addShelf(t.id) : ed.ops.reapply(tpl!, t))}
      />
    </aside>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[15px] font-semibold">{children}</h2>
}
