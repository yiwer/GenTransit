import { Popover as P } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverAnchor = P.Anchor
export const PopoverClose = P.Close

export function PopoverContent({ className, align = 'start', sideOffset = 6, ...p }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        {...p}
        className={cn(
          'gt-rise z-50 rounded-xl bg-surface p-1 text-ink shadow-pop ring-1 ring-hairline focus:outline-none',
          className,
        )}
      />
    </P.Portal>
  )
}
