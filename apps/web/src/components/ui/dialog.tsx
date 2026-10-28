import { X } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const DialogRoot = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

/** 弹窗：标题、正文、底部操作栏。基于 Radix Dialog（焦点圈定、Esc 关闭） */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 460,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  className?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="gt-fade fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            'gt-rise fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline focus:outline-none',
            className,
          )}
          style={{ width }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-5">
            <D.Title className="text-[16px] font-semibold leading-6 text-ink">{title}</D.Title>
            <D.Close
              aria-label="关闭"
              className="-mr-2 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X size={16} />
            </D.Close>
          </header>
          {description ? (
            <D.Description className="px-6 text-[12.5px] text-ink-3">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{typeof title === 'string' ? title : '对话框'}</D.Description>
          )}
          <div className="min-h-0 flex-1 overflow-auto px-6 pb-5 pt-1 text-[13.5px] leading-relaxed text-ink-2">
            {children}
          </div>
          {footer && <footer className="flex shrink-0 justify-end gap-2 bg-surface-2 px-6 py-3.5">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
