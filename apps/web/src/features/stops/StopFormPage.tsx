// 站点新建与编辑（5.3.3）：左侧属性表、右侧地图。底部固定状态栏显示"未保存：改了哪些字段"；
// 选点后给出逆地理编码建议（确认后才填入）；站名 + 方位重复即时提示；未保存离开前提示；保存冲突弹窗（AC-10）
import {
  STOP_DIFF_SPEC,
  roundCoord,
  stopLabel,
  stopSnapshot,
  type LandmarkCandidate,
  type Region,
  type RegeoResult,
  type SaveResult,
  type StopDetail,
  type StopNameCheck,
} from '@gentransit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams } from 'react-router'
import { HistoryButton } from '@/components/gt/history'
import { OrbitLoader } from '@/components/gt/lively'
import { ConflictDialog, useSaveFlow } from '@/components/gt/save'
import { SplitView } from '@/components/gt/split-view'
import { SectionTitle } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useAppConfig } from '@/features/auth/auth'
import { keys, useDicts, useExtFields, useLandmarks, useRegions, useSettings } from '@/features/common/data'
import { get, isApiError, post, put } from '@/lib/api'
import { MapView } from '@/map/MapView'
import { blankDraft, changedFields, draftOf, snapshotOf, toInput, validate, type Draft, type Lookups } from './draft'
import {
  BasicFields,
  FacilityFields,
  LandmarkFields,
  LocationFields,
  OtherFields,
  PhotoFields,
  type Suggestion,
} from './form-fields'
import { stopKey, useStop } from './shared'

export function StopFormPage() {
  const { id } = useParams()
  const stop = useStop(id)
  const settings = useSettings()
  if ((id && stop.isPending) || settings.isPending)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-3">
        <OrbitLoader size={22} /> 正在读取…
      </div>
    )
  if (id && !stop.data) return <div className="p-10 text-center text-ink-3">站点不存在</div>
  return <StopForm key={id ?? 'new'} original={stop.data ?? null} />
}

const SECTIONS = [
  { id: 'sec-basic', label: '基本' },
  { id: 'sec-loc', label: '位置' },
  { id: 'sec-lm', label: '地标' },
  { id: 'sec-fac', label: '站台设施' },
  { id: 'sec-other', label: '其他' },
  { id: 'sec-photo', label: '照片' },
]

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function StopForm({ original: initial }: { original: StopDetail | null }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const settings = useSettings().data!
  const config = useAppConfig()
  const ext = useExtFields('stop')
  const dicts = useDicts()
  const regions = useRegions()
  const allLandmarks = useLandmarks()

  const [original, setOriginal] = useState<StopDetail | null>(initial)
  const base = useMemo(
    () => (original ? draftOf(original) : blankDraft(settings.orientationMode === 'orientation' ? '东' : '')),
    [original, settings.orientationMode],
  )
  const [d, setD] = useState<Draft>(base)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }))
  const isNew = !original

  const lookups: Lookups = { dicts: dicts.data ?? [], regions: regions.data ?? [], extDefs: ext.data ?? [] }
  const changes = changedFields(base, d, lookups)
  const dirty = isNew ? Boolean(d.name.trim() || d.lng !== null) && changes.length > 0 : changes.length > 0
  const errors = validate(d)

  // 站名 + 方位重复时即时提示
  const nameKey = useDebounced(`${d.name.trim()}|${d.direction.trim()}`, 350)
  const [nameQ, dirQ] = nameKey.split('|')
  const dup = useQuery({
    queryKey: ['stops', 'check-name', nameQ, dirQ, original?.id],
    queryFn: () =>
      get<StopNameCheck>('/api/stops/check-name', { name: nameQ, direction: dirQ, excludeId: original?.id }),
    enabled: Boolean(nameQ && dirQ),
  })
  const dupError = dup.data?.exists && dup.data.stop ? `已存在「${stopLabel(dup.data.stop)}」，站名 + 方位不能重复` : ''

  // 选点后的逆地理编码建议
  const [suggestion, setSuggestion] = useState<Suggestion>({ loading: false, result: null })
  const regeoTimer = useRef<number | undefined>(undefined)
  const askRegeo = (lng: number, lat: number) => {
    if (!config.data?.regeo) return
    window.clearTimeout(regeoTimer.current)
    setSuggestion({ loading: true, result: null })
    regeoTimer.current = window.setTimeout(async () => {
      try {
        const r = await get<RegeoResult>('/api/geo/regeo', { lng, lat })
        setSuggestion({ loading: false, result: r.available ? r : null })
      } catch {
        setSuggestion({ loading: false, result: null })
      }
    }, 600)
  }
  const pick = (lng: number, lat: number) => {
    patch({ lng: roundCoord(lng), lat: roundCoord(lat) })
    askRegeo(lng, lat)
  }

  /** 采用建议：匹配到的直接填入；匹配不到的按建议新建后再填入（F-COM-07） */
  const accept = async () => {
    const r = suggestion.result
    if (!r) return
    try {
      const region = async (m: RegeoResult['city'], level: Region['level'], parentId: string | null) => {
        if (!m?.name) return null
        if (m.match) return m.match.id
        if (level !== 'city' && !parentId) return null
        return (await post<Region>('/api/regions', { level, parentId, name: m.name })).id
      }
      const cityId = (await region(r.city, 'city', null)) ?? d.cityId
      const districtId = (await region(r.district, 'district', cityId)) ?? d.districtId
      const streetId = (await region(r.street, 'street', districtId)) ?? d.streetId
      let roadId = d.roadId
      if (r.road?.name)
        roadId =
          r.road.match?.id ?? (await post<{ id: string }>('/api/dicts', { category: 'road', name: r.road.name })).id
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.regions }),
        qc.invalidateQueries({ queryKey: keys.dicts }),
      ])
      patch({ cityId, districtId, streetId, roadId })
      setSuggestion({ loading: false, result: null })
    } catch (e) {
      toast(isApiError(e) ? e.message : '采用建议失败', 'error')
    }
  }

  // 地标候选：站点坐标落在地标任一位置点的辐射半径内
  const candKey = d.lng !== null && d.lat !== null ? `${d.lng.toFixed(5)},${d.lat.toFixed(5)}` : ''
  const candidates = useQuery({
    queryKey: ['landmarks', 'candidates', candKey],
    queryFn: () => get<LandmarkCandidate[]>('/api/landmarks/candidates', { lng: d.lng, lat: d.lat }),
    enabled: Boolean(candKey) && settings.autoMatch,
  })

  // 保存
  const [saving, setSaving] = useState(false)
  const flow = useSaveFlow<StopDetail>({
    okText: (r) =>
      isNew
        ? '已新建站点，并为它创建了空站牌集'
        : `已保存，生成修改快照（${changedFields(draftOf(original!), draftOf(r.item), lookups).join('、') || '内容'}）`,
  })
  const leaving = useRef(false)
  const valid = Object.keys(errors).length === 0 && !dupError
  const save = async () => {
    if (!valid) {
      toast('还有必填项或错误需要处理', 'warn')
      return
    }
    setSaving(true)
    try {
      const r = await flow.save(() =>
        isNew
          ? post<SaveResult<StopDetail>>('/api/stops', toInput(d))
          : put<SaveResult<StopDetail>>(`/api/stops/${original!.id}`, { ...toInput(d), rev: original!.rev }),
      )
      if (!r) return
      qc.setQueryData(stopKey(r.item.id), r.item)
      await qc.invalidateQueries({ queryKey: ['stops', 'list'] })
      await qc.invalidateQueries({ queryKey: ['snapshots', 'stop', r.item.id] })
      leaving.current = true
      nav(`/stops/${r.item.id}`)
    } catch {
      // 错误已经提示
    } finally {
      setSaving(false)
    }
  }

  // 未保存离开前提示（F-COM-04）
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (!dirty) return
    const before = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', before)
    return () => window.removeEventListener('beforeunload', before)
  }, [dirty])

  // Ctrl+S 保存
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const fp = { d, set, patch, errors, extDefs: ext.data ?? [] }
  const boundIds = new Set(d.landmarks.map((l) => l.id))
  const candIds = new Set((candidates.data ?? []).map((c) => c.id))
  const circles = (allLandmarks.data ?? [])
    .filter((l) => boundIds.has(l.id) || candIds.has(l.id))
    .flatMap((l) =>
      l.points.map((p) => ({
        id: p.id,
        lng: p.lng,
        lat: p.lat,
        radius: p.radius,
        label: l.name,
        strong: boundIds.has(l.id),
      })),
    )

  const left = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-6">
        <button
          type="button"
          onClick={() => nav(isNew ? '/stops' : `/stops/${original!.id}`)}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={15} /> {isNew ? '站点' : '返回详情'}
        </button>
        <nav className="ml-auto flex gap-0.5 text-[12.5px]" aria-label="表单分节">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="rounded-md px-2 py-1 text-ink-3 hover:bg-sunken hover:text-ink"
            >
              {s.label}
            </a>
          ))}
        </nav>
        {!isNew && (
          <HistoryButton type="stop" id={original!.id} name={stopLabel(original!)} spec={STOP_DIFF_SPEC} size="sm" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-7 pb-10">
        <div className="pb-5 pt-2">
          <div className="eyebrow">{isNew ? '新建站点' : '编辑站点'}</div>
          <h1 className="mt-1 font-display text-[28px] font-bold leading-9">
            {d.name || (isNew ? '未命名站点' : original!.name)}
          </h1>
        </div>
        <section id="sec-basic" className="mb-7">
          <SectionTitle>基本信息</SectionTitle>
          <BasicFields {...fp} mode={settings.orientationMode} autoFocus={isNew} dupError={dupError} />
        </section>
        <section id="sec-loc" className="mb-7">
          <SectionTitle>位置</SectionTitle>
          <LocationFields
            {...fp}
            suggestion={suggestion}
            onAccept={() => void accept()}
            onDismiss={() => setSuggestion({ loading: false, result: null })}
          />
        </section>
        <section id="sec-lm" className="mb-7">
          <SectionTitle>地标</SectionTitle>
          <LandmarkFields
            {...fp}
            limit={settings.landmarkLimit}
            autoMatch={settings.autoMatch}
            candidates={candidates.data ?? []}
          />
        </section>
        <section id="sec-fac" className="mb-7">
          <SectionTitle>站台设施</SectionTitle>
          <FacilityFields {...fp} />
        </section>
        <section id="sec-other" className="mb-7">
          <SectionTitle>其他</SectionTitle>
          <OtherFields {...fp} />
        </section>
        <section id="sec-photo">
          <SectionTitle>照片</SectionTitle>
          <PhotoFields {...fp} />
        </section>
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-hairline bg-surface-2 px-6 py-3">
        <span className="min-w-0 flex-1 truncate text-[12.5px]" data-testid="unsaved">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 text-signal-ink">
              <span className="gt-breathe size-1.5 rounded-full bg-signal" />
              未保存{changes.length > 0 && `：${changes.join('、')}`}
            </span>
          ) : (
            <span className="text-ink-3">没有修改</span>
          )}
        </span>
        <Button variant="ghost" onClick={() => nav(isNew ? '/stops' : `/stops/${original!.id}`)}>
          取消
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving || !valid} title="Ctrl+S">
          保存
        </Button>
      </footer>
    </div>
  )

  return (
    <>
      <SplitView
        storageKey="stop-form"
        defaultWidth={620}
        left={() => left}
        map={
          <MapView
            className="absolute inset-0"
            marker={d.lng !== null && d.lat !== null ? { lng: d.lng, lat: d.lat } : null}
            onPick={pick}
            circles={circles}
            fit={original ? { key: original.id, points: [[original.lng, original.lat]] } : { key: 'new', points: [] }}
            overlay={
              <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-[12.5px] text-paper shadow-float">
                {d.lng !== null ? '拖动标记或点击地图修改位置' : '点击地图放置站点'}
              </div>
            }
          />
        }
      />
      <Dialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="有未保存的修改"
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>留在这里</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              放弃修改并离开
            </Button>
          </>
        }
      >
        <p>{changes.length ? `改动了：${changes.join('、')}。` : ''}离开后这些修改不会保存。</p>
      </Dialog>
      {flow.conflict && (
        <ConflictDialog
          open
          onOpenChange={(o) => !o && flow.clearConflict()}
          latest={stopSnapshot(flow.conflict.latest, ext.data ?? [])}
          mine={snapshotOf(d, lookups)}
          spec={STOP_DIFF_SPEC}
          onReload={() => {
            const latest = flow.conflict!.latest
            qc.setQueryData(stopKey(latest.id), latest)
            setOriginal(latest)
            setD(draftOf(latest))
            flow.clearConflict()
          }}
        />
      )}
    </>
  )
}
