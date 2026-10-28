// PROTOTYPE — 站牌集列表（不在 M0 重点范围，只为能从导航进入编辑器）
import { Signpost } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../data/store'
import { passagesAt, poolOf } from '../../lib/domain'
import { PageHeader } from '../../shell/AppShell'
import { Button, Checkbox, DirBadge, StatusChip } from '../../ui'
import { Pagination, usePager } from '../../ui/pagination'

export function SignSetListPage() {
  const { stops, lines, getSignSet } = useStore()
  const nav = useNavigate()
  const [only, setOnly] = useState(false)
  const rows = useMemo(
    () =>
      stops
        .filter((s) => !s.deleted)
        .map((s) => {
          const ss = getSignSet(s.id)
          const pool = poolOf(ss, passagesAt(s.id, lines, stops))
          const boards = ss.shelves.flatMap((x) => x.boards)
          return { s, shelves: ss.shelves.length, boards, wait: pool.filter((p) => p.status === '待编排').length, bad: pool.filter((p) => p.status === '失效').length, lines: pool.length }
        })
        .sort((a, b) => b.bad + b.wait - (a.bad + a.wait)),
    [stops, lines, getSignSet],
  )
  const list = only ? rows.filter((r) => r.wait || r.bad) : rows
  const pager = usePager(list, String(only), 20)
  return (
    <div>
      <PageHeader title="站牌集" sub={`${rows.filter((r) => r.wait || r.bad).length} 个站点有待处理的编排`} actions={<Checkbox label="只看待处理" checked={only} onChange={setOnly} />} />
      <div className="p-6">
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-left text-xs text-fg-2">
              <tr>
                {['站点', '站架', '站牌', '途经', '待处理', ''].map((h) => <th key={h} className="h-9 border-b border-line px-3 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r) => (
                <tr key={r.s.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="h-11 px-3"><span className="inline-flex items-center gap-1.5 font-display text-[15px] font-semibold">{r.s.name}<DirBadge dir={r.s.direction} size="sm" /></span></td>
                  <td className="px-3 tabular-nums">{r.shelves}</td>
                  <td className="px-3 text-fg-2">{r.boards.length ? r.boards.map((b) => `${b.w}×${b.h}`).join('、') : '—'}</td>
                  <td className="px-3 tabular-nums">{r.lines}</td>
                  <td className="px-3">
                    <span className="flex gap-1.5">
                      {r.wait > 0 && <StatusChip status="待编排" count={r.wait} />}
                      {r.bad > 0 && <StatusChip status="失效" count={r.bad} />}
                    </span>
                  </td>
                  <td className="px-3 text-right">
                    <Button size="sm" onClick={() => nav(`/sign-sets/${r.s.id}`)}><Signpost size={13} /> 编排</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line bg-surface-2 px-4 py-2.5">
            <Pagination pager={pager} unit="个" sizes={[10, 20, 50]} />
          </div>
        </div>
      </div>
    </div>
  )
}
