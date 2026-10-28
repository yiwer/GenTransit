import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const fieldBase =
  'h-8 rounded-lg bg-sunken px-2.5 text-[13.5px] text-ink ring-1 ring-transparent placeholder:text-ink-4 transition-[background,box-shadow] hover:ring-hairline-2 focus:bg-surface focus:outline-none focus:ring-accent disabled:opacity-50 aria-invalid:ring-danger/60'

/** 调用方给了宽度类就不再加 w-full */
export const fieldClass = (className?: string) =>
  cn(fieldBase, !/(^|\s)w-/.test(className ?? '') && 'w-full', className)

export function Input({ className, ...p }: ComponentProps<'input'>) {
  return <input {...p} className={fieldClass(className)} />
}

export function Textarea({ className, ...p }: ComponentProps<'textarea'>) {
  return <textarea {...p} className={fieldClass(cn('h-auto min-h-[72px] py-2 leading-relaxed', className))} />
}

export const CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236d6b64' stroke-width='2'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")"

/** 原生下拉：用于固定的小选项集（字典类字段用 DictPicker） */
export function NativeSelect({ className, children, style, ...p }: ComponentProps<'select'>) {
  return (
    <select
      {...p}
      className={fieldClass(
        cn('appearance-none bg-[length:15px] bg-[position:right_7px_center] bg-no-repeat pr-7', className),
      )}
      style={{ backgroundImage: CARET, ...style }}
    >
      {children}
    </select>
  )
}
