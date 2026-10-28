// 行内改名：平时是文字，点一下变成输入框；回车保存，Esc 取消
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function InlineName({
  value,
  onSave,
  className,
  label,
}: {
  value: string
  onSave: (name: string) => Promise<unknown>
  className?: string
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  const commit = async () => {
    const v = text.trim()
    if (!v || v === value) {
      setEditing(false)
      setText(value)
      return
    }
    setBusy(true)
    try {
      await onSave(v)
      setEditing(false)
    } catch {
      setText(value)
    } finally {
      setBusy(false)
    }
  }
  if (editing)
    return (
      <input
        autoFocus
        aria-label={`${label}的新名称`}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') {
            setText(value)
            setEditing(false)
          }
        }}
        className={cn(
          'h-8 w-full rounded-lg bg-surface px-2 text-[14px] text-ink ring-1 ring-accent focus:outline-none',
          className,
        )}
      />
    )
  return (
    <button
      type="button"
      title="点击改名"
      aria-label={`改名：${label}`}
      onClick={() => {
        setText(value)
        setEditing(true)
      }}
      className={cn(
        'group/name -mx-2 flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[14px] text-ink hover:bg-sunken',
        className,
      )}
    >
      <span className="truncate">{value}</span>
      <Pencil size={12} className="shrink-0 text-ink-4 opacity-0 group-hover/name:opacity-100" />
    </button>
  )
}
