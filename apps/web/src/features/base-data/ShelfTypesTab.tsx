// 站架类型（M7 计划 5.1 节）：按结构形式分组的卡片（2D 剪影、名称、引用数、待核对）。
// 新建先从预设库选一个起步，或选"空白"再选形式；编辑：左侧属性表填参数，右侧实时预览（2D 带参考线 / 3D）
import {
  SHELF_FORMS,
  SHELF_FORM_HINT,
  SHELF_FORM_LABEL,
  SHELF_PARAM_DEFAULTS,
  SHELF_PRESETS,
  parseShelfSpec,
  shelfParamFields,
  shelfTypeInput,
  switchForm,
  type ShelfForm,
  type ShelfParamField,
  type ShelfSpec,
  type ShelfTypeItem,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { Box, Pencil, Plus, Ruler, Trash2, TriangleAlert } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useDeleteFlow } from '@/components/gt/confirm'
import { EmptyShelfArt, OrbitLoader } from '@/components/gt/lively'
import { FieldError, GhostInput, GhostSelect, GhostTextarea, Prop } from '@/components/gt/prop'
import { ShelfPreview2D, ShelfSilhouette, sampleFaces } from '@/components/gt/shelf-art'
import { Segmented } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { keys, useShelfTypes } from '@/features/common/data'
import { templatesKey, useShelfTemplates } from '@/features/sign-sets/data'
import { del, isApiError, patch, post } from '@/lib/api'
import { cn, useStored } from '@/lib/utils'
import { buildShelfModel } from '@/shelf-model'

const Shelf3D = lazy(() => import('@/three/ShelfScene3D'))

interface Draft {
  name: string
  desc: string
  spec: ShelfSpec
}

const refText = (t: Pick<ShelfTypeItem, 'shelfCount' | 'templateCount'>) =>
  `${t.shelfCount} 个站架 · ${t.templateCount} 个模板`

export function ShelfTypesTab() {
  const q = useShelfTypes()
  const templates = useShelfTemplates().data
  const qc = useQueryClient()
  const { ask, dialogs } = useDeleteFlow()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<{ item: ShelfTypeItem | null; draft: Draft } | null>(null)
  const list = q.data ?? []
  const review = list.filter((t) => t.needsReview).length
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.shelfTypes })
    // 名称、结构变了：站牌集、模板里显示的类型跟着变
    void qc.invalidateQueries({ queryKey: templatesKey })
    void qc.invalidateQueries({ queryKey: ['sign-sets'] })
  }
  const sampleOf = (id: string) => templates?.find((t) => t.type.id === id)?.boards
  const open = (t: ShelfTypeItem) =>
    setEditing({ item: t, draft: { name: t.name, desc: t.desc, spec: parseShelfSpec(t.form, t.params) } })

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[18px] font-semibold">站架类型</h2>
          <p className="text-[12.5px] text-ink-3">
            结构形式与尺寸决定站架在立面、3D 里的样子和可用的面；改参数后所有引用它的站架立即按新参数显示，不生成快照。
          </p>
        </div>
        <Button variant="primary" onClick={() => setPicking(true)}>
          <Plus size={14} /> 新建站架类型
        </Button>
      </div>

      {review > 0 && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl bg-signal-soft/70 px-4 py-3 text-[13px] text-signal-ink ring-1 ring-signal/30"
          role="status"
          data-testid="review-banner"
        >
          <ReviewStamp />
          <span>
            有 <b className="tabular-nums">{review}</b>{' '}
            个站架类型由字典迁移而来，形式是按名称识别的，请逐个核对。保存一次后不再提示。
          </span>
        </div>
      )}

      {q.isSuccess && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-[13px] text-ink-3">
          <EmptyShelfArt />
          还没有站架类型，从预设库新建一个
        </div>
      )}

      <div className="flex flex-wrap gap-x-8 gap-y-6">
        {SHELF_FORMS.map((form) => {
          const items = list.filter((t) => t.form === form)
          if (!items.length) return null
          return (
            <section key={form} aria-label={SHELF_FORM_LABEL[form]} className="min-w-0">
              <div className="mb-2 flex items-baseline gap-2" title={SHELF_FORM_HINT[form]}>
                <span className="eyebrow">{SHELF_FORM_LABEL[form]}</span>
                <span className="text-[12px] tabular-nums text-ink-4">{items.length}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {items.map((t) => {
                  const used = t.shelfCount + t.templateCount
                  return (
                    <article
                      key={t.id}
                      className="group relative flex w-[236px] cursor-pointer flex-col overflow-hidden rounded-2xl bg-surface ring-1 ring-hairline transition-[box-shadow,transform] duration-300 ease-[var(--spring)] hover:-translate-y-0.5 hover:shadow-float"
                      onClick={() => open(t)}
                      data-testid="shelf-type-card"
                      aria-label={t.name}
                    >
                      <div className="flex h-[128px] items-end justify-center bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] px-4 pt-3">
                        <ShelfSilhouette
                          spec={parseShelfSpec(t.form, t.params)}
                          boards={sampleOf(t.id)}
                          className="h-[112px] max-w-full transition-transform duration-500 ease-[var(--spring)] group-hover:scale-[1.04]"
                        />
                      </div>
                      {t.needsReview && (
                        <span className="absolute left-2.5 top-2.5 rotate-[-4deg] rounded-md bg-signal-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal-ink ring-1 ring-signal/40">
                          待核对
                        </span>
                      )}
                      <div className="flex items-start gap-2 px-3.5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-semibold">{t.name}</div>
                          <div className="mt-0.5 text-[12px] tabular-nums text-ink-3">{refText(t)}</div>
                          {t.desc && <div className="mt-1 truncate text-[12.5px] text-ink-2">{t.desc}</div>}
                        </div>
                        <span
                          className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconButton label={`编辑 ${t.name}`} className="size-7" onClick={() => open(t)}>
                            <Pencil size={13} />
                          </IconButton>
                          <span title={used ? `被 ${refText(t)}引用，不能删除` : undefined}>
                            <IconButton
                              label={`删除 ${t.name}`}
                              className="size-7"
                              disabled={used > 0}
                              onClick={() =>
                                ask({
                                  title: `删除站架类型「${t.name}」？`,
                                  body: <p>没有站架或模板引用它，删除后不能恢复。</p>,
                                  confirm: '删除站架类型',
                                  run: () => del(`/api/shelf-types/${t.id}`),
                                  done: refresh,
                                })
                              }
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </span>
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <PresetDialog
        open={picking}
        onOpenChange={setPicking}
        taken={new Set(list.map((t) => t.name))}
        onPick={(draft) => {
          setPicking(false)
          setEditing({ item: null, draft })
        }}
      />
      {editing && (
        <ShelfTypeDialog
          item={editing.item}
          initial={editing.draft}
          sample={editing.item ? sampleOf(editing.item.id) : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            refresh()
          }}
          onDelete={(t) =>
            ask({
              title: `删除站架类型「${t.name}」？`,
              body: <p>没有站架或模板引用它，删除后不能恢复。</p>,
              confirm: '删除站架类型',
              run: () => del(`/api/shelf-types/${t.id}`),
              done: () => {
                setEditing(null)
                refresh()
              },
            })
          }
        />
      )}
      {dialogs}
    </div>
  )
}

/** 待核对的小印章：波浪边，问号随悬停轻轻摆动 */
function ReviewStamp() {
  return (
    <svg viewBox="0 0 40 40" className="group/stamp size-9 shrink-0" aria-hidden>
      <path
        d="M20 3l3.2 2.6 4-.9 1.9 3.6 4 1.1-.2 4.1 3 2.8-1.8 3.7 1.8 3.7-3 2.8.2 4.1-4 1.1-1.9 3.6-4-.9L20 37l-3.2-2.6-4 .9-1.9-3.6-4-1.1.2-4.1-3-2.8 1.8-3.7-1.8-3.7 3-2.8-.2-4.1 4-1.1 1.9-3.6 4 .9z"
        fill="var(--surface)"
        stroke="var(--signal)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <g className="origin-center transition-transform duration-500 ease-[var(--bounce)] group-hover/stamp:rotate-[-12deg]">
        <path
          d="M16.5 16.2a3.6 3.6 0 1 1 5.3 3.2c-1.2.6-1.8 1.4-1.8 2.7"
          fill="none"
          stroke="var(--signal-ink)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="20" cy="25.6" r="1.3" fill="var(--signal-ink)" />
      </g>
    </svg>
  )
}

/* ---------------- 预设库 ---------------- */

/** 同名时加序号，保证名称唯一 */
const freeName = (name: string, taken: Set<string>) => {
  if (!taken.has(name)) return name
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`
}

function PresetDialog({
  open,
  onOpenChange,
  taken,
  onPick,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  taken: Set<string>
  onPick: (d: Draft) => void
}) {
  const [blank, setBlank] = useState(false)
  useEffect(() => {
    if (!open) setBlank(false)
  }, [open])
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={760}
      title="新建站架类型"
      description="先从预设库选一个起步，参数复制过来之后可以随意改；或者从空白开始，再选结构形式。"
    >
      <div className="grid grid-cols-4 gap-2.5" role="list" aria-label="预设库">
        {SHELF_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="listitem"
            aria-label={`预设：${p.name}`}
            onClick={() => onPick({ name: freeName(p.name, taken), desc: p.desc, spec: p.spec })}
            className="group flex flex-col overflow-hidden rounded-xl text-left ring-1 ring-hairline transition-[box-shadow,transform] duration-300 ease-[var(--spring)] hover:-translate-y-0.5 hover:shadow-float hover:ring-hairline-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex h-[92px] items-end justify-center bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] px-3 pt-2">
              <ShelfSilhouette spec={p.spec} className="h-[80px] max-w-full" />
            </span>
            <span className="px-2.5 py-2">
              <span className="block truncate text-[13px] font-medium">{p.name}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{p.desc}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          role="listitem"
          aria-label="空白"
          aria-expanded={blank}
          onClick={() => setBlank((b) => !b)}
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-[13px] transition-colors',
            blank ? 'border-accent text-accent' : 'border-hairline-2 text-ink-3 hover:border-accent hover:text-accent',
          )}
        >
          <Plus size={18} /> 空白
          <span className="text-[11.5px] text-ink-4">再选结构形式</span>
        </button>
      </div>
      {blank && (
        <div className="gt-rise mt-4 rounded-xl bg-surface-2 p-3 ring-1 ring-hairline">
          <div className="eyebrow mb-2">选结构形式</div>
          <FormPicker
            value={null}
            onChange={(form) =>
              onPick({ name: '', desc: '', spec: { form, params: SHELF_PARAM_DEFAULTS[form] } as ShelfSpec })
            }
          />
        </div>
      )}
    </Dialog>
  )
}

/** 六种结构形式：每个带默认参数的小剪影 */
function FormPicker({ value, onChange }: { value: ShelfForm | null; onChange: (f: ShelfForm) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="结构形式">
      {SHELF_FORMS.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={value === f}
          title={SHELF_FORM_HINT[f]}
          onClick={() => onChange(f)}
          className={cn(
            'flex flex-col items-center gap-1 rounded-lg px-1 pb-1.5 pt-2 text-[11.5px] ring-1 transition-colors',
            value === f
              ? 'bg-accent-soft font-semibold text-ink ring-2 ring-accent'
              : 'text-ink-2 ring-hairline hover:bg-surface hover:ring-hairline-2',
          )}
        >
          <ShelfSilhouette spec={{ form: f, params: SHELF_PARAM_DEFAULTS[f] } as ShelfSpec} className="h-9 w-12" />
          <span className="whitespace-nowrap">{SHELF_FORM_LABEL[f]}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------------- 编辑 ---------------- */

/** 毫米或整数参数：合法时才写回 */
function NumField({
  field,
  value,
  onChange,
}: {
  field: Extract<ShelfParamField, { kind: 'mm' | 'int' }>
  value: number
  onChange: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text)
  const ok = /^-?\d+$/.test(text.trim()) && n >= field.min && n <= field.max
  return (
    <>
      <span className="flex items-center gap-1.5">
        <GhostInput
          aria-label={field.label}
          aria-invalid={!ok}
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const v = Number(e.target.value)
            if (/^-?\d+$/.test(e.target.value.trim()) && v >= field.min && v <= field.max) onChange(v)
          }}
          className="w-28 font-mono text-[13px] tabular-nums"
        />
        <span className="text-[12px] text-ink-3">{field.kind === 'mm' ? 'mm' : field.unit}</span>
      </span>
      {!ok && <FieldError>{`${field.min}–${field.max} 的整数`}</FieldError>}
    </>
  )
}

function ParamControl({
  field,
  value,
  onChange,
}: {
  field: ShelfParamField
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (field.kind === 'mm' || field.kind === 'int')
    return <NumField field={field} value={value as number} onChange={onChange} />
  if (field.kind === 'bool')
    return <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
  if (field.options.length <= 3)
    return (
      <Segmented
        size="sm"
        label={field.label}
        value={String(value)}
        options={field.options.map((o) => ({ value: String(o.value), label: o.label }))}
        onChange={(v) => onChange(field.options.find((o) => String(o.value) === v)!.value)}
      />
    )
  return (
    <GhostSelect
      aria-label={field.label}
      value={String(value)}
      onChange={(e) => onChange(field.options.find((o) => String(o.value) === e.target.value)!.value)}
    >
      {field.options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </GhostSelect>
  )
}

type View = '2d' | '3d'

function ShelfTypeDialog({
  item,
  initial,
  sample,
  onClose,
  onSaved,
  onDelete,
}: {
  item: ShelfTypeItem | null
  initial: Draft
  sample?: Parameters<typeof sampleFaces>[1]
  onClose: () => void
  onSaved: () => void
  onDelete: (t: ShelfTypeItem) => void
}) {
  const toast = useToast()
  const [d, setD] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [switchTo, setSwitchTo] = useState<ShelfForm | null>(null)
  const [view, setView] = useStored<View>('gt-shelf-type-view', '2d')
  const spec = d.spec
  const params = spec.params as Record<string, unknown>
  const warnings = buildShelfModel(spec, sampleFaces(spec, sample)).warnings
  const used = item ? item.shelfCount + item.templateCount : 0
  const setParam = (k: string, v: unknown) =>
    setD((x) => ({ ...x, spec: { ...x.spec, params: { ...x.spec.params, [k]: v } } as ShelfSpec }))

  const save = async () => {
    const body = { name: d.name, desc: d.desc, form: spec.form, params: spec.params }
    const r = shelfTypeInput.safeParse(body)
    if (!r.success) {
      const i = r.error.issues[0]
      const field = shelfParamFields(spec.form).find((f) => f.key === i.path.at(-1))
      return setError(
        `${i.path[0] === 'name' ? '名称' : (field?.label ?? '')}${field || i.path[0] === 'name' ? '：' : ''}${i.message}`,
      )
    }
    setBusy(true)
    setError('')
    try {
      if (item) await patch(`/api/shelf-types/${item.id}`, body)
      else await post('/api/shelf-types', body)
      toast(item ? `已保存站架类型「${d.name.trim()}」` : `已新建站架类型「${d.name.trim()}」`)
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
      width={1080}
      title={item ? `编辑站架类型「${item.name}」` : '新建站架类型'}
      description={
        item
          ? used
            ? `${refText(item)}引用它：保存后它们立即按新参数显示，不生成快照。`
            : '还没有站架或模板引用它。'
          : '参数以毫米为单位；预览里的站牌是示意。'
      }
      footer={
        <>
          {item && (
            <span title={used ? `被 ${refText(item)}引用，不能删除` : undefined} className="mr-auto">
              <Button variant="ghost" disabled={used > 0} onClick={() => onDelete(item)}>
                <Trash2 size={13} /> 删除
              </Button>
            </span>
          )}
          <FieldError>{error}</FieldError>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy || !d.name.trim()} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6">
        <div className="min-w-0">
          {item?.needsReview && (
            <div className="mb-3 flex items-start gap-2 rounded-xl bg-signal-soft/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-signal-ink ring-1 ring-signal/30">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                这个类型由字典迁移而来，结构形式是按名称识别的（{SHELF_FORM_LABEL[item.form]}
                ），面数参考了现有站牌。核对形式与尺寸后保存，"待核对"即消失。
              </span>
            </div>
          )}
          <Prop label="名称" required>
            <GhostInput
              value={d.name}
              maxLength={50}
              placeholder="如：双立柱 · 双面"
              autoFocus={!item}
              onChange={(e) => setD({ ...d, name: e.target.value })}
            />
          </Prop>
          <div className="py-2">
            <div className="mb-1.5 text-[12.5px] text-ink-3">结构形式</div>
            <FormPicker value={spec.form} onChange={(f) => f !== spec.form && setSwitchTo(f)} />
          </div>
          <div className="mt-1 rounded-xl bg-surface-2/70 px-3 py-1 ring-1 ring-hairline" aria-label="参数">
            {shelfParamFields(spec.form).map((f) => (
              <Prop key={`${spec.form}.${f.key}`} label={f.label} hint={f.hint}>
                <ParamControl field={f} value={params[f.key]} onChange={(v) => setParam(f.key, v)} />
              </Prop>
            ))}
          </div>
          <Prop label="说明">
            <GhostTextarea
              value={d.desc}
              maxLength={200}
              rows={2}
              onChange={(e) => setD({ ...d, desc: e.target.value })}
            />
          </Prop>
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="eyebrow">预览</span>
            <Segmented<View>
              size="sm"
              label="预览方式"
              value={view}
              onChange={setView}
              options={[
                {
                  value: '2d',
                  label: (
                    <>
                      <Ruler size={12} /> 2D
                    </>
                  ),
                },
                {
                  value: '3d',
                  label: (
                    <>
                      <Box size={12} /> 3D
                    </>
                  ),
                },
              ]}
            />
            <span className="ml-auto text-[11.5px] text-ink-4">
              {sample?.length ? '示意站牌取第一个模板的结构' : '示意站牌每面一块 1200 × 1800'}
            </span>
          </div>
          <div className="relative h-[440px] overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_top,var(--surface)_0%,var(--surface-2)_60%,var(--sunken)_140%)] ring-1 ring-hairline">
            {view === '2d' ? (
              <ShelfPreview2D spec={spec} boards={sample} className="p-4" />
            ) : (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center gap-2 text-[12.5px] text-ink-3">
                    <OrbitLoader size={20} /> 正在载入 3D…
                  </div>
                }
              >
                <Shelf3D
                  shelves={[{ id: 'preview', spec, faces: sampleFaces(spec, sample), ghost: false }]}
                  onExit={() => setView('2d')}
                  compact
                />
              </Suspense>
            )}
          </div>
          {warnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-signal-ink">
              {warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5">
                  <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Dialog
        open={Boolean(switchTo)}
        onOpenChange={(o) => !o && setSwitchTo(null)}
        title={switchTo ? `改为${SHELF_FORM_LABEL[switchTo]}？` : ''}
        footer={
          <>
            <Button onClick={() => setSwitchTo(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                setD((x) => ({ ...x, spec: switchForm(x.spec, switchTo!) }))
                setSwitchTo(null)
              }}
            >
              改形式
            </Button>
          </>
        }
      >
        <p>保留牌面下沿离地与朝向，其余参数换成{switchTo && SHELF_FORM_LABEL[switchTo]}的默认值。保存前可以改回来。</p>
      </Dialog>
    </Dialog>
  )
}
