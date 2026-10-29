// 站牌集编辑器（需求 5.5.3，M3 计划 4.2、4.3）：定稿 A3「站台立面 + 线路托盘」。
// 顶部：返回、站名与方位章、计数、修改历史、撤销修改、保存；工具条：比例、添加站架、清理失效、托盘收起；
// 立面是主区，选中站架、站牌、插片时右上角浮出属性卡；下方托盘只有待编排与隐藏两个区。
// 草稿是不可变对象：Ctrl+Z / Ctrl+Shift+Z 逐步撤销、重做；整页一次保存
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  ROUTE_KIND_LABEL,
  SIGN_SET_DIFF_SPEC,
  addBoard,
  addShelf,
  clearInvalid,
  countsOf,
  findBoard,
  findSlot,
  moveWithin,
  onBoard,
  placementsOnShelf,
  poolOf,
  reapplyTemplate,
  reorder,
  saveWarnings,
  shelfLabel,
  signSetSnapshotOf,
  stopLabel,
  type PoolItem,
  type SaveResult,
  type ShelfTemplate,
  type SignSetDraft,
  type SignSetView,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronLeft,
  Layers,
  NotebookPen,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { Elevation, PassageLabel, ZOOM_LABEL, useStoredZoom, type Sel, type Zoom } from '@/components/gt/elevation'
import { HistoryButton, snapshotsKey } from '@/components/gt/history'
import { EmptyShelfArt, OrbitLoader } from '@/components/gt/lively'
import { ConflictDialog, useSaveFlow } from '@/components/gt/save'
import { DirBadge, Segmented, StatusChip } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/dropdown-menu'
import { useDict } from '@/features/common/data'
import { put } from '@/lib/api'
import { cn, useStored } from '@/lib/utils'
import { draftOf, toInput, useDraftHistory, useSignSet } from './data'
import { EditorCtx, INVALID_MOVE, makeEditor, type EditorApi } from './editor-api'
import { Inspector } from './Inspector'
import { ScheduleMenu } from './PlaceMenu'
import { TemplatePicker } from './TemplatePicker'
import { Tray } from './Tray'

/** 指针落在线路行或插片上时优先它们，便于在整版站牌内排序、放进插片 */
const preferInner: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  if (within.length) {
    const inner = within.find((c) => String(c.id).startsWith('sch:') || String(c.id).startsWith('slot:'))
    return [inner ?? within[0]]
  }
  return rectIntersection(args)
}

const same = (a: SignSetDraft, b: SignSetDraft) => JSON.stringify(toInput(a, 0)) === JSON.stringify(toInput(b, 0))

export function SignSetEditorPage() {
  const { stopId } = useParams()
  const q = useSignSet(stopId)
  if (q.isPending)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-3">
        <OrbitLoader size={22} /> 正在读取站牌集…
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-3">
        <EmptyShelfArt />
        这个站点不存在或已删除。
        <Link to="/sign-sets" className="text-accent hover:underline">
          回到站牌集列表
        </Link>
      </div>
    )
  return <Editor key={q.data.id} initial={q.data} />
}

interface ConfirmReq {
  title: string
  body: ReactNode
  ok: string
  danger?: boolean
  run: () => void
}

function Editor({ initial }: { initial: SignSetView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [view, setView] = useState(initial)
  const [savedDraft, setSavedDraft] = useState(() => draftOf(initial))
  const hist = useDraftHistory(draftOf(initial))
  const draft = hist.draft
  const dirty = !same(draft, savedDraft)
  const pool = useMemo(() => poolOf(draft, view.passages, view.routes), [draft, view.passages, view.routes])
  const counts = countsOf(pool)
  const [sel, setSel] = useState<Sel | null>(null)
  const [zoom, setZoom] = useStoredZoom()
  const [trayOpen, setTrayOpen] = useStored('gt-tray-open', true)
  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'reapply'; shelfId: string }>(null)
  const [ask, setAsk] = useState<ConfirmReq | null>(null)
  const [warn, setWarn] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [noteOpen, setNoteOpen] = useState(Boolean(initial.reminder))
  const shelfTypes = useDict('shelfType').data ?? []
  const stopName = stopLabel(view.stop)

  const ed: EditorApi = makeEditor({ view, draft, pool, set: hist.set, toast, confirm: setAsk, sel, setSel })

  /* ---------- 撤销、重做、快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) hist.redo()
        else hist.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        hist.redo()
      } else if (e.key === 'Escape' && !document.querySelector('[role="dialog"], [role="menu"]')) setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hist])

  /* ---------- 未保存离开前提示 ---------- */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (!dirty) return
    const before = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [dirty])

  /* ---------- 保存 ---------- */
  const flow = useSaveFlow<SignSetView>({ okText: () => '已保存站牌集，生成一份修改快照' })
  const save = async () => {
    setWarn(null)
    setSaving(true)
    try {
      const r = await flow.save(() =>
        put<SaveResult<SignSetView>>(`/api/sign-sets/${view.id}`, toInput(draft, view.rev)),
      )
      if (!r) return
      setView(r.item)
      setSavedDraft(draftOf(r.item))
      hist.reset(draftOf(r.item))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sign-sets'] }),
        qc.invalidateQueries({ queryKey: ['stops', 'detail', view.stop.id] }),
        qc.invalidateQueries({ queryKey: snapshotsKey('signSet', view.id) }),
        qc.invalidateQueries({ queryKey: ['snapshots', 'recent'] }),
      ])
    } catch {
      // 已提示
    } finally {
      setSaving(false)
    }
  }
  const trySave = () => {
    const w = saveWarnings(draft)
    if (w.length) setWarn(w)
    else void save()
  }
  const routeName = (rs: SignSetView['routes']) => (id: string) => {
    const r = rs.find((x) => x.id === id)
    return r ? `${r.lineName} ${ROUTE_KIND_LABEL[r.kind]}` : ''
  }

  /* ---------- 结构 ---------- */
  const addBlank = () => {
    const type = shelfTypes[0]
    if (!type) return toast('还没有站架类型，先在基础数据里添加', 'warn')
    let id = ''
    if (
      ed.run((d) => {
        const r = addShelf(d, { type })
        id = r.shelfId
        return r.draft
      })
    )
      setSel({ type: 'shelf', id })
  }
  const addFromTemplates = (ts: ShelfTemplate[]) => {
    let last = ''
    ed.run((d) => {
      for (const t of ts) {
        const r = addShelf(d, { type: t.type, template: t })
        d = r.draft
        last = r.shelfId
      }
      return d
    })
    if (last) setSel({ type: 'shelf', id: last })
  }
  const reapply = (shelfId: string, t: ShelfTemplate) => {
    const n = placementsOnShelf(draft, shelfId)
    const shelf = draft.shelves.find((s) => s.id === shelfId)!
    ed.confirm({
      title: `给${shelfLabel(shelf.no)}重新套用「${t.name}」？`,
      body: `该站架下的站牌与插片将被替换${n ? `，其上 ${n} 条编排回到待编排` : ''}。保存前可以撤销。`,
      ok: '重新套用',
      run: () => ed.run((d) => reapplyTemplate(d, shelfId, t)),
    })
  }
  const invalidKeys = pool.filter((p) => p.status === 'invalid').map((p) => p.key)

  /* ---------- 拖放（id 约定：pool: sch: board: slot: hidden pool） ---------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [active, setActive] = useState<{ item: PoolItem; from?: string } | null>(null)
  const resolve = (id: string): { item: PoolItem; from?: string } | null => {
    if (id.startsWith('pool:')) {
      const item = ed.itemOf(id.slice(5))
      return item ? { item } : null
    }
    if (id.startsWith('sch:')) {
      const s = draft.schedules.find((x) => x.id === id.slice(4))
      const item = s && ed.itemOf(`${s.routeId}#${s.pass}`)
      return item ? { item, from: s.id } : null
    }
    return null
  }
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    const src = resolve(String(e.active.id))
    if (!src || !e.over) return
    const over = String(e.over.id)
    const { item, from } = src
    if (over === 'pool') {
      // 站牌上的线路拖回待编排 = 移除这一处编排；隐藏的线路拖回来 = 取消隐藏
      if (from) ed.removeSchedule(from)
      else if (item.status === 'hidden') ed.unhide(item)
      return
    }
    if (over === 'hidden') return item.status === 'hidden' ? undefined : ed.hide(item)
    if (over.startsWith('slot:')) {
      const f = findSlot(draft, over.slice(5))
      if (f?.slot.kind === 'other') return toast('非线路插片不能放线路', 'warn')
      const t = ed.targets.find((x) => x.id === over.slice(5))
      return t && ed.place(item, t, from)
    }
    if (over.startsWith('board:')) {
      const b = findBoard(draft, over.slice(6))
      if (b?.board.kind === 'sliced') return toast('分片站牌的线路要放进插片里', 'warn')
      const t = ed.targets.find((x) => x.id === over.slice(6))
      return t && ed.place(item, t, from)
    }
    if (over.startsWith('sch:')) {
      const target = draft.schedules.find((s) => s.id === over.slice(4))
      if (!target || target.placement !== 'board' || !target.boardId) return
      const ids = onBoard(draft, target.boardId).map((s) => s.id)
      const to = ids.indexOf(target.id)
      if (from && ids.includes(from)) {
        if (from !== target.id) ed.run((d) => reorder(d, target.boardId!, arrayMove(ids, ids.indexOf(from), to)))
        return
      }
      if (item.status === 'invalid') return toast(INVALID_MOVE, 'warn')
      const t = ed.targets.find((x) => x.id === target.boardId)
      return t && ed.place(item, t, from, to)
    }
  }

  const empty = (
    <div
      className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center"
      onClick={(e) => e.stopPropagation()}
    >
      <EmptyShelfArt />
      <div className="font-display text-[17px] font-semibold">这个站点还没有站牌</div>
      <p className="text-[12.5px] text-ink-3">从站架模板添加最快；也可以先加一个空白站架，再逐块加站牌。</p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => setPicker({ mode: 'add' })}>
          <Layers size={14} /> 从模板添加站架
        </Button>
        <Button onClick={addBlank}>
          <Plus size={14} /> 空白站架
        </Button>
      </div>
    </div>
  )

  return (
    <EditorCtx.Provider value={ed}>
      <DndContext
        sensors={sensors}
        collisionDetection={preferInner}
        onDragStart={(e) => setActive(resolve(String(e.active.id)))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        <div className="flex h-full flex-col">
          {/* 顶部 */}
          <header className="flex h-16 shrink-0 items-center gap-4 border-b border-hairline px-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-ink-3">
                <Link to="/sign-sets" className="inline-flex items-center hover:text-ink">
                  <ChevronLeft size={13} /> 站牌集
                </Link>
                <span>·</span>
                <Link to={`/stops/${view.stop.id}`} className="hover:text-ink">
                  站点详情
                </Link>
              </div>
              <h1 className="flex items-center gap-2 truncate font-display text-[20px] font-bold leading-7">
                {view.stop.name}
                <DirBadge dir={view.stop.direction} />
                <span className="font-sans text-[13px] font-normal text-ink-3">站牌集</span>
              </h1>
            </div>
            <div className="flex items-center gap-1.5" aria-label="编排计数">
              <StatusChip status="待编排" count={counts.waiting} />
              <StatusChip status="失效" count={counts.invalid} />
              <span className="ml-1 text-[12px] text-ink-3">
                已编排 {counts.placed} · 隐藏 {counts.hidden}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {dirty && (
                <span className="mr-1 inline-flex items-center gap-1.5 text-[12.5px] text-signal-ink">
                  <span className="gt-breathe size-1.5 rounded-full bg-signal" /> 未保存
                </span>
              )}
              <IconButton label="撤销（Ctrl+Z）" disabled={!hist.canUndo} onClick={hist.undo}>
                <Undo2 size={15} />
              </IconButton>
              <IconButton label="重做（Ctrl+Shift+Z）" disabled={!hist.canRedo} onClick={hist.redo}>
                <Redo2 size={15} />
              </IconButton>
              <HistoryButton
                type="signSet"
                id={view.id}
                name={`${stopName}站牌集`}
                spec={SIGN_SET_DIFF_SPEC}
                size="sm"
              />
              <Button
                size="sm"
                disabled={!dirty}
                onClick={() =>
                  setAsk({
                    title: '撤销全部未保存的修改？',
                    body: '站牌集会回到上次保存时的样子。',
                    ok: '撤销修改',
                    danger: true,
                    run: () => {
                      hist.reset(savedDraft)
                      setSel(null)
                      toast('已撤销本次未保存的修改', 'info')
                    },
                  })
                }
              >
                <RotateCcw size={13} /> 撤销修改
              </Button>
              <Button size="sm" variant="primary" disabled={saving} onClick={trySave}>
                <Save size={13} /> 保存
              </Button>
            </div>
          </header>

          {/* 立面 */}
          <div className="relative min-h-0 flex-1">
            <div
              className="absolute inset-0 overflow-auto bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_55%,var(--sunken)_130%)]"
              onClick={() => setSel(null)}
              data-testid="elevation-stage"
            >
              <div
                className="sticky left-0 top-0 z-[5] flex flex-wrap items-center gap-2 px-4 pt-3"
                onClick={(e) => e.stopPropagation()}
              >
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="sm">
                      <Plus size={13} /> 站架 <ChevronDown size={12} />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="start">
                    <MenuItem onSelect={() => setPicker({ mode: 'add' })}>
                      <Layers size={14} /> 从模板添加…
                    </MenuItem>
                    <MenuItem onSelect={addBlank}>
                      <Plus size={14} /> 空白站架
                    </MenuItem>
                  </MenuContent>
                </Menu>
                <Segmented<Zoom>
                  size="sm"
                  label="立面比例"
                  value={zoom}
                  onChange={setZoom}
                  options={(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => ({ value: z, label: ZOOM_LABEL[z] }))}
                />
                <span className="text-[12px] text-ink-3">
                  {draft.shelves.length} 个站架 · 点站架、站牌或插片编辑属性
                </span>
                {invalidKeys.length > 0 && (
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    onClick={() => {
                      ed.run((d) => clearInvalid(d, invalidKeys))
                      toast(`已清理 ${invalidKeys.length} 条失效编排`, 'info')
                    }}
                  >
                    <Trash2 size={13} /> 清理 {invalidKeys.length} 条失效编排
                  </Button>
                )}
              </div>
              <Reminder
                open={noteOpen}
                onOpen={setNoteOpen}
                value={draft.reminder}
                onChange={(v) => ed.run((d) => ({ ...d, reminder: v }), 'reminder')}
              />
              <Elevation
                draft={draft}
                pool={pool}
                zoom={zoom}
                empty={empty}
                edit={{
                  sel,
                  onSelect: setSel,
                  onRemove: ed.removeSchedule,
                  onAddBoard: (shelfId) => {
                    let id = ''
                    if (
                      ed.run((d) => {
                        const r = addBoard(d, shelfId)
                        id = r.boardId
                        return r.draft
                      })
                    )
                      setSel({ type: 'board', id })
                  },
                  onMove: (id, delta) => ed.run((d) => moveWithin(d, id, delta)),
                  menu: (s, item) => <ScheduleMenu s={s} item={item} />,
                  dragging: Boolean(active),
                }}
              />
            </div>
            <Inspector onReapply={(shelfId) => setPicker({ mode: 'reapply', shelfId })} />
          </div>

          <Tray open={trayOpen} onToggle={() => setTrayOpen((o) => !o)} dragging={Boolean(active)} />
        </div>
        <DragOverlay dropAnimation={null}>
          {active && (
            <div className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3 shadow-pop ring-2 ring-accent">
              <PassageLabel item={active.item} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TemplatePicker
        open={Boolean(picker)}
        onOpenChange={(o) => !o && setPicker(null)}
        mode={picker?.mode ?? 'add'}
        onPick={(ts) => (picker?.mode === 'reapply' ? reapply(picker.shelfId, ts[0]) : addFromTemplates(ts))}
      />
      <Dialog
        open={Boolean(ask)}
        onOpenChange={(o) => !o && setAsk(null)}
        title={ask?.title}
        footer={
          <>
            <Button onClick={() => setAsk(null)}>取消</Button>
            <Button
              variant={ask?.danger ? 'danger' : 'primary'}
              onClick={() => {
                ask?.run()
                setAsk(null)
              }}
            >
              {ask?.ok}
            </Button>
          </>
        }
      >
        <p>{ask?.body}</p>
      </Dialog>
      <Dialog
        open={Boolean(warn)}
        onOpenChange={(o) => !o && setWarn(null)}
        title="保存前请确认"
        footer={
          <>
            <Button onClick={() => setWarn(null)}>回去补上</Button>
            <Button variant="primary" onClick={() => void save()}>
              仍然保存
            </Button>
          </>
        }
      >
        <p className="mb-2">这些情况可以保存，但通常是漏填了：</p>
        <ul className="list-disc space-y-1 pl-5">
          {warn?.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="站牌集有未保存的修改"
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>留在这里</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              放弃修改并离开
            </Button>
          </>
        }
      >
        <p>离开后这些修改不会保存。</p>
      </Dialog>
      {flow.conflict && (
        <ConflictDialog
          open
          onOpenChange={(o) => !o && flow.clearConflict()}
          latest={signSetSnapshotOf(
            { id: view.stop.id, name: stopName },
            flow.conflict.latest,
            routeName(flow.conflict.latest.routes),
          )}
          mine={signSetSnapshotOf({ id: view.stop.id, name: stopName }, draft, routeName(view.routes))}
          spec={SIGN_SET_DIFF_SPEC}
          onReload={() => {
            const latest = flow.conflict!.latest
            setView(latest)
            setSavedDraft(draftOf(latest))
            hist.reset(draftOf(latest))
            setSel(null)
            flow.clearConflict()
          }}
        />
      )}
    </EditorCtx.Provider>
  )
}

/** 温馨提示：立面上方一条可展开的便签 */
function Reminder({
  open,
  onOpen,
  value,
  onChange,
}: {
  open: boolean
  onOpen: (o: boolean) => void
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="mx-auto mt-3 w-[min(720px,calc(100%-48px))]" onClick={(e) => e.stopPropagation()}>
      {open ? (
        <div className="gt-rise relative rounded-xl bg-signal-soft/60 px-4 pb-2 pt-2.5 shadow-xs ring-1 ring-signal/30">
          <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-signal-ink">
            <NotebookPen size={13} /> 温馨提示
            <span className="ml-auto font-normal tabular-nums text-signal-ink/70">{value.length} / 1000</span>
            <button type="button" className="font-normal hover:underline" onClick={() => onOpen(false)}>
              收起
            </button>
          </div>
          <textarea
            aria-label="温馨提示"
            value={value}
            maxLength={1000}
            rows={2}
            placeholder="如线路临时调整说明，会印在站牌上"
            onChange={(e) => onChange(e.target.value)}
            className="w-full resize-y bg-transparent text-[13.5px] leading-relaxed text-ink placeholder:text-signal-ink/50 focus:outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(true)}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-4 py-2 text-left text-[12.5px] ring-1 transition-colors',
            value
              ? 'bg-signal-soft/50 text-signal-ink ring-signal/25 hover:bg-signal-soft'
              : 'border border-dashed border-hairline-2 text-ink-3 ring-transparent hover:text-ink',
          )}
        >
          <NotebookPen size={13} />
          {value ? <span className="truncate">温馨提示：{value}</span> : '添加温馨提示'}
        </button>
      )}
    </div>
  )
}
