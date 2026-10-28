import type { AppConfig, Me } from '@gentransit/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/lib/api'

export const meQuery = { queryKey: ['me'], queryFn: () => get<Me>('/api/auth/me'), retry: false, staleTime: 60_000 }

export const useMe = () => useQuery(meQuery)

/** 前端启动时从服务端取高德 JS Key（不在构建时注入） */
export const useAppConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => get<AppConfig>('/api/config'), staleTime: Infinity })

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post('/api/auth/logout'),
    onSettled: () => {
      qc.clear()
      window.location.assign('/login')
    },
  })
}
