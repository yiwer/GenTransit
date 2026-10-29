// 站架模板（需求 5.7，M3 计划 4.5）：按站架类型分组，每个模板一张小卡（立面缩略结构 + 名称、说明、站牌数）。
// 编辑：左侧属性表与站牌结构表，右侧用立面组件实时预览；随时可删除，已生成的站架不受影响（BR-14）
import {
  BOARD_FACE_LABEL,
  BOARD_FACES,
  SIZE_MAX_MM,
  SLOT_NO_MAX,
  type BoardFace,
  type ShelfTemplate,
  type ShelfTemplateInputRaw,
  type TemplateBoard,
  type TemplateSlot,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ImagePlus, Layers, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useDeleteFlow } from '@/components/gt/confirm'
import { Elevation } from '@/components/gt/elevation'
import { EmptyShelfArt } from '@/components/gt/lively'
import { FieldError, GhostInput, GhostSelect, Prop } from '@/components/gt/prop'
import { Segmented } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useDict } from '@/features/common/data'
import { templatesKey, useShelfTemplates } from '@/features/sign-sets/data'
import { groupByType, templatePreview, templateSummary } from '@/features/sign-sets/TemplatePicker'
import { del, isApiError, post, put, uploadFile } from '@/lib/api'
import { cn } from '@/lib/utils'

export function ShelfTemplatesTab() {
  const q = useShelfTemplates()
  const qc = useQueryClient()
  const { ask, dialogs } = useDeleteFlow()
  const [editing, setEditing] = useState<ShelfTemplate | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: templatesKey })
  const list = q.data ?? []
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-[18px] font-semibold">站架模板</h2>
          <p className="text-[12.5px] text-ink-3">
            在站牌集编辑器里"从模板添加站架""重新套用模板"时使用；站架和模板之间不保留关联。
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> 新建模板
        </Button>
      </div>
      {q.isSuccess && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-[13px] text-ink-3">
          <EmptyShelfArt />
          还没有站架模板
        </div>
      )}
      <div className="flex flex-wrap gap-x-8 gap-y-6">
        {groupByType(list).map((g) => (
          <section key={g.type.id} aria-label={g.type.name} className="min-w-0">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="eyebrow">{g.type.name}</span>
              <span className="text-[12px] tabular-nums text-ink-4">{g.items.length}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {g.items.map((t) => (
                <article
                  key={t.id}
                  className="group flex w-[260px] flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-hairline transition-shadow hover:shadow-float"
                >
                  <div className="flex h-[132px] items-end justify-center bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)]">
                    <Elevation draft={templatePreview(t)} pool={[]} height={84} bare />
                  </div>
                  <div className="flex items-start gap-2 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{t.name}</div>
                      <div className="mt-0.5 text-[12px] leading-snug text-ink-3">
                        {t.boards.length} 块站牌 · {templateSummary(t)}
                        {t.noPhysical && ' · 无实物'}
                      </div>
                      {t.desc && <div className="mt-1 truncate text-[12.5px] text-ink-2">{t.desc}</div>}
                    </div>
                    <span className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
                      <IconButton label={`编辑 ${t.name}`} className="size-7" onClick={() => setEditing(t)}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        label={`删除 ${t.name}`}
                        className="size-7"
                        onClick={() =>
                          ask({
                            title: `删除模板「${t.name}」？`,
                            body: <p>已生成的站架不受影响；以后不能再从这个模板添加站架。</p>,
                            confirm: '删除模板',
                            run: () => del(`/api/shelf-templates/${t.id}`),
                            done: () => void refresh(),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {editing && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      {dialogs}
    </div>
  )
}

type Form = Omit<ShelfTemplateInputRaw, 'boards'> & { boards: TemplateBoard[] }

const newBoard = (): TemplateBoard => ({
  face: 'front',
  kind: 'whole',
  width: 1200,
  height: 1800,
  remark: '',
  slots: [],
})

/** 表格里的整数格：合法时才写回 */
function Num({
  value,
  onChange,
  label,
  max = SIZE_MAX_MM,
}: {
  value: number
  onChange: (v: number) => void
  label: string
  max?: number
}) {
  const [text, setText] = useState(String(value))
  const ok = /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= max
  return (
    <GhostInput
      aria-label={label}
      aria-invalid={!ok}
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (/^\d+$/.test(e.target.value) && n >= 1 && n <= max) onChange(n)
      }}
      className="w-full font-mono text-[12.5px] tabular-nums"
    />
  )
}

function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  template: ShelfTemplate | null
  onClose: () => void
  onSaved: () => void
}) {
  const types = useDict('shelfType').data ?? []
  const toast = useToast()
  const [v, setV] = useState<Form>(() =>
    template
      ? {
          name: template.name,
          typeId: template.type.id,
          desc: template.desc,
          noPhysical: template.noPhysical,
          imageId: template.image?.id ?? null,
          boards: template.boards,
        }
      : { name: '', typeId: types[0]?.id ?? '', desc: '', noPhysical: false, imageId: null, boards: [newBoard()] },
  )
  const [imageUrl, setImageUrl] = useState(template?.image?.url ?? null)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const typeId = v.typeId || types[0]?.id || ''
  const type = types.find((t) => t.id === typeId)
  const setBoard = (i: number, patch: Partial<TemplateBoard>) =>
    setV((x) => ({ ...x, boards: x.boards.map((b, j) => (j === i ? { ...b, ...patch } : b)) }))
  const setSlot = (i: number, k: number, patch: Partial<TemplateSlot>) =>
    setBoard(i, { slots: v.boards[i].slots.map((s, j) => (j === k ? { ...s, ...patch } : s)) })
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = { ...v, typeId }
      if (template) await put(`/api/shelf-templates/${template.id}`, body)
      else await post('/api/shelf-templates', body)
      toast(template ? '已保存站架模板' : '已新建站架模板')
      onSaved()
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={1040}
      title={template ? `编辑模板「${template.name}」` : '新建站架模板'}
      footer={
        <>
          <FieldError>{error}</FieldError>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={busy || !v.name.trim() || !typeId || !v.boards.length}
            onClick={() => void save()}
          >
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6">
        <div className="min-w-0">
          <Prop label="名称" required>
            <GhostInput
              value={v.name}
              maxLength={50}
              placeholder="如：双立柱 · 双面整版"
              autoFocus={!template}
              onChange={(e) => setV({ ...v, name: e.target.value })}
            />
          </Prop>
          <Prop label="站架类型" required hint="同一站架类型内模板名称不能重复">
            <GhostSelect value={typeId} onChange={(e) => setV({ ...v, typeId: e.target.value })}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </GhostSelect>
          </Prop>
          <Prop label="说明">
            <GhostInput value={v.desc ?? ''} maxLength={200} onChange={(e) => setV({ ...v, desc: e.target.value })} />
          </Prop>
          <Prop label="无实物站架">
            <Switch
              checked={Boolean(v.noPhysical)}
              onCheckedChange={(x) => setV({ ...v, noPhysical: x })}
              aria-label="无实物站架"
            />
          </Prop>
          <Prop label="示意图">
            <span className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center overflow-hidden rounded-lg bg-sunken ring-1 ring-hairline">
                {imageUrl ? (
                  <img src={imageUrl} alt="示意图" className="size-full object-cover" />
                ) : (
                  <ImagePlus size={16} className="text-ink-4" />
                )}
              </span>
              <label className="cursor-pointer text-[13px] font-medium text-accent hover:underline">
                {imageUrl ? '更换' : '上传'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    try {
                      const up = await uploadFile(f)
                      setV((x) => ({ ...x, imageId: up.id }))
                      setImageUrl(up.url)
                    } catch (err) {
                      setError(isApiError(err) ? err.message : '上传失败')
                    }
                  }}
                />
              </label>
              {imageUrl && (
                <button
                  type="button"
                  className="text-[13px] text-ink-3 hover:text-ink"
                  onClick={() => {
                    setV({ ...v, imageId: null })
                    setImageUrl(null)
                  }}
                >
                  移除
                </button>
              )}
            </span>
          </Prop>

          <div className="mb-1.5 mt-5 flex items-center gap-2">
            <span className="eyebrow">站牌结构</span>
            <span className="text-[12px] text-ink-4">{v.boards.length} 块，编号在套用时自动分配</span>
            <Button size="sm" className="ml-auto" onClick={() => setV({ ...v, boards: [...v.boards, newBoard()] })}>
              <Plus size={13} /> 加站牌
            </Button>
          </div>
          <div className="overflow-hidden rounded-xl ring-1 ring-hairline">
            <div className="grid grid-cols-[22px_76px_112px_70px_70px_1fr_28px] items-center gap-2 border-b border-hairline bg-surface-2 px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-3">
              <span />
              <span>面</span>
              <span>类型</span>
              <span>宽</span>
              <span>高</span>
              <span>备注</span>
              <span />
            </div>
            {v.boards.map((b, i) => (
              <div key={i} className="border-b border-hairline last:border-0">
                <div className="grid grid-cols-[22px_76px_112px_70px_70px_1fr_28px] items-center gap-2 px-2.5 py-1">
                  {b.kind === 'sliced' ? (
                    <IconButton
                      label={open === i ? '收起插片' : '展开插片'}
                      className="size-6"
                      onClick={() => setOpen(open === i ? null : i)}
                    >
                      {open === i ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </IconButton>
                  ) : (
                    <span className="text-center font-mono text-[11px] text-ink-4">{i + 1}</span>
                  )}
                  <GhostSelect
                    aria-label={`第 ${i + 1} 块站牌的面`}
                    value={b.face}
                    onChange={(e) => setBoard(i, { face: e.target.value as BoardFace })}
                    className="w-full text-[12.5px]"
                  >
                    {BOARD_FACES.map((f) => (
                      <option key={f} value={f}>
                        {BOARD_FACE_LABEL[f]}
                      </option>
                    ))}
                  </GhostSelect>
                  <Segmented
                    size="sm"
                    label={`第 ${i + 1} 块站牌的类型`}
                    value={b.kind}
                    options={[
                      { value: 'whole', label: '整版' },
                      { value: 'sliced', label: '分片' },
                    ]}
                    onChange={(k) => {
                      setBoard(i, {
                        kind: k,
                        slots:
                          k === 'sliced'
                            ? [{ no: 1, kind: 'route', note: '', width: b.width, height: Math.min(b.height, 360) }]
                            : [],
                      })
                      if (k === 'sliced') setOpen(i)
                    }}
                  />
                  <Num label={`第 ${i + 1} 块站牌宽`} value={b.width} onChange={(n) => setBoard(i, { width: n })} />
                  <Num label={`第 ${i + 1} 块站牌高`} value={b.height} onChange={(n) => setBoard(i, { height: n })} />
                  <GhostInput
                    aria-label={`第 ${i + 1} 块站牌备注`}
                    value={b.remark}
                    maxLength={200}
                    onChange={(e) => setBoard(i, { remark: e.target.value })}
                    className="w-full text-[12.5px]"
                  />
                  <IconButton
                    label={`删除第 ${i + 1} 块站牌`}
                    className="size-6"
                    onClick={() => setV({ ...v, boards: v.boards.filter((_, j) => j !== i) })}
                  >
                    <X size={13} />
                  </IconButton>
                </div>
                {b.kind === 'sliced' && open === i && (
                  <div className="gt-rise mx-2.5 mb-2 rounded-lg bg-surface-2 p-2 ring-1 ring-hairline">
                    {b.slots.map((s, k) => (
                      <div key={k} className="grid grid-cols-[52px_104px_1fr_64px_64px_24px] items-center gap-2 py-0.5">
                        <Num
                          label={`插片 ${k + 1} 编号`}
                          max={SLOT_NO_MAX}
                          value={s.no}
                          onChange={(n) => setSlot(i, k, { no: n })}
                        />
                        <Segmented
                          size="sm"
                          label={`插片 ${k + 1} 类型`}
                          value={s.kind}
                          options={[
                            { value: 'route', label: '线路' },
                            { value: 'other', label: '非线路' },
                          ]}
                          onChange={(kind) => setSlot(i, k, { kind })}
                        />
                        <GhostInput
                          aria-label={`插片 ${k + 1} 非线路说明`}
                          disabled={s.kind !== 'other'}
                          value={s.note}
                          maxLength={50}
                          placeholder={s.kind === 'other' ? '如：公告栏（必填）' : ''}
                          onChange={(e) => setSlot(i, k, { note: e.target.value })}
                          className={cn('w-full text-[12.5px]', s.kind === 'other' && !s.note && 'ring-danger/50')}
                        />
                        <Num label={`插片 ${k + 1} 宽`} value={s.width} onChange={(n) => setSlot(i, k, { width: n })} />
                        <Num
                          label={`插片 ${k + 1} 高`}
                          value={s.height}
                          onChange={(n) => setSlot(i, k, { height: n })}
                        />
                        <IconButton
                          label={`删除插片 ${k + 1}`}
                          className="size-6"
                          onClick={() => setBoard(i, { slots: b.slots.filter((_, j) => j !== k) })}
                        >
                          <X size={12} />
                        </IconButton>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const last = b.slots.at(-1)
                        const no = Math.max(0, ...b.slots.map((x) => x.no)) + 1
                        setBoard(i, {
                          slots: [
                            ...b.slots,
                            { no, kind: 'route', note: '', width: last?.width ?? 700, height: last?.height ?? 360 },
                          ],
                        })
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
                    >
                      <Plus size={12} /> 加插片
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!v.boards.length && <p className="px-3 py-4 text-center text-[12.5px] text-ink-3">至少要有一块站牌</p>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="eyebrow mb-1.5 flex items-center gap-1.5">
            <Layers size={12} /> 预览
          </div>
          <div className="flex min-h-[300px] flex-1 items-end justify-center rounded-2xl bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] ring-1 ring-hairline">
            <Elevation
              draft={templatePreview({
                type: { id: typeId, name: type?.name ?? '' },
                noPhysical: Boolean(v.noPhysical),
                boards: v.boards,
              })}
              pool={[]}
              zoom="compact"
            />
          </div>
        </div>
      </div>
    </Dialog>
  )
}
