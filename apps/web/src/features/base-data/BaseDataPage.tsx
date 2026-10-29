// 基础数据（5.7）：七类字典、行政区划（市 → 区 → 街道）、公交公司、站架模板（M3）
import {
  DICT_CATEGORIES,
  DICT_CATEGORY_LABEL,
  REGION_LEVEL_LABEL,
  type BusCompany,
  type CompanyInput,
  type DictCategory,
  type Region,
  type RegionLevel,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { NavLink, useParams } from 'react-router'
import { useDeleteFlow } from '@/components/gt/confirm'
import { InlineName } from '@/components/gt/inline-name'
import { FieldError } from '@/components/gt/prop'
import { PageHeader } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { keys, useCompanies, useDicts, useRegions } from '@/features/common/data'
import { del, isApiError, post, put, uploadFile } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ShelfTemplatesTab } from './ShelfTemplatesTab'

const TABS = [
  { to: 'dicts', label: '字典' },
  { to: 'regions', label: '行政区划' },
  { to: 'companies', label: '公交公司' },
  { to: 'shelf-templates', label: '站架模板' },
]

export function BaseDataPage() {
  const { tab = 'dicts' } = useParams()
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="基础数据"
        sub="被引用的字典项、行政区划、公交公司不能删除，只能改名；改名后所有引用处显示新名称"
      >
        <nav className="mt-4 flex gap-1" aria-label="基础数据分类">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={`/base-data/${t.to}`}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  isActive || (t.to === 'dicts' && tab === 'dicts')
                    ? 'bg-accent text-accent-ink'
                    : 'text-ink-2 ring-1 ring-hairline-2 hover:text-ink',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </PageHeader>
      <div className="min-h-0 flex-1 border-t border-hairline">
        {tab === 'dicts' && <DictTab />}
        {tab === 'regions' && <RegionTab />}
        {tab === 'companies' && <CompanyTab />}
        {tab === 'shelf-templates' && <ShelfTemplatesTab />}
      </div>
    </div>
  )
}

/** 列表顶部的"添加"输入 */
function AddRow({
  placeholder,
  onAdd,
  disabled,
}: {
  placeholder: string
  onAdd: (name: string) => Promise<unknown>
  disabled?: boolean
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = name.trim()
    if (!v) return
    try {
      await onAdd(v)
      setName('')
      setError('')
    } catch (err) {
      setError(isApiError(err) ? err.message : '添加失败')
    }
  }
  return (
    <form onSubmit={submit} className="mb-3">
      <div className="flex gap-2">
        <Input
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <Button type="submit" variant="primary" disabled={disabled || !name.trim()}>
          <Plus size={14} /> 添加
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </form>
  )
}

function RefCount({ n }: { n: number }) {
  return <span className="shrink-0 text-[12px] tabular-nums text-ink-3">{n ? `${n} 处引用` : '未被引用'}</span>
}

/* ---------------- 字典 ---------------- */

function DictTab() {
  const [cat, setCat] = useState<DictCategory>('road')
  const dicts = useDicts()
  const qc = useQueryClient()
  const toast = useToast()
  const { ask, dialogs } = useDeleteFlow()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.dicts })
  const items = (dicts.data ?? []).filter((d) => d.category === cat)
  return (
    <div className="flex h-full">
      <ul className="w-[200px] shrink-0 border-r border-hairline p-3" aria-label="字典类别">
        {DICT_CATEGORIES.map((c) => (
          <li key={c}>
            <button
              type="button"
              aria-current={c === cat}
              onClick={() => setCat(c)}
              className={cn(
                'flex h-9 w-full items-center justify-between rounded-xl px-3 text-[13.5px]',
                c === cat ? 'bg-accent-soft font-semibold text-ink' : 'text-ink-2 hover:bg-sunken',
              )}
            >
              {DICT_CATEGORY_LABEL[c]}
              <span className="text-[12px] tabular-nums text-ink-3">
                {(dicts.data ?? []).filter((d) => d.category === c).length}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <section className="min-w-0 flex-1 overflow-auto p-6">
        <h2 className="mb-3 font-display text-[18px] font-semibold">{DICT_CATEGORY_LABEL[cat]}</h2>
        <div className="max-w-[560px]">
          <AddRow
            placeholder={`新增${DICT_CATEGORY_LABEL[cat]}`}
            onAdd={async (name) => {
              await post('/api/dicts', { category: cat, name })
              await refresh()
              toast(`已新增「${name}」`)
            }}
          />
          <ul className="overflow-hidden rounded-2xl ring-1 ring-hairline">
            {items.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-hairline px-4 py-1.5 last:border-0">
                <span className="min-w-0 flex-1">
                  <InlineName
                    label={d.name}
                    value={d.name}
                    onSave={async (name) => {
                      try {
                        await put(`/api/dicts/${d.id}`, { name })
                        await refresh()
                        toast('已改名，所有引用处显示新名称')
                      } catch (e) {
                        toast(isApiError(e) ? e.message : '改名失败', 'error')
                        throw e
                      }
                    }}
                  />
                </span>
                <RefCount n={d.refCount} />
                <IconButton
                  label={`删除 ${d.name}`}
                  onClick={() =>
                    ask({
                      title: `删除${DICT_CATEGORY_LABEL[cat]}「${d.name}」？`,
                      body: <p>删除后不能恢复。</p>,
                      confirm: '删除',
                      run: () => del(`/api/dicts/${d.id}`),
                      done: () => void refresh(),
                    })
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
            {dicts.isSuccess && items.length === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-ink-3">还没有{DICT_CATEGORY_LABEL[cat]}</li>
            )}
          </ul>
        </div>
      </section>
      {dialogs}
    </div>
  )
}

/* ---------------- 行政区划 ---------------- */

function RegionTab() {
  const regions = useRegions()
  const [cityId, setCityId] = useState<string | null>(null)
  const [districtId, setDistrictId] = useState<string | null>(null)
  const all = regions.data ?? []
  const cities = all.filter((r) => r.level === 'city')
  const city = cityId ?? cities[0]?.id ?? null
  const districts = all.filter((r) => r.level === 'district' && r.parentId === city)
  const district = districtId && districts.some((d) => d.id === districtId) ? districtId : (districts[0]?.id ?? null)
  const streets = all.filter((r) => r.level === 'street' && r.parentId === district)
  return (
    <div className="grid h-full grid-cols-3 divide-x divide-hairline">
      <RegionColumn
        level="city"
        items={cities}
        parentId={null}
        selected={city}
        onSelect={(id) => {
          setCityId(id)
          setDistrictId(null)
        }}
      />
      <RegionColumn level="district" items={districts} parentId={city} selected={district} onSelect={setDistrictId} />
      <RegionColumn level="street" items={streets} parentId={district} selected={null} />
    </div>
  )
}

function RegionColumn({
  level,
  items,
  parentId,
  selected,
  onSelect,
}: {
  level: RegionLevel
  items: Region[]
  parentId: string | null
  selected: string | null
  onSelect?: (id: string) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { ask, dialogs } = useDeleteFlow()
  const refresh = () => qc.invalidateQueries({ queryKey: keys.regions })
  const label = REGION_LEVEL_LABEL[level]
  return (
    <section className="min-w-0 overflow-auto p-5" aria-label={label}>
      <h2 className="mb-3 font-display text-[16px] font-semibold">{label}</h2>
      <AddRow
        placeholder={`新增${label}`}
        disabled={level !== 'city' && !parentId}
        onAdd={async (name) => {
          await post('/api/regions', { level, parentId, name })
          await refresh()
          toast(`已新增${label}「${name}」`)
        }}
      />
      <ul className="overflow-hidden rounded-2xl ring-1 ring-hairline">
        {items.map((r) => (
          <li
            key={r.id}
            className={cn(
              'flex items-center gap-2 border-b border-hairline px-3 py-1.5 last:border-0',
              selected === r.id && 'bg-accent-soft/60',
            )}
          >
            <span className="min-w-0 flex-1">
              <InlineName
                label={r.name}
                value={r.name}
                onSave={async (name) => {
                  try {
                    await put(`/api/regions/${r.id}`, { name })
                    await refresh()
                  } catch (e) {
                    toast(isApiError(e) ? e.message : '改名失败', 'error')
                    throw e
                  }
                }}
              />
            </span>
            <RefCount n={r.refCount} />
            <IconButton
              label={`删除 ${r.name}`}
              onClick={() =>
                ask({
                  title: `删除${label}「${r.name}」？`,
                  body: <p>删除后不能恢复。</p>,
                  confirm: '删除',
                  run: () => del(`/api/regions/${r.id}`),
                  done: () => void refresh(),
                })
              }
            >
              <Trash2 size={14} />
            </IconButton>
            {onSelect && (
              <IconButton label={`查看 ${r.name} 的下级`} onClick={() => onSelect(r.id)}>
                <ChevronRight size={15} />
              </IconButton>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] text-ink-3">
            {parentId || level === 'city' ? `还没有${label}` : '先选择上级'}
          </li>
        )}
      </ul>
      {dialogs}
    </section>
  )
}

/* ---------------- 公交公司 ---------------- */

const emptyCompany: CompanyInput = { name: '', nameEn: '', shortName: '', logoId: null, hotline: '' }

function CompanyTab() {
  const companies = useCompanies()
  const qc = useQueryClient()
  const { ask, dialogs } = useDeleteFlow()
  const [editing, setEditing] = useState<BusCompany | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: keys.companies })
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[18px] font-semibold">公交公司</h2>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> 新建公交公司
        </Button>
      </div>
      <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
        <div className="grid grid-cols-[56px_1.4fr_1fr_1.2fr_1fr_90px_80px] gap-3 border-b border-hairline bg-surface-2 px-4 py-2 text-[11.5px] font-semibold tracking-[0.06em] text-ink-3">
          <span>logo</span>
          <span>名称</span>
          <span>简称</span>
          <span>英文名</span>
          <span>服务热线</span>
          <span>关联线路</span>
          <span />
        </div>
        {(companies.data ?? []).map((c) => (
          <div
            key={c.id}
            className="grid grid-cols-[56px_1.4fr_1fr_1.2fr_1fr_90px_80px] items-center gap-3 border-b border-hairline px-4 py-2 text-[13.5px] last:border-0"
          >
            <span className="flex size-9 items-center justify-center overflow-hidden rounded-lg bg-sunken">
              {c.logo ? <img src={c.logo.url} alt={`${c.name} logo`} className="size-full object-contain" /> : null}
            </span>
            <span className="truncate font-medium">{c.name}</span>
            <span className="truncate text-ink-2">{c.shortName || '—'}</span>
            <span className="truncate italic text-ink-2">{c.nameEn || '—'}</span>
            <span className="truncate font-mono text-[12.5px] text-ink-2">{c.hotline || '—'}</span>
            <span className="tabular-nums text-ink-3">{c.lineCount} 条</span>
            <span className="flex justify-end">
              <IconButton label={`编辑 ${c.name}`} onClick={() => setEditing(c)}>
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label={`删除 ${c.name}`}
                onClick={() =>
                  ask({
                    title: `删除公交公司「${c.name}」？`,
                    body: <p>删除后不能恢复。</p>,
                    confirm: '删除',
                    run: () => del(`/api/companies/${c.id}`),
                    done: () => void refresh(),
                  })
                }
              >
                <Trash2 size={14} />
              </IconButton>
            </span>
          </div>
        ))}
        {companies.isSuccess && !companies.data.length && (
          <div className="px-4 py-8 text-center text-[13px] text-ink-3">还没有公交公司</div>
        )}
      </div>
      {editing && (
        <CompanyDialog
          company={editing === 'new' ? null : editing}
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

function CompanyDialog({
  company,
  onClose,
  onSaved,
}: {
  company: BusCompany | null
  onClose: () => void
  onSaved: () => void
}) {
  const [v, setV] = useState<CompanyInput>(
    company
      ? {
          name: company.name,
          nameEn: company.nameEn,
          shortName: company.shortName,
          logoId: company.logo?.id ?? null,
          hotline: company.hotline,
        }
      : emptyCompany,
  )
  const [logoUrl, setLogoUrl] = useState(company?.logo?.url ?? null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k: keyof CompanyInput, val: string | null) => setV((x) => ({ ...x, [k]: val }))
  const save = async () => {
    setBusy(true)
    try {
      if (company) await put(`/api/companies/${company.id}`, v)
      else await post('/api/companies', v)
      toast(company ? '已保存公交公司' : '已新建公交公司')
      onSaved()
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  const field = (k: 'name' | 'shortName' | 'nameEn' | 'hotline', label: string, required = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      <Input value={v[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  )
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={company ? `编辑「${company.name}」` : '新建公交公司'}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={busy || !v.name.trim()} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">{field('name', '名称', true)}</div>
        {field('shortName', '简称')}
        {field('hotline', '服务热线')}
        <div className="col-span-2">{field('nameEn', '英文名')}</div>
        <div className="col-span-2 flex items-center gap-3">
          <span className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-sunken ring-1 ring-hairline">
            {logoUrl ? (
              <img src={logoUrl} alt="logo 预览" className="size-full object-contain" />
            ) : (
              <ImagePlus size={18} className="text-ink-4" />
            )}
          </span>
          <label className="cursor-pointer text-[13px] font-medium text-accent hover:underline">
            {logoUrl ? '更换 logo' : '上传 logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                try {
                  const up = await uploadFile(f)
                  set('logoId', up.id)
                  setLogoUrl(up.url)
                } catch (err) {
                  setError(isApiError(err) ? err.message : '上传失败')
                }
              }}
            />
          </label>
          {logoUrl && (
            <button
              type="button"
              className="text-[13px] text-ink-3 hover:text-ink"
              onClick={() => {
                set('logoId', null)
                setLogoUrl(null)
              }}
            >
              移除
            </button>
          )}
        </div>
      </div>
      <FieldError>{error}</FieldError>
    </Dialog>
  )
}
