import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { useEffect, useState } from 'react'

// 让 tailwind-merge 认识自定义的字号写法与阴影令牌
const twMerge = extendTailwindMerge({
  extend: { classGroups: { shadow: ['shadow-xs', 'shadow-float', 'shadow-pop'] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 记在本浏览器的值（localStorage，JSON）；存储不可用时退回内存 */
export function useStored<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? (JSON.parse(s) as T) : init
    } catch {
      return init
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // 忽略
    }
  }, [key, v])
  return [v, setV] as const
}

export const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
