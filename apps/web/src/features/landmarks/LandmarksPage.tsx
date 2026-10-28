// 地标（5.6）：地图 + 列表；地图上显示位置点与辐射范围；可按类别、名称筛选。编辑时在地图上点击添加位置点
import { roundCoord, type Landmark, type LandmarkCategory, type LandmarkInput } from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Search, Tags, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDeleteFlow } from '@/components/gt/confirm'
import { EmptySearchArt } from '@/components/gt/lively'
import { FieldError } from '@/components/gt/prop'
import { SplitView } from '@/components/gt/split-view'
import { Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { keys, useLandmarkCategories, useLandmarks } from '@/features/common/data'
import { del, isApiError, post, put } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import type { MapCircle } from '@/map/types'

type Draft = Omit<LandmarkInput, 'points'> & { id?: string; points: { lng: number; lat: number; radius: number }[] }

export function LandmarksPage() {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [catsOpen, setCatsOpen] = useState(false)
  const categories = useLandmarkCategories()
  const landmarks = useLandmarks({ q: q.trim() || undefined, categoryId: cat ?? undefined })
  const qc = useQueryClient()
  const toast = useToast()
  const { ask, dialogs } = useDeleteFlow()
  const list = landmarks.data ?? []
  const refresh = () => qc.invalidateQueries({ queryKey: keys.landmarks })
  const selected = list.find((l) => l.id === sel)

  const circles: MapCircle[] = draft
    ? draft.points.map((p, i) => ({
        id: `d${i}`,
        lng: p.lng,
        lat: p.lat,
        radius: p.radius,
        label: `${draft.name || '新地标'} · ${i + 1}`,
        strong: true,
      }))
    : list.flatMap((l) =>
        l.points.map((p) => ({
          id: p.id,
          lng: p.lng,
          lat: p.lat,
          radius: p.radius,
          label: l.name,
          strong: sel ? l.id === sel : undefined,
        })),
      )
  const fitPoints = draft
    ? draft.points.map((p) => [p.lng, p.lat] as [number, number])
    : selected
      ? selected.points.map((p) => [p.lng, p.lat] as [number, number])
      : list.flatMap((l) => l.points.map((p) => [p.lng, p.lat] as [number, number]))
  const fitKey = draft ? `draft-${draft.id ?? 'new'}` : selected ? selected.id : `all-${list.length}-${cat}`

  const startEdit = (l?: Landmark) =>
    setDraft(
      l
        ? {
            id: l.id,
            name: l.name,
            nameEn: l.nameEn,
            categoryId: l.category.id,
            points: l.points.map(({ lng, lat, radius }) => ({ lng, lat, radius })),
          }
        : { name: '', nameEn: '', categoryId: categories.data?.find((c) => c.enabled)?.id ?? '', points: [] },
    )

  const map = (
    <MapView
      className="absolute inset-0"
      circles={circles}
      fit={{ key: fitKey, points: fitPoints }}
      onPick={
        draft
          ? (lng, lat) => {
              const radius = categories.data?.find((c) => c.id === draft.categoryId)?.defaultRadius ?? 100
              setDraft({ ...draft, points: [...draft.points, { lng: roundCoord(lng), lat: roundCoord(lat), radius }] })
            }
          : undefined
      }
      overlay={
        draft && (
          <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-[12.5px] text-paper shadow-float">
            在地图上点击添加位置点
          </div>
        )
      }
    />
  )

  return (
    <>
      <SplitView
        storageKey="landmarks"
        defaultWidth={460}
        map={map}
        left={() =>
          draft ? (
            <LandmarkForm
              draft={draft}
              setDraft={setDraft}
              categories={categories.data ?? []}
              onCancel={() => setDraft(null)}
              onSaved={(l) => {
                setDraft(null)
                setSel(l.id)
                void refresh()
              }}
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="px-6 pb-3 pt-6">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h1 className="font-display text-[26px] font-semibold leading-9">地标</h1>
                    <p className="text-[13px] text-ink-3">{list.length} 个地标，按辐射半径给站点推荐</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setCatsOpen(true)}>
                      <Tags size={14} /> 类别
                    </Button>
                    <Button variant="primary" onClick={() => startEdit()}>
                      <Plus size={15} /> 新建
                    </Button>
                  </div>
                </div>
                <div className="relative mt-4">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                  />
                  <Input
                    aria-label="搜索地标"
                    placeholder="搜索名称、英文名"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className="h-10 rounded-xl pl-9 text-[14px]"
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[{ id: null, name: '全部', enabled: true }, ...(categories.data ?? [])].map((c) => (
                    <button
                      key={c.id ?? 'all'}
                      type="button"
                      aria-pressed={cat === c.id}
                      onClick={() => setCat(c.id)}
                      className={cn(
                        'inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium ring-1 transition-colors',
                        cat === c.id
                          ? 'bg-accent text-accent-ink ring-accent'
                          : 'bg-surface text-ink-2 ring-hairline-2 hover:text-ink',
                        !c.enabled && 'line-through decoration-1',
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="min-h-0 flex-1 overflow-auto border-t border-hairline">
                {list.map((l) => (
                  <li key={l.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-current={sel === l.id}
                      onClick={() => setSel(sel === l.id ? null : l.id)}
                      onKeyDown={(e) => e.key === 'Enter' && startEdit(l)}
                      className={cn(
                        'group relative flex cursor-pointer items-center gap-3 border-b border-hairline px-6 py-3',
                        sel === l.id ? 'bg-accent-soft/60' : 'hover:bg-surface-2',
                      )}
                    >
                      {sel === l.id && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-display text-[16px] font-semibold">{l.name}</span>
                          <Tag className={cn('bg-sage-soft text-sage', !l.category.enabled && 'line-through')}>
                            {l.category.name}
                          </Tag>
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-ink-3">
                          {l.points.length} 个位置点 · 半径 {[...new Set(l.points.map((p) => p.radius))].join(' / ')} 米
                          · 绑定 {l.stopCount} 个站点
                        </div>
                      </div>
                      <IconButton
                        label={`编辑 ${l.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          startEdit(l)
                        }}
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        label={`删除 ${l.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          ask({
                            title: `删除地标「${l.name}」？`,
                            body: <p>它的 {l.points.length} 个位置点会一起删除。</p>,
                            confirm: '删除',
                            run: () => del(`/api/landmarks/${l.id}`),
                            done: () => {
                              toast('已删除地标')
                              void refresh()
                            },
                          })
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </li>
                ))}
                {landmarks.isSuccess && list.length === 0 && (
                  <li className="flex flex-col items-center px-8 py-14 text-center">
                    <EmptySearchArt />
                    <p className="mt-2 font-display text-[16px] font-semibold">没有地标</p>
                    <p className="mt-1 text-[13px] text-ink-3">
                      先在「类别」里建好地标类别，再新建地标并在地图上点出位置。
                    </p>
                  </li>
                )}
              </ul>
            </div>
          )
        }
      />
      <CategoryDialog open={catsOpen} onOpenChange={setCatsOpen} categories={categories.data ?? []} />
      {dialogs}
    </>
  )
}

function LandmarkForm({
  draft,
  setDraft,
  categories,
  onCancel,
  onSaved,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  categories: LandmarkCategory[]
  onCancel: () => void
  onSaved: (l: Landmark) => void
}) {
  const [error, setError] = useState('')
  const toast = useToast()
  const save = async () => {
    setError('')
    const body: LandmarkInput = {
      name: draft.name,
      nameEn: draft.nameEn,
      categoryId: draft.categoryId,
      points: draft.points,
    }
    try {
      const l = draft.id
        ? await put<Landmark>(`/api/landmarks/${draft.id}`, body)
        : await post<Landmark>('/api/landmarks', body)
      toast(draft.id ? '已保存地标' : '已新建地标')
      onSaved(l)
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败')
    }
  }
  const setPoint = (i: number, k: 'lng' | 'lat' | 'radius', v: string) =>
    setDraft({ ...draft, points: draft.points.map((p, j) => (j === i ? { ...p, [k]: Number(v) } : p)) })
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-7 pb-8 pt-6">
        <div className="eyebrow">{draft.id ? '编辑地标' : '新建地标'}</div>
        <h1 className="mt-1 font-display text-[26px] font-bold">{draft.name || '未命名地标'}</h1>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink-3">
              名称<span className="ml-0.5 text-danger">*</span>
            </span>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink-3">英文名</span>
            <Input value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink-3">
              类别<span className="ml-0.5 text-danger">*</span>
            </span>
            <NativeSelect value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              <option value="">选择类别</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold">位置点 {draft.points.length}</h2>
          <span className="text-[12px] text-ink-3">在地图上点击添加；半径默认取类别值</span>
        </div>
        <ul className="mt-2 flex flex-col gap-2">
          {draft.points.map((p, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 ring-1 ring-hairline">
              <MapPin size={14} className="shrink-0 text-sage" />
              <Input
                aria-label={`位置点 ${i + 1} 经度`}
                className="w-32 font-mono text-[12.5px]"
                value={p.lng}
                onChange={(e) => setPoint(i, 'lng', e.target.value)}
              />
              <Input
                aria-label={`位置点 ${i + 1} 纬度`}
                className="w-28 font-mono text-[12.5px]"
                value={p.lat}
                onChange={(e) => setPoint(i, 'lat', e.target.value)}
              />
              <Input
                aria-label={`位置点 ${i + 1} 半径`}
                className="w-20"
                type="number"
                value={p.radius}
                onChange={(e) => setPoint(i, 'radius', e.target.value)}
              />
              <span className="text-[12px] text-ink-3">米</span>
              <IconButton
                label={`删除位置点 ${i + 1}`}
                className="ml-auto"
                onClick={() => setDraft({ ...draft, points: draft.points.filter((_, j) => j !== i) })}
              >
                <X size={14} />
              </IconButton>
            </li>
          ))}
          {draft.points.length === 0 && (
            <li className="rounded-xl border border-dashed border-hairline-2 px-4 py-6 text-center text-[13px] text-ink-3">
              至少要有一个位置点
            </li>
          )}
        </ul>
        <FieldError>{error}</FieldError>
      </div>
      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline bg-surface-2 px-6 py-3">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={!draft.name.trim() || !draft.categoryId || !draft.points.length}
          onClick={() => void save()}
        >
          保存
        </Button>
      </footer>
    </div>
  )
}

function CategoryDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: LandmarkCategory[]
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const { ask, dialogs } = useDeleteFlow()
  const [name, setName] = useState('')
  const [radius, setRadius] = useState('100')
  const [error, setError] = useState('')
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.landmarkCategories }),
      qc.invalidateQueries({ queryKey: keys.landmarks }),
    ])
  const sorted = useMemo(() => categories, [categories])
  const update = async (c: LandmarkCategory, patch: Partial<LandmarkCategory>) => {
    try {
      await put(`/api/landmark-categories/${c.id}`, {
        name: c.name,
        icon: c.icon,
        defaultRadius: c.defaultRadius,
        enabled: c.enabled,
        ...patch,
      })
      await refresh()
    } catch (e) {
      toast(isApiError(e) ? e.message : '保存失败', 'error')
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title="地标类别"
      description="停用的类别，其地标不参与站点的绑定候选"
    >
      <form
        className="mb-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          try {
            await post('/api/landmark-categories', { name, defaultRadius: Number(radius), enabled: true })
            setName('')
            await refresh()
          } catch (err) {
            setError(isApiError(err) ? err.message : '添加失败')
          }
        }}
      >
        <Input
          placeholder="类别名称，如 医院"
          aria-label="新类别名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          type="number"
          aria-label="默认辐射半径（米）"
          className="w-28"
          value={radius}
          onChange={(e) => setRadius(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          <Plus size={14} /> 添加
        </Button>
      </form>
      <FieldError>{error}</FieldError>
      <ul className="overflow-hidden rounded-xl ring-1 ring-hairline">
        {sorted.map((c) => (
          <li key={c.id} className="flex items-center gap-3 border-b border-hairline px-3 py-2 last:border-0">
            <span className={cn('min-w-0 flex-1 font-medium text-ink', !c.enabled && 'text-ink-3 line-through')}>
              {c.name}
            </span>
            <span className="text-[12px] text-ink-3">{c.landmarkCount} 个地标</span>
            <label className="flex items-center gap-1 text-[12px] text-ink-3">
              半径
              <input
                type="number"
                aria-label={`${c.name} 默认半径`}
                defaultValue={c.defaultRadius}
                onBlur={(e) =>
                  Number(e.target.value) !== c.defaultRadius &&
                  void update(c, { defaultRadius: Number(e.target.value) })
                }
                className="h-7 w-16 rounded-md bg-sunken px-1.5 text-[12.5px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
              米
            </label>
            <Switch
              checked={c.enabled}
              aria-label={`启用 ${c.name}`}
              onCheckedChange={(v) => void update(c, { enabled: v })}
            />
            <IconButton
              label={`删除 ${c.name}`}
              onClick={() =>
                ask({
                  title: `删除地标类别「${c.name}」？`,
                  body: <p>删除后不能恢复。</p>,
                  confirm: '删除',
                  run: () => del(`/api/landmark-categories/${c.id}`),
                  done: () => void refresh(),
                })
              }
            >
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
        {categories.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-3">还没有类别</li>}
      </ul>
      {dialogs}
    </Dialog>
  )
}
