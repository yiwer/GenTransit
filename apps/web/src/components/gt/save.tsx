// 保存流程的统一处理：有效修改给印章提示，"没有变化"给说明，409 冲突弹窗并排显示差异（AC-10）
import { diffSnapshots, type DiffField, type SaveResult } from '@gentransit/shared'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { isApiError, isConflict } from '@/lib/api'
import { DiffView } from './diff'
import { useToast } from './toast'

export interface ConflictState<L> {
  latest: L
}

/**
 * save：执行保存。成功返回结果；冲突时打开冲突弹窗并返回 null；其他错误给出提示后返回 null。
 * 由调用方决定成功后的去向。
 */
export function useSaveFlow<T, L = T>(opts: { okText: (r: SaveResult<T>) => ReactNode }) {
  const toast = useToast()
  const [conflict, setConflict] = useState<ConflictState<L> | null>(null)
  const save = async (run: () => Promise<SaveResult<T>>): Promise<SaveResult<T> | null> => {
    try {
      const r = await run()
      if (r.changed) toast(opts.okText(r), 'ok')
      else toast('内容没有变化，没有生成修改快照', 'info')
      return r
    } catch (e) {
      if (isConflict(e)) {
        setConflict({ latest: e.details.latest as L })
        return null
      }
      toast(isApiError(e) ? e.message : '保存失败，请稍后再试', 'error')
      throw e
    }
  }
  return { save, conflict, clearConflict: () => setConflict(null) }
}

/** 冲突弹窗：对象在打开之后已在别处保存过，不覆盖；并排显示最新内容与我的修改 */
export function ConflictDialog({
  open,
  onOpenChange,
  latest,
  mine,
  spec,
  onReload,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  latest: unknown
  mine: unknown
  spec: DiffField[]
  onReload: () => void
}) {
  const entries = diffSnapshots(latest, mine, spec)
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width={620}
      title="已在别处修改"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>留在这里</Button>
          <Button variant="primary" onClick={onReload}>
            以最新内容重新编辑
          </Button>
        </>
      }
    >
      <p className="mb-3">
        这个对象在你打开之后已经在别处保存过。为了不覆盖那次修改，这次保存没有生效。
        {entries.length > 0 ? '下面是最新内容和你的修改不同的地方：' : '你的修改与最新内容已经一致。'}
      </p>
      {entries.length > 0 && <DiffView entries={entries} fromLabel="别处保存的最新内容" toLabel="我的修改" />}
      <p className="mt-3 text-[12.5px] text-ink-3">选择"以最新内容重新编辑"会放弃这次未保存的修改。</p>
    </Dialog>
  )
}
