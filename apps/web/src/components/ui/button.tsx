import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background,box-shadow,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink shadow-xs hover:bg-accent-hover',
        secondary: 'bg-surface text-ink shadow-xs ring-1 ring-hairline-2 hover:bg-surface-2 hover:ring-accent/35',
        ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
        subtle: 'bg-sunken text-ink hover:bg-hairline-2',
        signal: 'bg-signal text-ink shadow-xs hover:brightness-95',
        danger: 'bg-surface text-danger ring-1 ring-danger/30 hover:bg-danger-soft',
      },
      size: {
        sm: 'h-7 px-2.5 text-[12.5px]',
        md: 'h-8 px-3 text-[13.5px]',
        lg: 'h-10 px-4 text-[14.5px]',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild,
  type = 'button',
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export function IconButton({ label, className, children, ...p }: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...p}
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-sunken hover:text-ink disabled:opacity-35',
        className,
      )}
    >
      {children}
    </button>
  )
}
