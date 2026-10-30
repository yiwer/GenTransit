// 批量修改站点（需求 5.3.2，M5 计划 4.8）：每个字段"不改 / 设为… / 清空"三档，默认不改；
// 市、区、街道作为一组；底部实时预览"选中多少、将变化多少"；确认后每个变化的站点各一份快照
import {
  STOP_BATCH_MAX,
  type DictCategory,
  type ExtFieldDef,
  type StopBatchInputRaw,
  type StopBatchPatch,
  type StopBatchPreview,
  type StopBatchResult,
} from '@gentransit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { OrbitLoader } from '@/components/gt/lively'
import { DictPicker } from '@/components/gt/pickers'
import { DirBadge, Segmented, Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useExtFields, useRegions } from '@/features/common/data'
import { isApiError, post } from '@/lib/api'
import { cn } from '@/lib/utils'

type Mode = 'keep' | 'set' | 'clear'
type FieldKey =
  | 'region'
  | 'roadId'
  | 'maintainerId'
  | 'platformTypeId'
  | 'safetyId'
  | 'shelterTypeId'
  | 'berths'
  | 'bigLightbox'
  | 'smallLightbox'
  | 'seats'
  | 'waiting'
  | `ext.${string}`

const DICT_FIELDS: [FieldKey, string, DictCategory][] = [
  ['roadId', '路段', 'road'],
  ['maintainerId', '维护公司', 'maintainer'],
  ['platformTypeId', '站台类型', 'platformType'],
  ['safetyId', '安全设施', 'safety'],
  ['shelterTypeId', '候车亭类型', 'shelterType'],
]
const COUNT_FIELDS: [FieldKey, string][] = [
  ['berths', '泊位数'],
  ['bigLightbox', '大灯箱数'],
  ['smallLightbox', '小灯箱数'],
  ['seats', '座椅数'],
]
const FACILITY = new Set([
  'platformTypeId',
  'safetyId',
  'shelterTypeId',
  'berths',
  'bigLightbox',
  'smallLightbox',
  'seats',
  'waiting',
])

interface Row {
  mode: Mode
  value: unknown
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** 表单状态转成补丁：只放"设为""清空"的字段；"设为"但没填值的不算 */
function patchOf(rows: Record<string, Row>, extDefs: ExtFieldDef[]): StopBatchPatch | null {
  const p: StopBatchPatch = {}
  const fac: NonNullable<StopBatchPatch['facilities']> = {}
  const ext: Record<string, unknown> = {}
  for (const [k, r] of Object.entries(rows)) {
    if (r.mode === 'keep') continue
    const v = r.mode === 'clear' ? null : r.value
    if (r.mode === 'set' && (v === null || v === undefined || v === '')) continue
    if (k === 'region') p.region = (v as StopBatchPatch['region']) ?? null
    else if (k === 'roadId' || k === 'maintainerId') p[k] = v as string | null
    else if (k === 'waiting') fac.waiting = (v as string | null) ?? ''
    else if (FACILITY.has(k)) (fac as Record<string, unknown>)[k] = v
    else if (k.startsWith('ext.')) {
      const def = extDefs.find((d) => d.key === k.slice(4))
      ext[k.slice(4)] =
        v === null
          ? null
          : def?.type === 'number'
            ? Number(v)
            : def?.type === 'textList'
              ? String(v)
                  .split(/[、,，]/)
                  .map((x) => x.trim())
              : v
    }
  }
  if (Object.keys(fac).length) p.facilities = fac
  if (Object.keys(ext).length) p.ext = ext
  return Object.keys(p).length ? p : null
}

export function BatchEditDialog({
  open,
  onOpenChange,
  scope,
  count,
  onDone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  scope: StopBatchInputRaw['scope']
  count: number
  onDone: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const ext = (useExtFields('stop').data ?? []).filter((d) => d.enabled)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [saving, setSaving] = useState(false)
  const [showSample, setShowSample] = useState(false)
  useEffect(() => {
    if (open) setRows({})
  }, [open])
  const row = (k: FieldKey): Row => rows[k] ?? { mode: 'keep', value: null }
  const setRow = (k: FieldKey, r: Partial<Row>) => setRows((x) => ({ ...x, [k]: { ...row(k), ...r } }))
  const patch = patchOf(rows, ext)
  const body = useDebounced(patch ? { scope, patch } : null, 300)
  const preview = useQuery({
    queryKey: ['stops', 'batch-preview', JSON.stringify(body)],
    enabled: open && Boolean(body),
    queryFn: () => post<StopBatchPreview>('/api/stops/batch/preview', body),
    retry: false,
  })

  const submit = async () => {
    if (!patch) return
    setSaving(true)
    try {
      const r = await post<StopBatchResult>('/api/stops/batch', { scope, patch })
      toast(
        r.changed ? `已修改 ${r.changed} 个站点，各生成一份修改快照` : '选中的站点本来就是这些值，没有修改',
        r.changed ? 'ok' : 'info',
      )
      await qc.invalidateQueries({ queryKey: ['stops'] })
      onDone()
      onOpenChange(false)
    } catch (e) {
      toast(isApiError(e) ? e.message : '批量修改失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const field = (k: FieldKey, label: string, editor: React.ReactNode, tag?: string) => {
    const r = row(k)
    return (
      <div
        key={k}
        className="grid grid-cols-[112px_168px_minmax(0,1fr)] items-center gap-3 border-b border-hairline py-2 last:border-0"
      >
        <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
          {label}
          {tag && <Tag className="h-4 px-1.5 text-[10.5px]">{tag}</Tag>}
        </span>
        <Segmented<Mode>
          size="sm"
          label={`${label}怎么改`}
          value={r.mode}
          onChange={(mode) => setRow(k, { mode })}
          options={[
            { value: 'keep', label: '不改' },
            { value: 'set', label: '设为' },
            { value: 'clear', label: '清空' },
          ]}
        />
        <span className={cn('min-w-0', r.mode !== 'set' && 'pointer-events-none opacity-35')}>{editor}</span>
      </div>
    )
  }
  const num = (k: FieldKey) => (
    <input
      type="number"
      min={0}
      aria-label={k}
      value={(row(k).value as number | null) ?? ''}
      onChange={(e) => setRow(k, { value: e.target.value === '' ? null : Number(e.target.value), mode: 'set' })}
      className="h-8 w-28 rounded-lg bg-sunken px-2.5 text-[13px] focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
    />
  )
  const text = (k: FieldKey, type = 'text') => (
    <input
      type={type}
      aria-label={k}
      value={(row(k).value as string | null) ?? ''}
      onChange={(e) => setRow(k, { value: e.target.value, mode: 'set' })}
      className="h-8 w-full rounded-lg bg-sunken px-2.5 text-[13px] focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
    />
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={720}
      title={`批量修改 ${count} 个站点`}
      description={`每个字段默认"不改"；一次最多 ${STOP_BATCH_MAX} 个站点。确认后每个真的有变化的站点各生成一份修改快照`}
      footer={
        <>
          <span className="mr-auto text-[12.5px]" data-testid="batch-preview">
            {!patch ? (
              <span className="text-ink-3">选一个字段改成"设为"或"清空"</span>
            ) : preview.isFetching ? (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <OrbitLoader size={14} /> 正在预览…
              </span>
            ) : preview.error ? (
              <span className="text-danger">{isApiError(preview.error) ? preview.error.message : '预览失败'}</span>
            ) : preview.data ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-ink-2 hover:text-ink"
                onClick={() => setShowSample((x) => !x)}
              >
                选中 <b>{preview.data.selected}</b> 个，将变化 <b className="text-accent">{preview.data.changing}</b> 个
                {preview.data.sample.length > 0 && (
                  <ChevronDown size={13} className={cn('transition-transform', showSample && 'rotate-180')} />
                )}
              </button>
            ) : null}
          </span>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={!patch || saving || !preview.data?.changing}
            onClick={() => void submit()}
          >
            {saving ? (
              <>
                <OrbitLoader size={14} /> 正在修改 {preview.data?.changing} 个站点…
              </>
            ) : (
              <>修改 {preview.data?.changing || ''} 个站点</>
            )}
          </Button>
        </>
      }
    >
      <div className="max-h-[56vh] overflow-auto pr-1">
        {showSample && preview.data && preview.data.sample.length > 0 && (
          <ul
            className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px] ring-1 ring-hairline"
            aria-label="将变化的站点"
          >
            {preview.data.sample.map((x) => (
              <li key={x.id} className="flex items-center gap-2 py-0.5">
                <span className="font-display font-semibold">{x.name}</span>
                <DirBadge dir={x.direction} size="sm" />
                <span className="truncate text-ink-3">{x.fields.join('、')}</span>
              </li>
            ))}
            {preview.data.changing > preview.data.sample.length && (
              <li className="pt-0.5 text-ink-3">…另有 {preview.data.changing - preview.data.sample.length} 个</li>
            )}
          </ul>
        )}
        <div className="eyebrow mb-1">位置</div>
        {field(
          'region',
          '市 / 区 / 街道',
          <RegionSelect
            value={row('region').value as RegionValue | null}
            onChange={(v) => setRow('region', { value: v, mode: 'set' })}
          />,
        )}
        {DICT_FIELDS.slice(0, 2).map(([k, label, cat]) =>
          field(
            k,
            label,
            <DictPicker
              category={cat}
              value={(row(k).value as string | null) ?? null}
              onChange={(id) => setRow(k, { value: id, mode: 'set' })}
            />,
          ),
        )}
        <div className="eyebrow mb-1 mt-4">站台设施</div>
        {DICT_FIELDS.slice(2).map(([k, label, cat]) =>
          field(
            k,
            label,
            <DictPicker
              category={cat}
              value={(row(k).value as string | null) ?? null}
              onChange={(id) => setRow(k, { value: id, mode: 'set' })}
            />,
          ),
        )}
        {COUNT_FIELDS.map(([k, label]) => field(k, label, num(k)))}
        {field('waiting', '候车设施', text('waiting'))}
        {ext.length > 0 && <div className="eyebrow mb-1 mt-4">扩展字段</div>}
        {ext.map((d) => {
          const k = `ext.${d.key}` as FieldKey
          return field(
            k,
            d.name,
            d.type === 'select' ? (
              <select
                aria-label={d.name}
                value={(row(k).value as string | null) ?? ''}
                onChange={(e) => setRow(k, { value: e.target.value || null, mode: 'set' })}
                className="h-8 rounded-lg bg-sunken px-2 text-[13px]"
              >
                <option value="">—</option>
                {d.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              text(k, d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : d.type === 'time' ? 'time' : 'text')
            ),
            '扩展',
          )
        })}
      </div>
    </Dialog>
  )
}

type RegionValue = { cityId: string | null; districtId: string | null; streetId: string | null }

/** 三级联动：换上级时清空下级 */
function RegionSelect({ value, onChange }: { value: RegionValue | null; onChange: (v: RegionValue) => void }) {
  const regions = useRegions().data ?? []
  const v = value ?? { cityId: null, districtId: null, streetId: null }
  const of = (level: string, parentId: string | null) =>
    regions.filter((r) => r.level === level && (level === 'city' || r.parentId === parentId))
  const sel = (
    label: string,
    items: { id: string; name: string }[],
    cur: string | null,
    next: (id: string | null) => void,
  ) => (
    <select
      aria-label={label}
      value={cur ?? ''}
      onChange={(e) => next(e.target.value || null)}
      className="h-8 min-w-0 flex-1 rounded-lg bg-sunken px-2 text-[13px]"
    >
      <option value="">{label}</option>
      {items.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  )
  return (
    <span className="flex gap-1.5">
      {sel('市', of('city', null), v.cityId, (cityId) => onChange({ cityId, districtId: null, streetId: null }))}
      {sel('区', of('district', v.cityId), v.districtId, (districtId) =>
        onChange({ ...v, districtId, streetId: null }),
      )}
      {sel('街道', of('street', v.districtId), v.streetId, (streetId) => onChange({ ...v, streetId }))}
    </span>
  )
}
