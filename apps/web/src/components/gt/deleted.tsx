// "已删除"视图（F-COM-09）：列出已删除对象（来自其最后一份快照），可查看修改历史
import type { DeletedItem, DiffField, ObjectType, Page } from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { get } from '@/lib/api'
import { fmtDateTime } from '@/lib/utils'
import { HistoryDialog } from './history'
import { EmptySearchArt, SnapshotStack } from './lively'
import { Pagination, usePageParams } from './pagination'

export function DeletedList({ type, spec, unit }: { type: ObjectType; spec: DiffField[]; unit: string }) {
  const { page, size, setPage, setSize } = usePageParams()
  const q = useQuery({
    queryKey: ['snapshots', 'deleted', type, page, size],
    queryFn: () => get<Page<DeletedItem>>('/api/snapshots/deleted', { type, page, size }),
  })
  const [open, setOpen] = useState<DeletedItem | null>(null)
  const items = q.data?.items ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="min-h-0 flex-1 overflow-auto border-t border-hairline">
        {items.map((d) => (
          <li key={d.objectId}>
            <button
              type="button"
              onClick={() => setOpen(d)}
              className="group flex w-full items-center gap-3 border-b border-hairline px-6 py-3 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[16px] font-semibold text-ink-2 line-through decoration-ink-4 decoration-1">
                  {d.objectName}
                </span>
                <span className="text-[12.5px] text-ink-3">删除于 {fmtDateTime(d.deletedAt)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 group-hover:text-ink">
                <SnapshotStack size={15} /> {d.snapshotCount} 份快照
              </span>
            </button>
          </li>
        ))}
        {q.isSuccess && items.length === 0 && (
          <li className="flex flex-col items-center px-8 py-14 text-center">
            <EmptySearchArt />
            <p className="mt-2 font-display text-[16px] font-semibold">还没有删除过{unit}</p>
          </li>
        )}
      </ul>
      <div className="shrink-0 border-t border-hairline bg-surface-2 px-6 py-2.5">
        <Pagination page={page} size={size} total={q.data?.total ?? 0} onPage={setPage} onSize={setSize} unit="个" />
      </div>
      {open && (
        <HistoryDialog
          open
          onOpenChange={(o) => !o && setOpen(null)}
          type={type}
          id={open.objectId}
          name={open.objectName}
          spec={spec}
        />
      )}
    </div>
  )
}
