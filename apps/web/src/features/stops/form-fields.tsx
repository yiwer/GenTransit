// 站点表单的属性表分节：基本、位置、地标、站台设施、其他、照片；扩展字段按显示分区放进对应分节
import {
  DIRECTIONS,
  MAX_STOP_PHOTOS,
  type ExtFieldDef,
  type LandmarkCandidate,
  type RegeoMatch,
  type RegeoResult,
  type StopSection,
} from '@gentransit/shared'
import { ArrowLeft, ArrowRight, ImagePlus, MapPin, Plus, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { DictPicker, RegionPicker } from '@/components/gt/pickers'
import { FieldError, GhostInput, GhostSelect, GhostTextarea, Prop } from '@/components/gt/prop'
import { Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { useLandmarks, useRegions } from '@/features/common/data'
import { isApiError, uploadFile } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Draft } from './draft'

export interface FieldsProps {
  d: Draft
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void
  patch: (p: Partial<Draft>) => void
  errors: Record<string, string>
  extDefs: ExtFieldDef[]
}

const num = (v: string) => (v === '' ? null : Number(v))

function ExtFields({ section, d, set, extDefs, errors }: FieldsProps & { section: StopSection }) {
  const defs = extDefs.filter((f) => f.enabled && f.section === section)
  const setExt = (k: string, v: unknown) => set('ext', { ...d.ext, [k]: v })
  return defs.map((f) => {
    const v = d.ext[f.key]
    const label = (
      <span className="inline-flex items-center gap-1.5">
        {f.name} <Tag className="h-4 px-1.5 text-[10.5px]">扩展</Tag>
      </span>
    )
    let control: ReactNode
    if (f.type === 'select')
      control = (
        <GhostSelect value={(v as string) ?? ''} onChange={(e) => setExt(f.key, e.target.value || null)}>
          <option value="">未填写</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </GhostSelect>
      )
    else if (f.type === 'textList')
      control = (
        <GhostTextarea
          placeholder="每行一项"
          value={Array.isArray(v) ? (v as string[]).join('\n') : ''}
          onChange={(e) => setExt(f.key, e.target.value ? e.target.value.split('\n') : null)}
        />
      )
    else
      control = (
        <GhostInput
          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
          value={v === null || v === undefined ? '' : String(v)}
          placeholder="—"
          onChange={(e) =>
            setExt(f.key, e.target.value === '' ? null : f.type === 'number' ? Number(e.target.value) : e.target.value)
          }
        />
      )
    return (
      <Prop
        key={f.key}
        label={label}
        hint={f.description || undefined}
        align={f.type === 'textList' ? 'start' : 'center'}
      >
        {control}
        <FieldError>{errors[`ext.${f.key}`]}</FieldError>
      </Prop>
    )
  })
}

/* ---------------- 基本 ---------------- */

export function BasicFields(p: FieldsProps & { mode: 'orientation' | 'code'; autoFocus: boolean; dupError: string }) {
  const { d, set, errors } = p
  return (
    <>
      <Prop label="站名" required>
        <GhostInput
          value={d.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="如：人民广场"
          autoFocus={p.autoFocus}
          aria-invalid={Boolean(p.dupError) || undefined}
          className="font-display text-[16px] font-semibold"
        />
        <FieldError>{p.dupError || (d.name ? errors.name : '')}</FieldError>
      </Prop>
      {p.mode === 'orientation' ? (
        <Prop label="方位" required hint="设置里可切换为编码模式">
          <div role="radiogroup" aria-label="方位" className="flex flex-wrap gap-1">
            {DIRECTIONS.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={d.direction === x}
                onClick={() => set('direction', x)}
                className={cn(
                  'h-8 min-w-9 rounded-lg px-2 text-[13.5px] font-medium transition-all duration-300 ease-[var(--bounce)]',
                  d.direction === x
                    ? 'scale-[1.04] bg-accent text-accent-ink shadow-xs'
                    : 'text-ink-2 ring-1 ring-hairline-2 hover:text-ink hover:ring-accent/40',
                )}
              >
                {x}
              </button>
            ))}
          </div>
          <FieldError>{errors.direction}</FieldError>
        </Prop>
      ) : (
        <Prop label="编码" required hint="编码模式：与站名一起区分同名站点">
          <GhostInput value={d.direction} onChange={(e) => set('direction', e.target.value)} placeholder="如：A1" />
          <FieldError>{errors.direction}</FieldError>
        </Prop>
      )}
      <Prop label="英文名">
        <GhostInput
          value={d.nameEn}
          onChange={(e) => set('nameEn', e.target.value)}
          placeholder="Renmin Square"
          className="italic"
        />
        <FieldError>{errors.nameEn}</FieldError>
      </Prop>
      <Prop label="二维码 URL">
        <GhostInput value={d.qrUrl} onChange={(e) => set('qrUrl', e.target.value)} placeholder="https://" />
        <FieldError>{errors.qrUrl}</FieldError>
      </Prop>
      <ExtFields {...p} section="basic" />
    </>
  )
}

/* ---------------- 位置 ---------------- */

function CoordInput({
  value,
  onCommit,
  placeholder,
  label,
}: {
  value: number | null
  onCommit: (v: number) => void
  placeholder: string
  label: string
}) {
  const [t, setT] = useState(value === null ? '' : value.toFixed(6))
  useEffect(() => setT(value === null ? '' : value.toFixed(6)), [value])
  return (
    <GhostInput
      aria-label={label}
      className="w-full font-mono text-[13px]"
      value={t}
      placeholder={placeholder}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        const n = Number(t)
        if (t && Number.isFinite(n)) onCommit(n)
        else setT(value === null ? '' : value.toFixed(6))
      }}
    />
  )
}

export interface Suggestion {
  loading: boolean
  result: RegeoResult | null
}

export function LocationFields(
  p: FieldsProps & {
    suggestion: Suggestion
    onAccept: () => void
    onDismiss: () => void
  },
) {
  const { d, set, patch, errors, suggestion } = p
  const regions = useRegions()
  const all = regions.data ?? []
  const r = suggestion.result
  const items = r
    ? (
        [
          ['市', r.city, d.cityId],
          ['区', r.district, d.districtId],
          ['街道', r.street, d.streetId],
          ['路段', r.road, d.roadId],
        ] as [string, RegeoMatch | null, string | null][]
      ).filter(([, m, cur]) => m && m.name && (!m.match || m.match.id !== cur))
    : []
  return (
    <>
      <Prop label="经纬度" required hint="GCJ-02；也可以直接在地图上点选或拖动标记">
        <div className="grid grid-cols-2 gap-3">
          <CoordInput
            label="经度"
            value={d.lng}
            onCommit={(v) => patch({ lng: v, lat: d.lat ?? 30.25 })}
            placeholder="经度 120.123456"
          />
          <CoordInput
            label="纬度"
            value={d.lat}
            onCommit={(v) => patch({ lat: v, lng: d.lng ?? 120.2 })}
            placeholder="纬度 30.123456"
          />
        </div>
        <FieldError>{errors.coord}</FieldError>
      </Prop>
      {(suggestion.loading || items.length > 0) && (
        <div
          className="gt-rise my-2 flex items-center gap-3 rounded-xl bg-accent-soft/70 px-3.5 py-2.5 text-[13px] ring-1 ring-accent/15"
          role="status"
        >
          {suggestion.loading ? (
            <>
              <OrbitLoader size={22} />
              <span className="text-ink-2">正在根据位置识别市、区、街道和路段…</span>
            </>
          ) : (
            <>
              <MapPin size={16} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="text-ink-3">建议填写 </span>
                {items.map(([label, m], i) => (
                  <span key={label} className="font-medium text-ink">
                    {i > 0 && <span className="mx-1 text-ink-4">·</span>}
                    {m!.match?.name ?? m!.name}
                    {!m!.match && (
                      <Tag className="ml-1 h-4 bg-signal-soft px-1.5 text-[10.5px] text-signal-ink">新建{label}</Tag>
                    )}
                  </span>
                ))}
              </span>
              <Button size="sm" variant="primary" onClick={p.onAccept}>
                采用
              </Button>
              <Button size="sm" variant="ghost" onClick={p.onDismiss}>
                忽略
              </Button>
            </>
          )}
        </div>
      )}
      <Prop label="市 / 区 / 街道">
        <div className="grid grid-cols-3 gap-3">
          <RegionPicker
            aria-label="市"
            level="city"
            value={d.cityId}
            placeholder="选择市"
            onChange={(id) => patch({ cityId: id, districtId: null, streetId: null })}
          />
          <RegionPicker
            aria-label="区"
            level="district"
            parentId={d.cityId ?? undefined}
            value={d.districtId}
            placeholder="选择区"
            onChange={(id) => {
              const r = all.find((x) => x.id === id)
              patch({ districtId: id, streetId: null, cityId: r?.parentId ?? d.cityId })
            }}
          />
          <RegionPicker
            aria-label="街道"
            level="street"
            parentId={d.districtId ?? undefined}
            value={d.streetId}
            placeholder="选择街道"
            onChange={(id) => {
              const st = all.find((x) => x.id === id)
              const di = all.find((x) => x.id === st?.parentId)
              patch({ streetId: id, districtId: di?.id ?? d.districtId, cityId: di?.parentId ?? d.cityId })
            }}
          />
        </div>
      </Prop>
      <Prop label="路段">
        <DictPicker
          aria-label="路段"
          category="road"
          value={d.roadId}
          placeholder="选择路段"
          onChange={(id) => set('roadId', id)}
        />
      </Prop>
    </>
  )
}

/* ---------------- 地标 ---------------- */

export function LandmarkFields({
  d,
  set,
  limit,
  autoMatch,
  candidates,
}: FieldsProps & { limit: number; autoMatch: boolean; candidates: LandmarkCandidate[] }) {
  const [q, setQ] = useState('')
  const search = useLandmarks(q.trim() ? { q: q.trim() } : undefined)
  const bound = new Set(d.landmarks.map((l) => l.id))
  const full = d.landmarks.length >= limit
  const cands = candidates.filter((c) => !bound.has(c.id))
  const bind = (l: { id: string; name: string; category: string }) => set('landmarks', [...d.landmarks, l])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {d.landmarks.map((l) => (
          <span
            key={l.id}
            className="gt-rise inline-flex h-8 items-center gap-1.5 rounded-full bg-sage-soft pl-3 pr-1 text-[13px] text-ink"
          >
            <span className="text-[11.5px] text-sage">{l.category}</span>
            {l.name}
            <IconButton
              label={`解除绑定 ${l.name}`}
              className="size-6 rounded-full"
              onClick={() =>
                set(
                  'landmarks',
                  d.landmarks.filter((x) => x.id !== l.id),
                )
              }
            >
              <X size={12} />
            </IconButton>
          </span>
        ))}
        {d.landmarks.length === 0 && <span className="text-[13px] text-ink-3">还没有绑定地标</span>}
        <span className="ml-auto text-[12px] tabular-nums text-ink-3">
          {d.landmarks.length} / {limit}
        </span>
      </div>
      {autoMatch && cands.length > 0 && (
        <div className="rounded-xl border border-dashed border-hairline-2 p-3">
          <div className="mb-2 text-[12px] text-ink-3">位置在这些地标的辐射范围内，点一下即可绑定</div>
          <div className="flex flex-wrap gap-1.5">
            {cands.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={full}
                onClick={() => bind({ id: l.id, name: l.name, category: l.category })}
                className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-sage ring-1 ring-sage/40 transition-colors hover:bg-sage-soft disabled:opacity-40"
              >
                <Plus size={13} /> {l.name}
                <span className="text-[11.5px] text-ink-3">{l.distance} 米</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input
          aria-label="搜索地标"
          value={q}
          disabled={full}
          onChange={(e) => setQ(e.target.value)}
          placeholder={full ? `已达到单站绑定上限 ${limit} 个` : '搜索地标手动绑定'}
          className="h-8 w-full rounded-lg bg-sunken pl-8 pr-2.5 text-[13.5px] text-ink placeholder:text-ink-4 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
        {q.trim() && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-[220px] overflow-auto rounded-xl bg-surface p-1 shadow-pop ring-1 ring-hairline">
            {(search.data ?? [])
              .filter((l) => !bound.has(l.id))
              .map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      bind({ id: l.id, name: l.name, category: l.category.name })
                      setQ('')
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-sunken"
                  >
                    <span className="text-[11.5px] text-sage">{l.category.name}</span>
                    {l.name}
                  </button>
                </li>
              ))}
            {search.isSuccess && !search.data.filter((l) => !bound.has(l.id)).length && (
              <li className="px-2 py-3 text-center text-[12.5px] text-ink-3">没有匹配的地标</li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ---------------- 站台设施 ---------------- */

export function FacilityFields(p: FieldsProps) {
  const { d, set, errors } = p
  const count = (k: 'berths' | 'bigLightbox' | 'smallLightbox' | 'seats', label: string) => (
    <Prop label={label}>
      <GhostInput
        type="number"
        min={0}
        value={d[k] ?? ''}
        placeholder="—"
        onChange={(e) => set(k, num(e.target.value))}
      />
      <FieldError>{errors[k]}</FieldError>
    </Prop>
  )
  return (
    <>
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          <Prop label="站台类型">
            <DictPicker category="platformType" value={d.platformTypeId} onChange={(id) => set('platformTypeId', id)} />
          </Prop>
          {count('berths', '泊位数')}
          <Prop label="候车亭类型">
            <DictPicker category="shelterType" value={d.shelterTypeId} onChange={(id) => set('shelterTypeId', id)} />
          </Prop>
          <Prop label="安全设施">
            <DictPicker category="safety" value={d.safetyId} onChange={(id) => set('safetyId', id)} />
          </Prop>
        </div>
        <div>
          {count('bigLightbox', '大灯箱数')}
          {count('smallLightbox', '小灯箱数')}
          {count('seats', '座椅数')}
          <Prop label="候车设施">
            <GhostInput value={d.waiting} placeholder="如：遮阳棚" onChange={(e) => set('waiting', e.target.value)} />
          </Prop>
        </div>
      </div>
      <ExtFields {...p} section="facility" />
    </>
  )
}

/* ---------------- 其他 ---------------- */

export function OtherFields(p: FieldsProps) {
  const { d, set, errors } = p
  return (
    <>
      <Prop label="维护公司">
        <DictPicker category="maintainer" value={d.maintainerId} onChange={(id) => set('maintainerId', id)} />
      </Prop>
      <Prop label="备注" align="start">
        <GhostTextarea
          value={d.remark}
          maxLength={500}
          placeholder="—"
          onChange={(e) => set('remark', e.target.value)}
        />
        <FieldError>{errors.remark}</FieldError>
      </Prop>
      <ExtFields {...p} section="other" />
    </>
  )
}

/* ---------------- 照片 ---------------- */

export function PhotoFields({ d, set }: FieldsProps) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const add = async (files: FileList | null) => {
    if (!files) return
    setBusy(true)
    const next = [...d.photos]
    try {
      for (const f of Array.from(files).slice(0, MAX_STOP_PHOTOS - next.length)) next.push(await uploadFile(f))
    } catch (e) {
      toast(isApiError(e) ? e.message : '上传失败', 'error')
    } finally {
      set('photos', next)
      setBusy(false)
    }
  }
  const move = (i: number, dir: -1 | 1) => {
    const next = [...d.photos]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    set('photos', next)
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      {d.photos.map((p, i) => (
        <div key={p.id} className="group relative h-[84px] w-[112px] overflow-hidden rounded-xl ring-1 ring-hairline">
          <img src={p.url} alt={p.originalName} className="size-full object-cover" />
          <div className="absolute inset-x-1 top-1 hidden justify-between group-hover:flex">
            <span className="flex gap-0.5">
              {i > 0 && (
                <button
                  type="button"
                  aria-label={`前移照片 ${i + 1}`}
                  onClick={() => move(i, -1)}
                  className="flex size-6 items-center justify-center rounded-full bg-black/45 text-white"
                >
                  <ArrowLeft size={12} />
                </button>
              )}
              {i < d.photos.length - 1 && (
                <button
                  type="button"
                  aria-label={`后移照片 ${i + 1}`}
                  onClick={() => move(i, 1)}
                  className="flex size-6 items-center justify-center rounded-full bg-black/45 text-white"
                >
                  <ArrowRight size={12} />
                </button>
              )}
            </span>
            <button
              type="button"
              aria-label={`删除照片 ${i + 1}`}
              onClick={() =>
                set(
                  'photos',
                  d.photos.filter((x) => x.id !== p.id),
                )
              }
              className="flex size-6 items-center justify-center rounded-full bg-black/45 text-white"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
      {d.photos.length < MAX_STOP_PHOTOS && (
        <label className="flex h-[84px] w-[112px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline-2 text-[12px] text-ink-3 transition-colors hover:border-accent hover:text-accent">
          {busy ? <OrbitLoader size={20} /> : <ImagePlus size={18} />}
          添加照片
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={busy}
            onChange={(e) => void add(e.target.files)}
          />
        </label>
      )}
      <span className="pb-1 text-[12px] text-ink-3">
        {d.photos.length} / {MAX_STOP_PHOTOS} · jpg、png、webp，单张不超过 10 MB
      </span>
    </div>
  )
}
