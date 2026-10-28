import { X } from 'lucide-react'
import { Dialog as D } from 'radix-ui'
import type { ReactNode } from 'react'

/** 右侧抽屉：基于 Radix Dialog（焦点圈定、Esc 关闭） */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="gt-fade fixed inset-0 z-50 bg-ink/15 backdrop-blur-[2px]" />
        <D.Content
          className="gt-rise fixed inset-y-2 right-2 z-50 flex flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline focus:outline-none"
          style={{ width }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div>
              <D.Title className="text-[16px] font-semibold leading-6">{title}</D.Title>
              <D.Description className={description ? 'mt-0.5 text-[12.5px] text-ink-3' : 'sr-only'}>
                {description ?? (typeof title === 'string' ? title : '抽屉')}
              </D.Description>
            </div>
            <D.Close
              aria-label="关闭"
              className="-mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X size={16} />
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-6 pb-5 pt-2 text-[13.5px] text-ink-2">{children}</div>
          {footer && (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline bg-surface-2 px-6 py-3">
              {footer}
            </footer>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
