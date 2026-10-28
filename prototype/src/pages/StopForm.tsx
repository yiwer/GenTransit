// PROTOTYPE — 站点表单（定稿：左侧属性表 + 右侧地图，与列表、详情同一套分栏）
// 字段用"属性表"呈现：平时像文字，悬停/聚焦才显出输入框
import { AlertTriangle, ArrowLeft, Check, ImagePlus, MapPin, Plus, Signpost, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DICT, DISTRICTS, LANDMARKS, STREETS, landmarkCandidates, lngLatToXy, reverseGeocode, xyToLngLat } from '../data/mock'
import { diffStop, useDebug, useStore } from '../data/store'
import type { Direction, Stop } from '../data/types'
import { MapView } from '../map/MapView'
import { SplitView } from '../shell/SplitView'
import { Button, Card, GhostInput, GhostSelect, IconButton, Prop, SectionTitle, Tag, Textarea, cn, useToast } from '../ui'
import { OrbitLoader } from '../ui/lively'

const DIRS: Direction[] = ['东', '南', '西', '北', '无', '场站']
const LANDMARK_LIMIT = 5

const blankStop = (id: string): Stop => ({
  id, name: '', direction: '东', nameEn: '', x: 0, y: 0, lng: 0, lat: 0, city: '示例市', district: '', street: '', road: '', maintainer: '', remark: '', qrUrl: '', landmarkIds: [],
  facilities: { berths: null, platformType: '', safety: '', waiting: '', shelterType: '', bigLightbox: null, smallLightbox: null, seats: null },
  photos: 0, updatedAt: '',
})

function useDraft() {
  const { id } = useParams()
  const { stops, saveStop } = useStore()
  const isNew = !id
  const original = useMemo(() => (id ? stops.find((s) => s.id === id) : undefined), [id])
  const [draft, setDraft] = useState<Stop>(() => original ?? blankStop(`s${String(stops.length + 1).padStart(2, '0')}x`))
  const [suggest, setSuggest] = useState<ReturnType<typeof reverseGeocode> | null>(null)
  const [locating, setLocating] = useState(false)
  const [extra, setExtra] = useState(original ? '解放片区' : '')
  const timer = useRef<number>()

  const set = <K extends keyof Stop>(k: K, v: Stop[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const setFac = (k: keyof Stop['facilities'], v: any) => setDraft((d) => ({ ...d, facilities: { ...d.facilities, [k]: v } }))
  const hasCoord = draft.lng !== 0

  const pick = (x: number, y: number) => {
    const { lng, lat } = xyToLngLat(x, y)
    setDraft((d) => ({ ...d, x, y, lng, lat }))
    // 模拟逆地理编码请求
    setLocating(true)
    setSuggest(null)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setLocating(false)
      setSuggest(reverseGeocode(x, y))
    }, 650)
  }
  const setCoord = (lng: number, lat: number) => {
    const { x, y } = lngLatToXy(lng, lat)
    setDraft((d) => ({ ...d, lng, lat, x, y }))
  }

  const dup = stops.find((s) => !s.deleted && s.id !== draft.id && s.name === draft.name.trim() && s.direction === draft.direction)
  const errors = {
    name: !draft.name.trim() ? '必填' : dup ? `已存在「${dup.name}（${dup.direction}）」，站名 + 方位不能重复` : '',
    coord: !hasCoord ? '在地图上点选位置，或填写经纬度' : '',
    nameEn: draft.nameEn && !/^[A-Za-z0-9 .,'()&\-/]*$/.test(draft.nameEn) ? '只允许英文字母、数字、空格和常用标点' : '',
  }
  const valid = !errors.name && !errors.coord && !errors.nameEn
  const changes = diffStop(original, draft)
  const dirty = isNew ? !!(draft.name || hasCoord) : changes.length > 0

  return { isNew, original, draft, set, setFac, pick, setCoord, suggest, setSuggest, locating, errors, valid, changes, dirty, saveStop, hasCoord, extra, setExtra }
}
type Draft = ReturnType<typeof useDraft>

function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    const before = (e: BeforeUnloadEvent) => e.preventDefault()
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a[href]')
      if (a && !window.confirm('有未保存的修改，确定离开？')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', before)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('beforeunload', before)
      document.removeEventListener('click', click, true)
    }
  }, [dirty])
}

function useSave(d: Draft) {
  const nav = useNavigate()
  const toast = useToast()
  const variant = new URLSearchParams(location.search).get('variant')
  return (then: 'stay' | 'signset') => {
    if (!d.valid) {
      toast('还有必填项或错误需要处理', 'warn')
      return
    }
    const r = d.saveStop(d.draft)
    if (!r.changed) toast('内容没有变化，没有生成修改快照', 'info')
    else toast(d.isNew ? '已新建站点，并为它创建了空站牌集' : `已保存，生成修改快照（${r.fields.join('、')}）`)
    if (then === 'signset') nav(`/sign-sets/${d.draft.id}`)
    else nav(`/stops/${d.draft.id}${variant ? `?variant=${variant}` : ''}`)
  }
}

/* ---------------- 属性表字段组（两个变体共用） ---------------- */

function Err({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 flex items-center gap-1 text-[12px] text-danger"><AlertTriangle size={12} /> {children}</div>
}

function BasicFields({ d }: { d: Draft }) {
  const { draft, set, errors } = d
  return (
    <>
      <Prop label="站名" required>
        <GhostInput value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="如：人民广场" autoFocus={d.isNew} className="font-display text-[16px] font-semibold" />
        {errors.name && draft.name && <Err>{errors.name}</Err>}
      </Prop>
      <Prop label="方位" required hint="设置里可切换为编码模式">
        <div role="radiogroup" className="flex flex-wrap gap-1">
          {DIRS.map((x) => (
            <button key={x} type="button" role="radio" aria-checked={draft.direction === x} onClick={() => set('direction', x)} className={cn('h-8 min-w-9 rounded-lg px-2 text-[13.5px] font-medium transition-all duration-300 ease-[var(--bounce)]', draft.direction === x ? 'scale-[1.04] bg-accent text-accent-ink shadow-xs' : 'text-ink-2 ring-1 ring-hairline-2 hover:text-ink hover:ring-accent/40')}>
              {x}
            </button>
          ))}
        </div>
      </Prop>
      <Prop label="英文名">
        <GhostInput value={draft.nameEn} onChange={(e) => set('nameEn', e.target.value)} placeholder="Renmin Square" className="italic" />
        {errors.nameEn && <Err>{errors.nameEn}</Err>}
      </Prop>
      <Prop label="二维码 URL">
        <GhostInput value={draft.qrUrl} onChange={(e) => set('qrUrl', e.target.value)} placeholder="https://" />
      </Prop>
    </>
  )
}

function CoordInput({ value, onCommit, placeholder }: { value: number; onCommit: (v: number) => void; placeholder: string }) {
  const [t, setT] = useState(value ? String(value) : '')
  useEffect(() => setT(value ? String(value) : ''), [value])
  return (
    <GhostInput
      className="font-mono text-[13px]"
      value={t}
      placeholder={placeholder}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        const n = Number(t)
        if (t && Number.isFinite(n)) onCommit(n)
        else setT(value ? String(value) : '')
      }}
    />
  )
}

function LocationFields({ d }: { d: Draft }) {
  const { draft, set, setCoord, suggest, setSuggest, locating, errors } = d
  const diff = suggest && (suggest.district !== draft.district || suggest.street !== draft.street || suggest.road !== draft.road)
  return (
    <>
      <Prop label="经纬度" required hint="GCJ-02；也可以直接在地图上点选或拖动标记">
        <div className="grid grid-cols-2 gap-3">
          <CoordInput value={draft.lng} onCommit={(v) => setCoord(v, draft.lat || 30.25)} placeholder="经度 120.123456" />
          <CoordInput value={draft.lat} onCommit={(v) => setCoord(draft.lng || 120.2, v)} placeholder="纬度 30.123456" />
        </div>
        {errors.coord && <Err>{errors.coord}</Err>}
      </Prop>
      {(locating || diff) && (
        <div className="my-2 flex items-center gap-3 rounded-xl bg-accent-soft/70 px-3.5 py-2.5 text-[13px] ring-1 ring-accent/15">
          {locating ? (
            <>
              <OrbitLoader size={22} />
              <span className="text-ink-2">正在根据位置识别区、街道和路段…</span>
            </>
          ) : (
            <>
              <MapPin size={16} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="text-ink-3">建议填写 </span>
                <span className="font-medium text-ink">{suggest!.district} · {suggest!.street} · {suggest!.road}</span>
              </span>
              <Button size="sm" variant="primary" onClick={() => { set('district', suggest!.district); set('street', suggest!.street); set('road', suggest!.road); setSuggest(null) }}>
                采用
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSuggest(null)}>
                忽略
              </Button>
            </>
          )}
        </div>
      )}
      <Prop label="区 / 街道">
        <div className="grid grid-cols-2 gap-3">
          <GhostSelect value={draft.district} onChange={(e) => { set('district', e.target.value); set('street', '') }}>
            <option value="">选择区</option>
            {DISTRICTS.map((x) => <option key={x}>{x}</option>)}
          </GhostSelect>
          <GhostSelect value={draft.street} onChange={(e) => set('street', e.target.value)} disabled={!draft.district}>
            <option value="">选择街道</option>
            {(STREETS[draft.district] ?? []).map((x) => <option key={x}>{x}</option>)}
          </GhostSelect>
        </div>
      </Prop>
      <Prop label="路段">
        <GhostSelect value={draft.road} onChange={(e) => set('road', e.target.value)}>
          <option value="">选择路段</option>
          {DICT.road.map((x) => <option key={x}>{x}</option>)}
        </GhostSelect>
      </Prop>
    </>
  )
}

function LandmarkFields({ d }: { d: Draft }) {
  const { draft, set, hasCoord } = d
  const bound = LANDMARKS.filter((l) => draft.landmarkIds.includes(l.id))
  const cands = hasCoord ? landmarkCandidates(draft.x, draft.y).filter((l) => !draft.landmarkIds.includes(l.id)) : []
  const full = draft.landmarkIds.length >= LANDMARK_LIMIT
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {bound.map((l) => (
          <span key={l.id} className="gt-rise inline-flex h-8 items-center gap-1.5 rounded-full bg-sage-soft pl-3 pr-1 text-[13px] text-ink">
            <span className="text-[11.5px] text-sage">{l.category}</span>
            {l.name}
            <IconButton label={`解除绑定 ${l.name}`} className="size-6 rounded-full" onClick={() => set('landmarkIds', draft.landmarkIds.filter((x) => x !== l.id))}>
              <X size={12} />
            </IconButton>
          </span>
        ))}
        {bound.length === 0 && <span className="text-[13px] text-ink-3">还没有绑定地标</span>}
        <span className="ml-auto text-[12px] tabular-nums text-ink-3">{draft.landmarkIds.length} / {LANDMARK_LIMIT}</span>
      </div>
      {cands.length > 0 && (
        <div className="rounded-xl border border-dashed border-hairline-2 p-3">
          <div className="mb-2 text-[12px] text-ink-3">位置在这些地标的辐射范围内，点一下即可绑定</div>
          <div className="flex flex-wrap gap-1.5">
            {cands.map((l) => (
              <button key={l.id} disabled={full} onClick={() => set('landmarkIds', [...draft.landmarkIds, l.id])} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-[13px] text-sage ring-1 ring-sage/40 transition-colors hover:bg-sage-soft disabled:opacity-40">
                <Plus size={13} /> {l.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FacilityFields({ d }: { d: Draft }) {
  const { draft, setFac } = d
  const f = draft.facilities
  const num = (k: keyof Stop['facilities'], label: string) => (
    <Prop label={label}>
      <GhostInput type="number" min={0} value={(f[k] as number | null) ?? ''} placeholder="—" onChange={(e) => setFac(k, e.target.value === '' ? null : Number(e.target.value))} />
    </Prop>
  )
  const sel = (k: keyof Stop['facilities'], label: string, opts: string[]) => (
    <Prop label={label}>
      <GhostSelect value={f[k] as string} onChange={(e) => setFac(k, e.target.value)}>
        <option value="">未填写</option>
        {opts.map((x) => <option key={x}>{x}</option>)}
      </GhostSelect>
    </Prop>
  )
  return (
    <div className="grid grid-cols-2 gap-x-8">
      <div>
        {sel('platformType', '站台类型', DICT.platformType)}
        {num('berths', '泊位数')}
        {sel('shelterType', '候车亭', DICT.shelterType)}
        {sel('safety', '安全设施', DICT.safety)}
      </div>
      <div>
        {num('bigLightbox', '大灯箱')}
        {num('smallLightbox', '小灯箱')}
        {num('seats', '座椅')}
        <Prop label="候车设施">
          <GhostInput value={f.waiting} placeholder="如：遮阳棚" onChange={(e) => setFac('waiting', e.target.value)} />
        </Prop>
      </div>
    </div>
  )
}

function OtherFields({ d }: { d: Draft }) {
  const { draft, set, extra, setExtra } = d
  return (
    <>
      <Prop label="维护公司">
        <GhostSelect value={draft.maintainer} onChange={(e) => set('maintainer', e.target.value)}>
          <option value="">未填写</option>
          {DICT.maintainer.map((x) => <option key={x}>{x}</option>)}
        </GhostSelect>
      </Prop>
      <Prop label={<span className="inline-flex items-center gap-1.5">养护片区 <Tag>扩展</Tag></span>}>
        <GhostInput value={extra} placeholder="—" onChange={(e) => setExtra(e.target.value)} />
      </Prop>
      <Prop label="备注" align="start">
        <Textarea value={draft.remark} onChange={(e) => set('remark', e.target.value)} maxLength={500} placeholder="—" className="-mx-2 w-[calc(100%+16px)] bg-transparent ring-transparent hover:bg-sunken" />
      </Prop>
    </>
  )
}

function PhotoFields({ d }: { d: Draft }) {
  const { draft, set } = d
  const tones = ['#d9cbb4', '#c9d2c0', '#d6c2b0', '#c4cfcb', '#d8cfc0']
  return (
    <div className="flex flex-wrap items-end gap-2">
      {Array.from({ length: draft.photos }, (_, i) => (
        <div key={i} className="group relative h-[84px] w-[112px] overflow-hidden rounded-xl ring-1 ring-hairline" style={{ background: tones[i % tones.length] }}>
          <span className="absolute bottom-1.5 left-2 text-[11px] text-black/45">照片 {i + 1}</span>
          <button aria-label={`删除照片 ${i + 1}`} onClick={() => set('photos', draft.photos - 1)} className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-full bg-black/45 text-white group-hover:flex">
            <X size={13} />
          </button>
        </div>
      ))}
      {draft.photos < 10 && (
        <button onClick={() => set('photos', draft.photos + 1)} className="flex h-[84px] w-[112px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline-2 text-[12px] text-ink-3 transition-colors hover:border-accent hover:text-accent">
          <ImagePlus size={18} /> 添加照片
        </button>
      )}
      <span className="pb-1 text-[12px] text-ink-3">{draft.photos} / 10</span>
    </div>
  )
}

const SECTIONS = [
  { id: 'sec-basic', label: '基本' },
  { id: 'sec-loc', label: '位置' },
  { id: 'sec-lm', label: '地标' },
  { id: 'sec-fac', label: '站台设施' },
  { id: 'sec-other', label: '其他' },
  { id: 'sec-photo', label: '照片' },
]

const fitOf = (d: Draft) => (d.original ? { key: d.original.id, points: [[d.original.x, d.original.y]] as [number, number][], pad: 160 } : { key: 'all', points: [[0, 0], [1000, 640]] as [number, number][], pad: 0 })

/* ---------------- 变体 A：属性表 + 右侧地图 ---------------- */

function VariantA() {
  const d = useDraft()
  const save = useSave(d)
  const nav = useNavigate()
  useUnsavedGuard(d.dirty)
  const { set: setDebug } = useDebug()
  useEffect(() => setDebug({ 页面: '站点表单 A', 草稿: d.draft, 改动字段: d.changes, 可保存: d.valid }), [d.draft, d.valid])

  const left = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-6">
        <button onClick={() => nav(d.isNew ? '/stops' : `/stops/${d.original!.id}`)} className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-sunken hover:text-ink">
          <ArrowLeft size={15} /> {d.isNew ? '站点' : '返回详情'}
        </button>
        <nav className="ml-auto flex gap-0.5 text-[12.5px]">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }) }} className="rounded-md px-2 py-1 text-ink-3 hover:bg-sunken hover:text-ink">
              {s.label}
            </a>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-7 pb-10">
        <div className="pb-5 pt-2">
          <div className="eyebrow">{d.isNew ? '新建站点' : '编辑站点'}</div>
          <h1 className="mt-1 font-display text-[28px] font-bold leading-9">{d.draft.name || (d.isNew ? '未命名站点' : d.original!.name)}</h1>
        </div>
        <section id="sec-basic" className="mb-7"><SectionTitle>基本信息</SectionTitle><BasicFields d={d} /></section>
        <section id="sec-loc" className="mb-7"><SectionTitle>位置</SectionTitle><LocationFields d={d} /></section>
        <section id="sec-lm" className="mb-7"><SectionTitle>地标</SectionTitle><LandmarkFields d={d} /></section>
        <section id="sec-fac" className="mb-7"><SectionTitle>站台设施</SectionTitle><FacilityFields d={d} /></section>
        <section id="sec-other" className="mb-7"><SectionTitle>其他</SectionTitle><OtherFields d={d} /></section>
        <section id="sec-photo"><SectionTitle>照片</SectionTitle><PhotoFields d={d} /></section>
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-hairline bg-surface-2 px-6 py-3">
        <span className="min-w-0 flex-1 truncate text-[12.5px]">
          {d.dirty ? (
            <span className="inline-flex items-center gap-1.5 text-signal-ink">
              <span className="size-1.5 rounded-full bg-signal gt-breathe" />
              未保存{!d.isNew && `：${d.changes.join('、')}`}
            </span>
          ) : (
            <span className="text-ink-3">没有修改</span>
          )}
        </span>
        <Button variant="ghost" onClick={() => nav(d.isNew ? '/stops' : `/stops/${d.original!.id}`)}>取消</Button>
        <Button onClick={() => save('signset')} disabled={!d.valid}><Signpost size={14} /> 保存并编辑站牌集</Button>
        <Button variant="primary" onClick={() => save('stay')} disabled={!d.valid}>保存</Button>
      </footer>
    </div>
  )

  return (
    <SplitView
      storageKey="stop-form"
      defaultWidth={600}
      left={() => left}
      map={
        <MapView
          className="absolute inset-0"
          marker={d.hasCoord ? { x: d.draft.x, y: d.draft.y } : null}
          onPick={d.pick}
          showLandmarks
          fit={fitOf(d)}
          overlay={
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-ink/85 px-3.5 py-1.5 text-[12.5px] text-paper shadow-float">
              {d.hasCoord ? '拖动标记或点击地图修改位置' : '点击地图放置站点'}
            </div>
          }
        />
      }
    />
  )
}

// 2026-10-27 定稿：方案 A（属性表 + 右侧地图）
export function StopFormPage() {
  const { id } = useParams()
  return <VariantA key={`A${id}`} />
}
