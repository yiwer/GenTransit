// 删除前二次确认并写明连带影响（F-COM-05）；被引用时列出引用方（BR-12）
import { ERROR_CODES, type Referrer } from '@gentransit/shared'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { isApiError } from '@/lib/api'
import { useToast } from './toast'

export function ReferrerList({ referrers, total }: { referrers: Referrer[]; total?: number }) {
  return (
    <>
      <ul className="mt-3 max-h-[240px] overflow-auto rounded-xl ring-1 ring-hairline">
        {referrers.map((r) => (
          <li
            key={`${r.type}-${r.id}`}
            className="flex items-center gap-3 border-b border-hairline px-3 py-2 text-[13px] last:border-0"
          >
            <span className="w-16 shrink-0 text-[12px] text-ink-3">{r.type}</span>
            <span className="text-ink">{r.name}</span>
          </li>
        ))}
      </ul>
      {total !== undefined && total > referrers.length && (
        <p className="mt-2 text-[12.5px] text-ink-3">另有 {total - referrers.length} 处引用未列出</p>
      )}
    </>
  )
}

interface Pending {
  title: ReactNode
  body: ReactNode
  confirm: string
  run: () => Promise<unknown>
  done?: () => void
}

/** 删除流程：先确认，执行时若返回 IN_USE 则改为显示引用方 */
export function useDeleteFlow() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [blocked, setBlocked] = useState<{
    title: ReactNode
    message: string
    referrers: Referrer[]
    total: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const ask = (p: Pending) => setPending(p)
  const run = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await pending.run()
      setPending(null)
      pending.done?.()
    } catch (e) {
      if (isApiError(e, ERROR_CODES.inUse)) {
        const d = (e.details ?? {}) as { referrers?: Referrer[]; total?: number }
        setBlocked({ title: pending.title, message: e.message, referrers: d.referrers ?? [], total: d.total ?? 0 })
        setPending(null)
      } else toast(isApiError(e) ? e.message : '删除失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const dialogs = (
    <>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.title}
        footer={
          <>
            <Button onClick={() => setPending(null)}>取消</Button>
            <Button variant="danger" disabled={busy} onClick={() => void run()}>
              {pending?.confirm}
            </Button>
          </>
        }
      >
        {pending?.body}
      </Dialog>
      <Dialog
        open={Boolean(blocked)}
        onOpenChange={(o) => !o && setBlocked(null)}
        title="还不能删除"
        footer={
          <Button variant="primary" onClick={() => setBlocked(null)}>
            知道了
          </Button>
        }
      >
        <p>{blocked?.message}。先解除下面这些引用，再回来删除。</p>
        {blocked && <ReferrerList referrers={blocked.referrers} total={blocked.total} />}
      </Dialog>
    </>
  )
  return { ask, dialogs }
}
