// 到站时刻编辑器（每个走向一个弹窗）：行是路径站，列是"第 k 个时刻"；可从 Excel 粘贴整块；可按间隔填充
import { expandSchedule, fillByInterval, normalizeTime, timesInOrder } from '@gentransit/shared'
import { Wand2 } from 'lucide-react'
import { useState, type ClipboardEvent } from 'react'
import { DirBadge } from '@/components/gt/symbols'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { StopRow } from './draft'

type Grid = string[][]

const toGrid = (rows: StopRow[]): Grid => rows.map((r) => [...r.times])

/** 校验并规整一行：返回规整后的时刻或错误 */
export function checkRow(cells: string[]): { times: string[]; error: string | null; bad: boolean[] } {
  const bad = cells.map((c) => c.trim() !== '' && !normalizeTime(c))
  const times = cells.map((c) => normalizeTime(c)).filter((x): x is string => Boolean(x))
  const error = bad.some(Boolean) ? '格式应为 HH:mm' : !timesInOrder(times) ? '没有按先后排列' : null
  return { times, error, bad }
}

export function TimesEditor({
  open,
  onOpenChange,
  title,
  rows,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  rows: StopRow[]
  onSave: (times: string[][]) => void
}) {
  const [grid, setGrid] = useState<Grid>(() => toGrid(rows))
  const [first, setFirst] = useState('')
  const [firstBus, setFirstBus] = useState('')
  const [lastBus, setLastBus] = useState('')
  const [every, setEvery] = useState('')
  const [segments, setSegments] = useState('3')
  const [fillError, setFillError] = useState('')
  const reset = (o: boolean) => {
    if (o) setGrid(toGrid(rows))
    onOpenChange(o)
  }
  const cols = Math.max(1, ...grid.map((r) => r.length)) + 1
  // 行数以站序为准（防止站序变化后表格越界）
  const checks = rows.map((_, i) => checkRow(grid[i] ?? []))
  const invalid = checks.some((c) => c.error)

  const setCell = (i: number, j: number, v: string) =>
    setGrid((g) =>
      g.map((r, ri) =>
        ri === i ? Array.from({ length: Math.max(r.length, j + 1) }, (_, k) => (k === j ? v : (r[k] ?? ''))) : r,
      ),
    )

  /** 从 Excel 粘贴整块：按制表符、换行铺到当前单元格右下方 */
  const onPaste = (i: number, j: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!/[\t\n]/.test(text)) return
    e.preventDefault()
    const block = text
      .replace(/\r/g, '')
      .replace(/\n$/, '')
      .split('\n')
      .map((l) => l.split('\t'))
    setGrid((g) =>
      g.map((r, ri) => {
        const b = block[ri - i]
        if (ri < i || !b) return r
        const next = [...r]
        b.forEach((v, k) => (next[j + k] = v.trim()))
        return Array.from({ length: next.length }, (_, k) => next[k] ?? '')
      }),
    )
  }

  const fill = () => {
    setFillError('')
    let firstTimes: string[]
    if (first.trim()) {
      const parts = first.split(/[,，、\s]+/).filter(Boolean)
      const norm = parts.map((p) => normalizeTime(p))
      if (norm.some((x) => !x)) return setFillError('首站时刻格式应为 HH:mm')
      firstTimes = norm as string[]
    } else {
      const f = normalizeTime(firstBus)
      const l = normalizeTime(lastBus)
      const n = Number(every)
      if (!f || !l || !(n > 0)) return setFillError('填写首站各班时刻，或首班、末班与发车间隔')
      firstTimes = expandSchedule(f, l, n)
    }
    const segs = segments
      .split(/[,，、\s]+/)
      .filter(Boolean)
      .map(Number)
    if (!segs.length || segs.some((x) => !(x >= 0)))
      return setFillError('站间用时填分钟数：统一一个数，或逐段用逗号分隔')
    setGrid(fillByInterval(firstTimes, segs, rows.length))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={reset}
      width={880}
      title={title}
      description="每行一个路径站，第 k 列是该站的第 k 个时刻；可以从 Excel 复制整块粘贴到任意单元格"
      footer={
        <>
          <Button onClick={() => reset(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={() => {
              onSave(checks.map((c) => c.times))
              onOpenChange(false)
            }}
          >
            应用到站序
          </Button>
        </>
      }
    >
      <fieldset className="mb-4 rounded-xl bg-surface-2 p-3 ring-1 ring-hairline">
        <legend className="px-1 text-[12.5px] font-semibold text-ink">按间隔填充</legend>
        <div className="grid grid-cols-[1.4fr_auto_0.7fr_0.7fr_0.6fr_1fr_auto] items-end gap-2 text-[12px]">
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">首站各班时刻（逗号分隔）</span>
            <Input
              aria-label="首站各班时刻"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="06:00, 06:30, 07:00"
            />
          </label>
          <span className="pb-2 text-ink-4">或</span>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">首班</span>
            <Input
              aria-label="首班"
              value={firstBus}
              onChange={(e) => setFirstBus(e.target.value)}
              placeholder="06:00"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">末班</span>
            <Input aria-label="末班" value={lastBus} onChange={(e) => setLastBus(e.target.value)} placeholder="22:00" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">间隔（分）</span>
            <Input
              aria-label="发车间隔分钟"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              placeholder="15"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-3">站间用时（分，统一或逐段）</span>
            <Input
              aria-label="站间用时"
              value={segments}
              onChange={(e) => setSegments(e.target.value)}
              placeholder="3 或 3,4,2"
            />
          </label>
          <Button onClick={fill}>
            <Wand2 size={14} /> 填充
          </Button>
        </div>
        {fillError && <p className="mt-2 text-[12px] text-danger">{fillError}</p>}
      </fieldset>
      <div className="max-h-[420px] overflow-auto rounded-xl ring-1 ring-hairline">
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-[1] bg-surface-2 text-[11.5px] text-ink-3">
            <tr>
              <th className="w-[160px] px-2 py-1.5 text-left font-semibold">站点</th>
              {Array.from({ length: cols }, (_, j) => (
                <th key={j} className="px-1 py-1.5 font-semibold tabular-nums">
                  {j + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-hairline">
                <th scope="row" className="px-2 py-1 text-left font-normal">
                  <span className="flex items-center gap-1">
                    <span className="w-5 text-right text-[11px] tabular-nums text-ink-4">{i + 1}</span>
                    <span className="truncate font-display font-semibold">{r.stop.name}</span>
                    <DirBadge dir={r.stop.direction} size="sm" />
                  </span>
                  {checks[i].error && <span className="block pl-6 text-[11px] text-danger">{checks[i].error}</span>}
                </th>
                {Array.from({ length: cols }, (_, j) => (
                  <td key={j} className="px-0.5 py-0.5">
                    <input
                      aria-label={`${r.stop.name} 第 ${j + 1} 个时刻`}
                      value={grid[i]?.[j] ?? ''}
                      onChange={(e) => setCell(i, j, e.target.value)}
                      onPaste={onPaste(i, j)}
                      className={cn(
                        'h-7 w-[62px] rounded-md bg-transparent px-1 text-center font-mono text-[12px] tabular-nums ring-1 ring-transparent hover:bg-sunken focus:bg-surface focus:outline-none focus:ring-accent',
                        checks[i].bad[j] && 'bg-danger-soft text-danger ring-danger/40',
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}
