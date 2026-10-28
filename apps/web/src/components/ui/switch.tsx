import { Check } from 'lucide-react'
import { Checkbox as C, Switch as S } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Switch({ className, ...p }: ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      {...p}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-hairline-2 transition-colors data-[state=checked]:bg-accent disabled:opacity-40',
        className,
      )}
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow-xs transition-transform duration-300 ease-[var(--bounce)] data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  )
}

export function Checkbox({ label, className, ...p }: ComponentProps<typeof C.Root> & { label?: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-[13.5px] text-ink', className)}>
      <C.Root
        {...p}
        className="flex size-4 items-center justify-center rounded-[5px] bg-surface ring-1 ring-hairline-2 transition-colors data-[state=checked]:bg-accent data-[state=checked]:ring-accent"
      >
        <C.Indicator>
          <Check size={11} strokeWidth={3} className="text-accent-ink" />
        </C.Indicator>
      </C.Root>
      {label}
    </label>
  )
}
