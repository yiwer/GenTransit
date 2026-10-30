// 只在跳转后出现一次的提示（M5"保存后下一步"）：进入页面时读出路由状态并立即清掉，刷新或前进后退都不再出现
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

export function useNavStateOnce<T extends object>(): Partial<T> {
  const location = useLocation()
  const nav = useNavigate()
  const [state] = useState(() => (location.state ?? {}) as Partial<T>)
  useEffect(() => {
    if (location.state) nav(`${location.pathname}${location.search}`, { replace: true, state: null })
    // 只在进入页面时清一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}
