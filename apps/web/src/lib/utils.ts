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

/** 相对时间：刚刚、N 分钟前、N 小时前、N 天前；超过 30 天显示日期 */
export function fmtRelative(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} 天前`
  return fmtDateTime(iso).slice(0, 10)
}

/** 字节数：B、KB、MB、GB */
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
