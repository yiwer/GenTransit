import { DropdownMenu as M } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ className, align = 'end', sideOffset = 6, ...p }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={sideOffset}
        {...p}
        className={cn(
          'gt-rise z-50 min-w-[180px] rounded-xl bg-surface p-1 shadow-pop ring-1 ring-hairline',
          className,
        )}
      />
    </M.Portal>
  )
}

export function MenuItem({
  children,
  danger,
  hint,
  className,
  ...p
}: ComponentProps<typeof M.Item> & { danger?: boolean; hint?: ReactNode }) {
  return (
    <M.Item
      {...p}
      className={cn(
        'flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[13.5px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
        danger ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-ink data-[highlighted]:bg-sunken',
        className,
      )}
    >
      <span className="flex items-center gap-2">{children}</span>
      {hint !== undefined && <span className="text-[12px] text-ink-3">{hint}</span>}
    </M.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pb-1 pt-2 text-[11.5px] font-medium text-ink-3">{children}</M.Label>
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-hairline" />
}
