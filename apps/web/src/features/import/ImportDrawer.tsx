// 导入抽屉（M2 计划 4.2）：选择文件 → 预览（新增、修改、失败、将新建的字典项、将删除的走向）→ 确认或取消
import {
  COORD_SYSTEMS,
  COORD_SYSTEM_LABEL,
  ERROR_CODES,
  IMPORT_KIND_LABEL,
  type CoordSystem,
  type ImportJobView,
  type ImportKind,
  type ImportPreview,
  type ImportResult,
} from '@gentransit/shared'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, FileSpreadsheet, Upload } from 'lucide-react'
import { useState } from 'react'
import { DiffView } from '@/components/gt/diff'
import { OrbitLoader, SealCheck } from '@/components/gt/lively'
import { Tag } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { isApiError, post, uploadImport } from '@/lib/api'
import { cn } from '@/lib/utils'

type Tab = 'created' | 'updated' | 'failures' | 'newRefs' | 'removedRoutes'

/** 预览：顶部计数 + 页签 */
export function ImportPreviewView({ preview }: { preview: ImportPreview }) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'created', label: '新增', count: preview.created.length },
    { id: 'updated', label: '修改', count: preview.updated.length },
    { id: 'failures', label: '失败', count: preview.failures.length },
    ...(preview.kind === 'stop'
      ? [{ id: 'newRefs' as const, label: '将新建的字典项', count: preview.newRefs.length }]
      : []),
    ...(preview.kind === 'line'
      ? [{ id: 'removedRoutes' as const, label: '将删除的走向', count: preview.removedRoutes.length }]
      : []),
  ]
  const [tab, setTab] = useState<Tab>(() => tabs.find((t) => t.count > 0)?.id ?? 'created')
  const [open, setOpen] = useState<string | null>(null)
  const empty = (text: string) => <p className="px-3 py-6 text-center text-[13px] text-ink-3">{text}</p>
  return (
    <div>
      <p className="mb-3 text-[13px]" data-testid="import-summary">
        共 {preview.rows} 行：新增 <b className="text-ink">{preview.created.length}</b>
        {'，修改 '}
        <b className="text-ink">{preview.updated.length}</b>
        {'，无变化 '}
        <b className="text-ink">{preview.unchanged}</b>
        {'，失败 '}
        <b className={preview.failures.length ? 'text-danger' : 'text-ink'}>{preview.failures.length}</b>
      </p>
      <div role="tablist" aria-label="预览" className="mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium',
              tab === t.id ? 'bg-accent text-accent-ink shadow-xs' : 'text-ink-2 ring-1 ring-hairline-2 hover:text-ink',
            )}
          >
            {t.label}
            <span className={cn('tabular-nums', t.id === 'failures' && t.count > 0 && tab !== t.id && 'text-danger')}>
              {t.count}
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" className="overflow-hidden rounded-xl ring-1 ring-hairline">
        {tab === 'created' &&
          (preview.created.length ? (
            <ul className="max-h-[52vh] overflow-auto">
              {preview.created.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[13px] last:border-0"
                >
                  <Tag className="bg-sage-soft text-sage">新增</Tag>
                  <span className="font-display font-semibold text-ink">{c.name}</span>
                  {c.key !== c.name && <span className="font-mono text-[12px] text-ink-3">{c.key}</span>}
                </li>
              ))}
            </ul>
          ) : (
            empty('没有新增的对象')
          ))}
        {tab === 'updated' &&
          (preview.updated.length ? (
            <ul className="max-h-[52vh] overflow-auto">
              {preview.updated.map((u) => (
                <li key={u.key} className="border-b border-hairline last:border-0">
                  <button
                    type="button"
                    aria-expanded={open === u.key}
                    onClick={() => setOpen(open === u.key ? null : u.key)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                  >
                    <Tag className="bg-signal-soft text-signal-ink">修改</Tag>
                    <span className="font-display font-semibold text-ink">{u.name}</span>
                    {u.key !== u.name && <span className="font-mono text-[12px] text-ink-3">{u.key}</span>}
                    <span className="ml-auto truncate text-[12px] text-ink-3">
                      {u.diff.map((d) => d.label).join('、')}
                    </span>
                    <ChevronDown
                      size={14}
                      className={cn('shrink-0 text-ink-3 transition-transform', open === u.key && 'rotate-180')}
                    />
                  </button>
                  {open === u.key && <DiffView entries={u.diff} className="mx-3 mb-3" />}
                </li>
              ))}
            </ul>
          ) : (
            empty('没有修改的对象')
          ))}
        {tab === 'failures' &&
          (preview.failures.length ? (
            <ul className="max-h-[52vh] overflow-auto">
              {preview.failures.map((f, i) => (
                <li key={`${f.key}-${i}`} className="border-b border-hairline px-3 py-2 text-[13px] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{f.key}</span>
                    <span className="text-[12px] text-ink-3">
                      {f.sheet} 第 {f.rows.join('、')} 行
                    </span>
                  </div>
                  <ul className="mt-1 list-disc pl-5 text-danger">
                    {f.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {f.unmatchedStops?.length ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[12px] text-ink-3">未匹配站点：</span>
                      {f.unmatchedStops.map((s) => (
                        <Tag key={s} className="bg-danger-soft text-danger">
                          {s}
                        </Tag>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            empty('没有失败的行')
          ))}
        {tab === 'newRefs' &&
          (preview.newRefs.length ? (
            <ul className="max-h-[52vh] overflow-auto">
              {preview.newRefs.map((r) => (
                <li
                  key={`${r.category}-${r.parent}-${r.name}`}
                  className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[13px] last:border-0"
                >
                  <Tag>{r.category}</Tag>
                  <span className="text-ink">{r.name}</span>
                  {r.parent && <span className="text-[12px] text-ink-3">（{r.parent}）</span>}
                </li>
              ))}
            </ul>
          ) : (
            empty('不需要新建字典项或行政区划')
          ))}
        {tab === 'removedRoutes' &&
          (preview.removedRoutes.length ? (
            <ul className="max-h-[52vh] overflow-auto">
              {preview.removedRoutes.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[13px] last:border-0"
                >
                  <span className="font-semibold text-ink">{r.name}</span>
                  <span className="text-danger">删除走向 {r.routes.join('、')}</span>
                  <span className="ml-auto text-[12.5px] text-ink-3">
                    {r.schedules ? `${r.signSets} 个站牌集的 ${r.schedules} 条编排随之删除` : '没有站牌集编排这些走向'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            empty('没有将删除的走向')
          ))}
      </div>
    </div>
  )
}

export function ImportDrawer({
  kind,
  open,
  onOpenChange,
}: {
  kind: ImportKind
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [coord, setCoord] = useState<CoordSystem>('gcj02')
  const [job, setJob] = useState<ImportJobView | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = IMPORT_KIND_LABEL[kind]

  const reset = () => {
    setFile(null)
    setJob(null)
    setResult(null)
    setError('')
  }
  const close = () => {
    if (job && !result) void post(`/api/import/${job.id}/cancel`).catch(() => undefined)
    onOpenChange(false)
    reset()
  }
  const preview = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      setJob(await uploadImport<ImportJobView>(kind, file, kind === 'stop' ? { coordSystem: coord } : {}))
    } catch (e) {
      setError(isApiError(e) ? e.message : '上传失败')
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    if (!job) return
    setBusy(true)
    setError('')
    try {
      setResult(await post<ImportResult>(`/api/import/${job.id}/confirm`))
      await Promise.all(
        ['stops', 'lines', 'dicts', 'regions', 'snapshots'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
      )
    } catch (e) {
      if (isApiError(e, ERROR_CODES.importStale)) setError('数据在预览之后有变化，请重新预览后再确认。')
      else setError(isApiError(e) ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }
  const p = job?.preview
  const todo = p ? p.created.length + p.updated.length : 0

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      width={620}
      title={`导入${label}`}
      description={result ? '导入完成' : job ? `预览：${job.fileName}` : '下载模板填写后上传；导入不会删除任何对象'}
      footer={
        result ? (
          <>
            {job && result.failed > 0 && (
              <Button asChild variant="ghost">
                <a href={`/api/import/${job.id}/failures`}>
                  <Download size={14} /> 下载失败行
                </a>
              </Button>
            )}
            <Button variant="primary" onClick={close}>
              完成
            </Button>
          </>
        ) : job ? (
          <>
            {p!.failures.length > 0 && (
              <Button asChild variant="ghost">
                <a href={`/api/import/${job.id}/failures`}>
                  <Download size={14} /> 下载失败行
                </a>
              </Button>
            )}
            <Button onClick={() => void post(`/api/import/${job.id}/cancel`).then(reset)}>取消导入</Button>
            <Button variant="primary" disabled={busy || todo === 0} onClick={() => void confirm()}>
              确认导入 {todo > 0 && `${todo} 个`}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close}>取消</Button>
            <Button variant="primary" disabled={!file || busy} onClick={() => void preview()}>
              <Upload size={14} /> 上传并预览
            </Button>
          </>
        )
      }
    >
      {busy && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-accent-soft/70 px-3.5 py-2.5 text-[13px]">
          <OrbitLoader size={22} /> {job ? '正在写入…' : '正在分析文件…'}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
          {error}
          {job && !result && error.includes('重新预览') && (
            <button type="button" className="ml-2 font-medium underline" onClick={() => void preview()}>
              重新预览
            </button>
          )}
        </div>
      )}
      {result ? (
        <div className="flex flex-col items-center py-8 text-center">
          <SealCheck size={64} />
          <p className="mt-3 font-display text-[18px] font-semibold">已导入{label}</p>
          <p className="mt-1 text-[13px] text-ink-3">
            新增 {result.created}，修改 {result.updated}，无变化 {result.unchanged}，失败 {result.failed}
            {result.newRefs > 0 && `；新建字典项与行政区划 ${result.newRefs} 个`}
          </p>
        </div>
      ) : job ? (
        <ImportPreviewView preview={job.preview} />
      ) : (
        <div className="flex flex-col gap-4">
          <a
            href={`/api/import/${kind}/template`}
            className="inline-flex w-fit items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-accent ring-1 ring-accent/30 hover:bg-accent-soft"
          >
            <FileSpreadsheet size={15} /> 下载{label}导入模板
          </a>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-hairline-2 px-6 py-8 text-center hover:border-accent">
            <Upload size={20} className="text-ink-3" />
            <span className="text-[13.5px] text-ink">
              {file ? file.name : '选择 Excel 文件（.xlsx，不超过 20 MB）'}
            </span>
            <input
              type="file"
              aria-label="选择导入文件"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {kind === 'stop' && (
            <fieldset>
              <legend className="mb-1.5 text-[12.5px] font-medium text-ink-3">文件里的坐标系</legend>
              <div className="flex flex-col gap-1">
                {COORD_SYSTEMS.map((c) => (
                  <label key={c} className="inline-flex items-center gap-2 text-[13px]">
                    <input type="radio" name="coord" value={c} checked={coord === c} onChange={() => setCoord(c)} />
                    {COORD_SYSTEM_LABEL[c]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[12px] text-ink-3">统一转换为 GCJ-02 保存。</p>
            </fieldset>
          )}
        </div>
      )}
    </Sheet>
  )
}
