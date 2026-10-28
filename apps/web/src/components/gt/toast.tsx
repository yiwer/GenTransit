// 轻提示：保存成功带印章对勾，需要注意带赭石呼吸点
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SealCheck } from './lively'

type Tone = 'ok' | 'info' | 'warn' | 'error'
type Item = { id: number; text: ReactNode; tone: Tone }

const Ctx = createContext<(text: ReactNode, tone?: Tone) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Item[]>([])
  const push = useCallback((text: ReactNode, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random()
    setList((xs) => [...xs, { id, text, tone }])
    setTimeout(() => setList((xs) => xs.filter((t) => t.id !== id)), tone === 'error' ? 5200 : 3200)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-16 right-5 z-[60] flex flex-col items-end gap-2"
      >
        {list.map((t) => (
          <div
            key={t.id}
            role="status"
            className="gt-rise pointer-events-auto flex max-w-[460px] items-center gap-2 rounded-2xl bg-ink py-2 pl-2.5 pr-4 text-[13.5px] text-paper shadow-pop"
          >
            {t.tone === 'ok' ? (
              <SealCheck size={22} />
            ) : (
              <span
                className={cn(
                  'mx-1 size-2 shrink-0 rounded-full',
                  t.tone === 'warn' && 'gt-breathe bg-signal',
                  t.tone === 'error' && 'bg-danger',
                  t.tone === 'info' && 'bg-paper/60',
                )}
              />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
