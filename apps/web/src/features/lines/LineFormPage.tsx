// 线路新建与编辑（M2 计划 4.1）：左侧线路属性 + 走向页签（站序表、添加站点、粘贴、反向生成、到站时刻），右侧地图。
// 改模式时页签按位置改名，将删除的走向标成删除样式，保存前确认；未保存拦截与冲突弹窗沿用站点表单。
// M5：从已有线路复制新建；反向生成用对向站；加站按距离排序；行提醒（站间距离、方位疑似反了）；
// 站序改动对比；地图上点选附近站点加入站序；Ctrl+S 保存
import {
  LINE_DIFF_SPEC,
  LINE_MODE_LABEL,
  LINE_MODES,
  ROUTE_KIND_LABEL,
  SERVICE_TYPE_LABEL,
  SERVICE_TYPES,
  TICKET_TYPE_LABEL,
  TICKET_TYPES,
  distanceM,
  fmtDistance,
  gapWarnings,
  lineSnapshot,
  stopLabel,
  wrongSide,
  type OppositeMap,
  type LineDetail,
  type LineImpact,
  type LineNameCheck,
  type SaveResult,
  type StopRef as SharedStopRef,
} from '@gentransit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ClipboardPaste, Clock, Eraser, Repeat } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'
import { HistoryButton } from '@/components/gt/history'
import { OrbitLoader } from '@/components/gt/lively'
import { DictPicker } from '@/components/gt/pickers'
import { FieldError, GhostInput, GhostSelect, Prop } from '@/components/gt/prop'
import { ConflictDialog, useSaveFlow } from '@/components/gt/save'
import { SplitView } from '@/components/gt/split-view'
import { RoutePlate, SectionTitle, Segmented, Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useCompanies, useDicts, useExtFields } from '@/features/common/data'
import { get, post, put } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MapView } from '@/map/MapView'
import { LABEL_MAX_MPP } from '@/map/types'
import {
  blankLineDraft,
  changeMode,
  copyDraftOf,
  lineChanges,
  lineDraftOf,
  lineSnapshotOf,
  reverseWithOpposites,
  routeChanges,
  rowKey,
  toLineInput,
  validateLine,
  type LineDraft,
  type LineLookups,
  type RouteDraft,
  type StopRef,
} from './draft'
import { PasteDialog, StopSearch } from './route-tools'
import { kindText, lineKey, useLine } from './shared'
import { StopTable, type RowMark } from './stop-table'
import { TimesEditor } from './times-editor'

export function LineFormPage() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  // 从已有线路复制新建（需求 5.4.3）：/lines/new?copyFrom=<线路 id>
  const copyFrom = id ? undefined : (sp.get('copyFrom') ?? undefined)
  const line = useLine(id)
  const source = useLine(copyFrom)
  if ((id && line.isPending) || (copyFrom && source.isPending))
    return (
      <div className="flex h-full items-center justify-center gap-2 text-ink-3">
        <OrbitLoader size={22} /> 正在读取…
      </div>
    )
  if (id && !line.data) return <div className="p-10 text-center text-ink-3">线路不存在</div>
  return (
    <LineForm
      key={id ?? `new:${copyFrom ?? ''}`}
      original={line.data ?? null}
      copyOf={copyFrom ? (source.data ?? null) : null}
    />
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function useDupCheck(kind: 'name' | 'number', value: string, excludeId?: string) {
  const v = useDebounced(value.trim(), 350)
  const q = useQuery({
    queryKey: ['lines', `check-${kind}`, v, excludeId],
    queryFn: () => get<LineNameCheck>(`/api/lines/check-${kind}`, { [kind]: v, excludeId }),
    enabled: Boolean(v),
  })
  if (!q.data?.exists || !q.data.line) return ''
  return kind === 'name' ? `线路名「${v}」已存在` : `管理编号「${v}」已被「${q.data.line.name}」使用`
}

function LineForm({ original: initial, copyOf }: { original: LineDetail | null; copyOf: LineDetail | null }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const companies = useCompanies()
  const dicts = useDicts()
  const lineExt = useExtFields('line')
  const rsExt = useExtFields('routeStop')

  const [original, setOriginal] = useState<LineDetail | null>(initial)
  const base = useMemo(() => (original ? lineDraftOf(original) : blankLineDraft()), [original])
  const [d, setD] = useState<LineDraft>(() => (copyOf ? copyDraftOf(copyOf) : base))
  const set = <K extends keyof LineDraft>(k: K, v: LineDraft[K]) => setD((x) => ({ ...x, [k]: v }))
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [timesOpen, setTimesOpen] = useState(false)
  const [askClear, setAskClear] = useState(false)
  const [askRemove, setAskRemove] = useState(false)
  /** 改模式将删除的走向在站牌集里的编排数（AC-16） */
  const [removeImpact, setRemoveImpact] = useState<LineImpact | null>(null)
  const isNew = !original
  const route = d.routes[Math.min(active, d.routes.length - 1)]
  const setRoute = (patch: Partial<RouteDraft>) =>
    setD((x) => ({
      ...x,
      routes: x.routes.map((r, i) => (i === Math.min(active, x.routes.length - 1) ? { ...r, ...patch } : r)),
    }))

  const lookups: LineLookups = {
    companies: companies.data ?? [],
    dicts: dicts.data ?? [],
    lineExt: lineExt.data ?? [],
    routeStopExt: rsExt.data ?? [],
  }
  const changes = lineChanges(base, d, lookups)
  const dirty = changes.length > 0
  const errors = validateLine(d)
  const nameDup = useDupCheck('name', d.name, original?.id)
  const numberDup = useDupCheck('number', d.number, original?.id)
  const valid = Object.keys(errors).length === 0 && !nameDup && !numberDup
  // 编辑时：原有走向里将被删除的（改模式后多出来的）
  const removing = isNew ? [] : base.routes.slice(d.routes.length).map((r) => r.kind)

  const flow = useSaveFlow<LineDetail>({
    okText: () => (isNew ? '已新建线路' : `已保存，生成修改快照（${changes.join('、') || '内容'}）`),
  })
  const [saving, setSaving] = useState(false)
  const leaving = useRef(false)
  const save = async () => {
    setAskRemove(false)
    if (!valid) {
      toast('还有必填项或错误需要处理', 'warn')
      return
    }
    setSaving(true)
    try {
      const r = await flow.save(() =>
        isNew
          ? post<SaveResult<LineDetail>>('/api/lines', toLineInput(d))
          : put<SaveResult<LineDetail>>(`/api/lines/${original!.id}`, { ...toLineInput(d), rev: original!.rev }),
      )
      if (!r) return
      qc.setQueryData(lineKey(r.item.id), r.item)
      await qc.invalidateQueries({ queryKey: ['lines', 'list'] })
      await qc.invalidateQueries({ queryKey: ['stops'] })
      await qc.invalidateQueries({ queryKey: ['snapshots', 'line', r.item.id] })
      leaving.current = true
      nav(`/lines/${r.item.id}`, { state: { justSaved: true } })
    } catch {
      // 已提示
    } finally {
      setSaving(false)
    }
  }
  const trySave = () => {
    if (!removing.length) return void save()
    setRemoveImpact(null)
    setAskRemove(true)
    get<LineImpact>(`/api/lines/${original!.id}/impact`, { kinds: removing.join(',') })
      .then(setRemoveImpact)
      .catch(() => setRemoveImpact({ stops: 0, signSets: 0, schedules: 0 }))
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

  const addStops = (stops: StopRef[]) => {
    const rows = stops.map((stop) => ({ key: rowKey(), stop, times: [], ext: {} }))
    const at = selected ? route.stops.findIndex((r) => r.key === selected) + 1 : route.stops.length
    setRoute({ stops: [...route.stops.slice(0, at), ...rows, ...route.stops.slice(at)] })
    if (selected) setSelected(rows.at(-1)!.key)
  }
  const other = d.routes.length === 2 ? d.routes[1 - Math.min(active, 1)] : null
  const routeError = (i: number) =>
    errors[`routes.${i}.stops`] ?? Object.entries(errors).find(([k]) => k.startsWith(`routes.${i}.`))?.[1]
  const selectedRow = route?.stops.find((r) => r.key === selected)

  // Ctrl+S 保存（F-COM-17）
  const trySaveRef = useRef(trySave)
  trySaveRef.current = trySave
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        trySaveRef.current()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  /* ---------- M5 加站辅助 ---------- */

  /** 反向生成时没有对向站、沿用原站的行：行键 → 站点 ID（这一行换了站点后标记消失） */
  const [hints, setHints] = useState<Record<string, string>>({})
  const reverse = async () => {
    if (!other) return
    try {
      const ids = [...new Set(other.stops.map((x) => x.stop.id))]
      const opp = ids.length ? await post<OppositeMap>('/api/stops/opposites', { ids }) : {}
      const { rows, missing } = reverseWithOpposites(other, opp)
      setRoute({ stops: rows })
      setSelected(null)
      setHints((h) => ({
        ...h,
        ...Object.fromEntries(missing.map((k) => [k, rows.find((r) => r.key === k)!.stop.id])),
      }))
      toast(
        missing.length
          ? `已倒序生成，${missing.length} 站没有对向站、沿用原站，请核对标出的行`
          : '已倒序生成，各站都换成了对向站',
        missing.length ? 'warn' : 'ok',
      )
    } catch {
      toast('反向生成失败', 'error')
    }
  }
  // 当前走向各站的对向站：判断方位疑似反了（BR-20）
  const routeStopIds = [...new Set((route?.stops ?? []).map((x) => x.stop.id))].sort()
  const opps = useQuery({
    queryKey: ['stops', 'opposites', routeStopIds.join(',')],
    queryFn: () => post<OppositeMap>('/api/stops/opposites', { ids: routeStopIds }),
    enabled: routeStopIds.length > 0 && routeStopIds.length <= 500,
    staleTime: 60_000,
  })
  const diff =
    !isNew && route
      ? routeChanges(
          base.routes.find((r) => r.kind === route.kind),
          route,
        )
      : null
  const marks: Record<string, RowMark> = {}
  if (route) {
    const pts = route.stops.map((x) => x.stop)
    const gaps = new Set(gapWarnings(pts))
    route.stops.forEach((row, i) => {
      const notes: NonNullable<RowMark['notes']> = []
      if (gaps.has(i)) notes.push({ text: `距上一站 ${fmtDistance(distanceM(pts[i - 1], pts[i]))}，确认没有选错站？` })
      const o = opps.data?.[row.stop.id]
      if (o && wrongSide(pts[i - 1] ?? null, pts[i], pts[i + 1] ?? null, o))
        notes.push({
          text: `方位疑似反了：对向站「${stopLabel(o)}」在行驶方向右侧`,
          fix: {
            label: '换成对向站',
            run: () => setRoute({ stops: route.stops.map((x) => (x.key === row.key ? { ...x, stop: o } : x)) }),
          },
        })
      if (hints[row.key] === row.stop.id) notes.push({ text: '没有对向站，沿用原站' })
      const added = diff?.added.has(row.key)
      if (notes.length || added) marks[row.key] = { added, notes }
    })
  }
  /** 把移除的站放回：原来的前一站还在就放在它后面，否则放回原位置 */
  const putBack = (r: NonNullable<typeof diff>['removed'][number]) => {
    const stops = route.stops
    let at = 0
    if (r.after !== null) {
      const i = stops.findIndex((x) => x.stop.id === r.after)
      at = i >= 0 ? i + 1 : Math.min(r.index, stops.length)
    }
    setRoute({ stops: [...stops.slice(0, at), { ...r.row, key: rowKey() }, ...stops.slice(at)] })
  }
  // 地图点选加站（需求 5.4.3）：比例尺在 1 公里档以内时淡显视野里不在当前走向上的站点
  const [viewport, setViewport] = useState<{ bbox: [number, number, number, number]; mpp: number } | null>(null)
  const vp = useDebounced(viewport, 300)
  const near = Boolean(vp && vp.mpp <= LABEL_MAX_MPP)
  const inView = useQuery({
    queryKey: ['stops', 'in-view', vp?.bbox.map((x) => x.toFixed(4)).join(',')],
    queryFn: () => get<SharedStopRef[]>('/api/stops/in-view', { bbox: vp!.bbox.join(',') }),
    enabled: near,
    staleTime: 30_000,
  })
  const onRoute = new Set(route?.stops.map((x) => x.stop.id))
  const candidates = near ? (inView.data ?? []).filter((x) => !onRoute.has(x.id)) : []
  const pickCandidate = (id: string) => {
    const c = candidates.find((x) => x.id === id)
    if (!c) return
    const at = selected ? route.stops.findIndex((r) => r.key === selected) + 1 : route.stops.length
    addStops([c])
    toast(`已加入「${stopLabel(c)}」· 第 ${at + 1} 站`, 'info')
  }

  const left = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 px-6">
        <button
          type="button"
          onClick={() => nav(isNew ? '/lines' : `/lines/${original!.id}`)}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <ArrowLeft size={15} /> {isNew ? '线路' : '返回详情'}
        </button>
        {!isNew && (
          <span className="ml-auto">
            <HistoryButton type="line" id={original!.id} name={original!.name} spec={LINE_DIFF_SPEC} size="sm" />
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-7 pb-10">
        <div className="flex items-center gap-4 pb-5 pt-2">
          <RoutePlate name={d.name || '新线路'} size="lg" state={d.name ? 'normal' : 'ghost'} />
          <div>
            <div className="eyebrow">
              {isNew ? (copyOf ? `新建线路 · 复制自 ${copyOf.name}` : '新建线路') : '编辑线路'}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-3">{LINE_MODE_LABEL[d.mode]}</div>
          </div>
        </div>

        <section className="mb-7">
          <SectionTitle>线路属性</SectionTitle>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Prop label="线路名" required>
                <GhostInput
                  value={d.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder={copyOf ? `复制自 ${copyOf.name}` : '如：K1路'}
                  autoFocus={isNew}
                  className="font-plate text-[16px] font-semibold"
                />
                <FieldError>{nameDup || (d.name ? errors.name : '')}</FieldError>
              </Prop>
              <Prop label="管理编号" required>
                <GhostInput
                  value={d.number}
                  onChange={(e) => set('number', e.target.value)}
                  placeholder="如：K-0001"
                  className="font-mono text-[13px]"
                />
                <FieldError>{numberDup || (d.number ? errors.number : '')}</FieldError>
              </Prop>
              <Prop label="英文名">
                <GhostInput
                  value={d.nameEn}
                  onChange={(e) => set('nameEn', e.target.value)}
                  placeholder="Route K1"
                  className="italic"
                />
                <FieldError>{errors.nameEn}</FieldError>
              </Prop>
              <Prop label="公交公司">
                <GhostSelect value={d.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
                  <option value="">未填写</option>
                  {(companies.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </GhostSelect>
              </Prop>
            </div>
            <div>
              <Prop label="售票类型">
                <GhostSelect
                  value={d.ticketType ?? ''}
                  onChange={(e) => set('ticketType', (e.target.value || null) as LineDraft['ticketType'])}
                >
                  <option value="">未填写</option>
                  {TICKET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TICKET_TYPE_LABEL[t]}
                    </option>
                  ))}
                </GhostSelect>
              </Prop>
              <Prop label="票制">
                <DictPicker category="fareSystem" value={d.fareSystemId} onChange={(id) => set('fareSystemId', id)} />
              </Prop>
              <Prop label="票价">
                <GhostInput value={d.fare} onChange={(e) => set('fare', e.target.value)} placeholder="如：2 元" />
                <FieldError>{errors.fare}</FieldError>
              </Prop>
              {(lineExt.data ?? [])
                .filter((f) => f.enabled)
                .map((f) => (
                  <Prop
                    key={f.key}
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        {f.name} <Tag className="h-4 px-1.5 text-[10.5px]">扩展</Tag>
                      </span>
                    }
                  >
                    {f.type === 'select' ? (
                      <GhostSelect
                        value={(d.ext[f.key] as string) ?? ''}
                        onChange={(e) => set('ext', { ...d.ext, [f.key]: e.target.value || null })}
                      >
                        <option value="">未填写</option>
                        {f.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </GhostSelect>
                    ) : (
                      <GhostInput
                        type={
                          f.type === 'number'
                            ? 'number'
                            : f.type === 'date'
                              ? 'date'
                              : f.type === 'time'
                                ? 'time'
                                : 'text'
                        }
                        value={
                          d.ext[f.key] == null
                            ? ''
                            : Array.isArray(d.ext[f.key])
                              ? (d.ext[f.key] as string[]).join('、')
                              : String(d.ext[f.key])
                        }
                        placeholder="—"
                        onChange={(e) => {
                          const v = e.target.value
                          set('ext', {
                            ...d.ext,
                            [f.key]: !v
                              ? null
                              : f.type === 'number'
                                ? Number(v)
                                : f.type === 'textList'
                                  ? v.split(/[、,，]/).map((x) => x.trim())
                                  : v,
                          })
                        }}
                      />
                    )}
                    <FieldError>{errors[`ext.${f.key}`]}</FieldError>
                  </Prop>
                ))}
            </div>
          </div>
          <Prop label="线路模式" required>
            <Segmented
              label="线路模式"
              value={d.mode}
              onChange={(m) => {
                setD((x) => changeMode(x, m))
                setSelected(null)
              }}
              options={LINE_MODES.map((m) => ({ value: m, label: LINE_MODE_LABEL[m] }))}
            />
          </Prop>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="走向">
            {d.routes.map((r, i) => (
              <button
                key={r.kind}
                type="button"
                role="tab"
                aria-selected={i === Math.min(active, d.routes.length - 1)}
                onClick={() => {
                  setActive(i)
                  setSelected(null)
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
                  i === Math.min(active, d.routes.length - 1)
                    ? 'bg-accent text-accent-ink shadow-xs'
                    : 'text-ink-2 ring-1 ring-hairline-2 hover:text-ink',
                  routeError(i) && i !== active && 'ring-danger/60',
                )}
              >
                {kindText(r.kind)}
                <span className="tabular-nums opacity-70">{r.stops.length}</span>
              </button>
            ))}
            {removing.map((k) => (
              <span
                key={k}
                title="改模式后多出来的走向，保存时删除"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] text-danger line-through decoration-1 ring-1 ring-dashed ring-danger/40"
              >
                {ROUTE_KIND_LABEL[k]} · 将删除
              </span>
            ))}
          </div>
          {errors.routes && <FieldError>{errors.routes}</FieldError>}

          {route && (
            <div
              className="rounded-2xl bg-surface-2/60 p-4 ring-1 ring-hairline"
              role="tabpanel"
              aria-label={ROUTE_KIND_LABEL[route.kind]}
            >
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-ink-3">服务类型</span>
                  <GhostSelect
                    className="mx-0 w-full bg-surface"
                    value={route.serviceType ?? ''}
                    onChange={(e) => setRoute({ serviceType: (e.target.value || null) as RouteDraft['serviceType'] })}
                  >
                    <option value="">未填写</option>
                    {SERVICE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SERVICE_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </GhostSelect>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-ink-3">服务时间</span>
                  <GhostInput
                    className="mx-0 w-full bg-surface"
                    value={route.serviceTime}
                    placeholder="05:50–22:30"
                    onChange={(e) => setRoute({ serviceTime: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-ink-3">发车间隔</span>
                  <GhostInput
                    className="mx-0 w-full bg-surface"
                    value={route.interval}
                    placeholder="10–15 分钟"
                    onChange={(e) => setRoute({ interval: e.target.value })}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <StopSearch
                  onAdd={(s) => addStops([s])}
                  near={(selectedRow ?? route.stops.at(-1))?.stop}
                  placeholder={selectedRow ? `插到「${selectedRow.stop.name}」之后` : '按站名搜索，回车加到末尾'}
                />
                <Button size="sm" variant="ghost" onClick={() => setPasteOpen(true)}>
                  <ClipboardPaste size={14} /> 粘贴两列
                </Button>
                {other && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!other.stops.length}
                    title={`用${ROUTE_KIND_LABEL[other.kind]}的站序倒序生成本走向初稿，各站换成对向站`}
                    onClick={() => void reverse()}
                  >
                    <Repeat size={14} /> 反向生成
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={!route.stops.length} onClick={() => setTimesOpen(true)}>
                  <Clock size={14} /> 到站时刻
                </Button>
                <Button size="sm" variant="ghost" disabled={!route.stops.length} onClick={() => setAskClear(true)}>
                  <Eraser size={14} /> 清空
                </Button>
              </div>
              <div className="mt-3">
                <StopTable
                  rows={route.stops}
                  onChange={(stops) => setRoute({ stops })}
                  selected={selected}
                  onSelect={setSelected}
                  extDefs={(rsExt.data ?? []).filter((f) => f.enabled)}
                  marks={marks}
                />
              </div>
              {diff && diff.removed.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="removed-stops">
                  <span className="text-ink-3">本次移除：</span>
                  {diff.removed.map((r) => (
                    <span
                      key={r.row.key}
                      className="inline-flex items-center gap-1 rounded-lg bg-danger-soft/50 px-2 py-0.5"
                    >
                      <span className="text-danger line-through decoration-1">{stopLabel(r.row.stop)}</span>
                      <button type="button" onClick={() => putBack(r)} className="text-accent hover:underline">
                        放回
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <FieldError>{routeError(Math.min(active, d.routes.length - 1))}</FieldError>
              <p className="mt-2 text-[12px] text-ink-3">拖动左侧把手排序，或选中一行后按 Alt + ↑ / ↓ 移动。</p>
            </div>
          )}
        </section>
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-hairline bg-surface-2 px-6 py-3">
        <span className="min-w-0 flex-1 truncate text-[12.5px]" data-testid="unsaved">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 text-signal-ink">
              <span className="gt-breathe size-1.5 rounded-full bg-signal" />
              未保存：{changes.join('、')}
            </span>
          ) : (
            <span className="text-ink-3">没有修改</span>
          )}
        </span>
        <Button variant="ghost" onClick={() => nav(isNew ? '/lines' : `/lines/${original!.id}`)}>
          取消
        </Button>
        <Button variant="primary" onClick={trySave} disabled={saving || !valid} title="Ctrl+S">
          保存
        </Button>
      </footer>
    </div>
  )

  const allRoutes = d.routes.map((r, i) => ({
    id: r.kind,
    points: r.stops.map((s) => [s.stop.lng, s.stop.lat] as [number, number]),
    tone: (i === Math.min(active, d.routes.length - 1) ? 'strong' : 'faint') as 'strong' | 'faint',
    flow: i === Math.min(active, d.routes.length - 1),
  }))
  const routePoints = [
    ...candidates.map((c) => ({
      id: `cand:${c.id}`,
      lng: c.lng,
      lat: c.lat,
      label: c.name,
      sub: c.direction,
      tone: 'faint' as const,
    })),
    ...(diff?.removed ?? []).map((r) => ({
      id: `rm:${r.row.key}`,
      lng: r.row.stop.lng,
      lat: r.row.stop.lat,
      label: r.row.stop.name,
      sub: `${r.row.stop.direction} · 已移除`,
      tone: 'removed' as const,
    })),
    ...(route?.stops ?? []).map((s, i) => ({
      id: s.key,
      lng: s.stop.lng,
      lat: s.stop.lat,
      label: s.stop.name,
      sub: s.stop.direction,
      badge: String(i + 1),
      tone: diff?.added.has(s.key) ? ('added' as const) : undefined,
    })),
  ]
  const allPts = d.routes.flatMap((r) => r.stops.map((s) => [s.stop.lng, s.stop.lat] as [number, number]))

  return (
    <>
      <SplitView
        storageKey="line-form"
        defaultWidth={720}
        left={() => left}
        map={
          <MapView
            className="absolute inset-0"
            points={routePoints}
            routes={allRoutes}
            selectedId={selected}
            onSelect={(k) => {
              if (k.startsWith('cand:')) pickCandidate(k.slice(5))
              else if (!k.startsWith('rm:')) setSelected(selected === k ? null : k)
            }}
            onViewport={(bbox, mpp) => setViewport({ bbox, mpp })}
            overlay={
              route && (
                <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-ink/80 px-3.5 py-1.5 text-[12px] text-paper shadow-float">
                  {near
                    ? `点淡色的站点${selectedRow ? `插到「${selectedRow.stop.name}」之后` : '加到末尾'}`
                    : '放大到 1 公里比例尺，可在地图上点站点加入站序'}
                </div>
              )
            }
            fit={
              selectedRow
                ? { key: `row:${selected}`, points: [[selectedRow.stop.lng, selectedRow.stop.lat]] }
                : { key: `route:${route?.kind}:${original?.id ?? 'new'}:${allPts.length > 0}`, points: allPts }
            }
          />
        }
      />
      <PasteDialog open={pasteOpen} onOpenChange={setPasteOpen} onAppend={addStops} />
      {route && timesOpen && (
        <TimesEditor
          key={route.kind}
          open={timesOpen}
          onOpenChange={setTimesOpen}
          title={`${ROUTE_KIND_LABEL[route.kind]} · 到站时刻`}
          rows={route.stops}
          onSave={(times) => setRoute({ stops: route.stops.map((s, i) => ({ ...s, times: times[i] ?? [] })) })}
        />
      )}
      <Dialog
        open={askClear}
        onOpenChange={setAskClear}
        title={`清空${route ? ROUTE_KIND_LABEL[route.kind] : ''}的站序？`}
        footer={
          <>
            <Button onClick={() => setAskClear(false)}>取消</Button>
            <Button
              variant="danger"
              onClick={() => {
                setRoute({ stops: [] })
                setSelected(null)
                setAskClear(false)
              }}
            >
              清空
            </Button>
          </>
        }
      >
        <p>{route?.stops.length} 个站会从这个走向移除。保存之前都可以取消这次修改。</p>
      </Dialog>
      <Dialog
        open={askRemove}
        onOpenChange={setAskRemove}
        title="改模式会删除走向"
        footer={
          <>
            <Button onClick={() => setAskRemove(false)}>返回修改</Button>
            <Button variant="danger" onClick={() => void save()}>
              删除走向并保存
            </Button>
          </>
        }
      >
        <p>
          改为{LINE_MODE_LABEL[d.mode]}后，走向{' '}
          <b className="text-ink">{removing.map((k) => ROUTE_KIND_LABEL[k]).join('、')}</b>{' '}
          会被删除。第一个走向保留原有数据并改名为 {d.routes[0] && ROUTE_KIND_LABEL[d.routes[0].kind]}。
        </p>
        <p
          className="mt-2 rounded-xl bg-signal-soft/60 px-3 py-2 text-[13px] text-ink ring-1 ring-signal/25"
          data-testid="impact-note"
        >
          {!removeImpact
            ? '正在统计站牌集…'
            : removeImpact.schedules
              ? `${removing.map((k) => ROUTE_KIND_LABEL[k]).join('、')}在 ${removeImpact.signSets} 个站牌集里的 ${removeImpact.schedules} 条编排将被删除，受影响的站牌集各存一份"连带修改"快照。`
              : `${removing.map((k) => ROUTE_KIND_LABEL[k]).join('、')}没有被任何站牌集编排。`}
        </p>
      </Dialog>
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
          latest={lineSnapshot(
            {
              ...flow.conflict.latest,
              routes: flow.conflict.latest.routes.map((r) => ({
                ...r,
                stops: r.stops.map((s) => ({ stop: s.stop, times: s.times, ext: s.ext })),
              })),
            },
            lookups.lineExt,
            lookups.routeStopExt,
          )}
          mine={lineSnapshotOf(d, lookups)}
          spec={LINE_DIFF_SPEC}
          onReload={() => {
            const latest = flow.conflict!.latest
            qc.setQueryData(lineKey(latest.id), latest)
            setOriginal(latest)
            setD(lineDraftOf(latest))
            flow.clearConflict()
          }}
        />
      )}
    </>
  )
}
