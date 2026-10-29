// 设置 → API Token（需求 5.8，M4 计划第 7 节）：新建时明文只显示一次（票根样式），吊销立即生效。
// 每张 Token 卡片左侧是一枚小钥匙，齿形按名称哈希生成，一眼能分开
import { apiTokenInput, type ApiTokenCreated, type ApiTokenItem } from '@gentransit/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, ExternalLink, KeyRound, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { FieldError } from '@/components/gt/prop'
import { PageHeader } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { del, get, isApiError, post } from '@/lib/api'
import { cn, fmtDateTime, fmtRelative } from '@/lib/utils'

export const tokenKeys = ['api-tokens'] as const

const useTokens = () => useQuery({ queryKey: tokenKeys, queryFn: () => get<ApiTokenItem[]>('/api/api-tokens') })

/** 名称的稳定哈希（FNV-1a），决定钥匙的齿形与绳结弯度 */
function hashOf(s: string) {
  let h = 0x811c9dc5
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0
  return h
}

/** 小钥匙：圆环 + 钥杆 + 四颗按哈希高低错落的齿，环上系一段弯绳 */
export function KeyTag({ name, size = 52 }: { name: string; size?: number }) {
  const h = hashOf(name)
  const teeth = [0, 1, 2, 3].map((i) => 3 + ((h >>> (i * 3)) & 7) * 0.9)
  const bow = 6 + ((h >>> 14) & 7)
  const s = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  // 钥杆从 x=22 到 x=50，齿在杆下方，每颗宽 4
  const path = [
    'M22 18.2 H50 a2 2 0 0 1 0 3.6 H',
    ...teeth.flatMap((d, i) => {
      const x = 47 - i * 6
      return [`${x} v${d.toFixed(1)} h-3.2 v-${d.toFixed(1)} H`]
    }),
    '22 Z',
  ].join('')
  return (
    <svg
      viewBox="0 0 56 40"
      width={size}
      height={(size * 40) / 56}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
      data-testid="key-tag"
    >
      <path
        d={`M6 ${30 - bow / 3} C ${2 + bow / 2} ${38 - bow}, 10 ${36 - bow / 2}, 12 27`}
        fill="none"
        stroke="var(--signal)"
        strokeWidth={1.6}
        {...s}
      />
      <circle cx="14" cy="20" r="8.5" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1.6} />
      <circle cx="14" cy="20" r="3.2" fill="var(--surface)" stroke="var(--accent)" strokeWidth={1.4} />
      <path d={path} fill="var(--plate)" stroke="var(--accent)" strokeWidth={1} {...s} />
    </svg>
  )
}

/** 空状态：一只挂钩上空空的钥匙圈，轻轻摆动 */
function EmptyRingArt() {
  const s = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 120 90" width={120} height={90} aria-hidden="true">
      <ellipse cx="60" cy="84" rx="34" ry="3.5" fill="var(--ink)" fillOpacity="0.06" />
      <path d="M38 12 H82" stroke="var(--ink-3)" {...s} />
      <path d="M60 12 v10" stroke="var(--ink-3)" {...s} />
      <g className="gt-float" style={{ transformOrigin: '60px 22px' }}>
        <circle cx="60" cy="42" r="18" fill="none" stroke="var(--ink-3)" strokeDasharray="3 4" {...s} />
        <path d="M60 22 v2" stroke="var(--ink-3)" {...s} />
        <circle cx="60" cy="42" r="3" fill="var(--signal-soft)" stroke="var(--signal)" {...s} />
      </g>
    </svg>
  )
}

/* ---------------- 新建：表单 → 票根 ---------------- */

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<ApiTokenCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const [asking, setAsking] = useState(false)

  const reset = () => {
    setName('')
    setError('')
    setCreated(null)
    setCopied(false)
    setAsking(false)
  }
  const close = () => {
    reset()
    onClose()
  }
  /** 票根状态下，Esc、点遮罩、右上角关闭都先询问 */
  const onOpenChange = (o: boolean) => {
    if (o) return
    if (created) setAsking(true)
    else close()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const r = apiTokenInput.safeParse({ name })
    if (!r.success) return setError(r.error.issues[0].message)
    setBusy(true)
    setError('')
    try {
      const t = await post<ApiTokenCreated>('/api/api-tokens', r.data)
      setCreated(t)
      await qc.invalidateQueries({ queryKey: tokenKeys })
    } catch (err) {
      setError(isApiError(err) ? err.message : '新建失败')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      setError('浏览器不允许写剪贴板，请手动选中复制')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={created ? 'Token 已生成' : '新建 API Token'}
      width={created ? 560 : 440}
      footer={
        created ? (
          asking ? (
            <>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                继续查看
              </Button>
              <Button variant="danger" onClick={close}>
                仍然关闭
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={close}>
              <Check size={14} /> 我已复制
            </Button>
          )
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <Button variant="primary" type="submit" form="token-form" disabled={busy}>
              生成
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <Ticket token={created} copied={copied} onCopy={() => void copy()} />
          {asking ? (
            <p
              className="rounded-xl bg-danger-soft/70 px-3.5 py-2.5 text-[13px] text-ink ring-1 ring-danger/25"
              role="alert"
            >
              还没确认复制。关闭后再也看不到这串 Token，只能吊销后重新生成。
            </p>
          ) : (
            <p className="text-[12.5px] text-ink-3">关闭后无法再次查看。请现在复制，交给要接入的系统保管。</p>
          )}
          <FieldError>{error}</FieldError>
        </div>
      ) : (
        <form id="token-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-1.5" noValidate>
          <label className="flex flex-col gap-1">
            <span className="text-[12.5px] font-medium text-ink-3">名称（给哪个系统用）</span>
            <Input
              autoFocus
              value={name}
              maxLength={50}
              placeholder="如：数据中台、站牌印刷"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <FieldError>{error}</FieldError>
        </form>
      )}
    </Dialog>
  )
}

/** 票根：左边是撕口与竖排的"只读"字样，右边是等宽的明文 */
function Ticket({ token, copied, onCopy }: { token: ApiTokenCreated; copied: boolean; onCopy: () => void }) {
  return (
    <div
      className="gt-rise relative flex overflow-hidden rounded-xl bg-signal-soft/55 ring-1 ring-signal/35"
      data-testid="token-ticket"
    >
      {/* 上下两个半圆缺口 */}
      <span className="absolute -top-2 left-[58px] size-4 rounded-full bg-surface ring-1 ring-signal/35" />
      <span className="absolute -bottom-2 left-[58px] size-4 rounded-full bg-surface ring-1 ring-signal/35" />
      <div className="flex w-[66px] shrink-0 flex-col items-center justify-center gap-1 border-r-2 border-dashed border-signal/45 py-4">
        <KeyTag name={token.name} size={40} />
        <span className="text-[10.5px] font-semibold tracking-[0.2em] text-signal-ink">只读</span>
      </div>
      <div className="min-w-0 flex-1 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-ink">{token.name}</span>
          <span className="text-[11.5px] text-ink-3">{fmtDateTime(token.createdAt)}</span>
        </div>
        <code
          className="mt-1.5 block select-all break-all font-mono text-[13.5px] leading-6 text-ink"
          data-testid="token-plain"
        >
          {token.token}
        </code>
        <Button size="sm" variant={copied ? 'subtle' : 'secondary'} className="mt-2" onClick={onCopy}>
          {copied ? <Check size={13} className="text-sage" /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  )
}

/* ---------------- 页签 ---------------- */

export function ApiTokensTab() {
  const q = useTokens()
  const qc = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiTokenItem | null>(null)
  const tokens = q.data ?? []

  const revoke = async () => {
    if (!revoking) return
    try {
      await del(`/api/api-tokens/${revoking.id}`)
      toast(`已吊销「${revoking.name}」`)
    } catch (e) {
      toast(isApiError(e) ? e.message : '吊销失败', 'error')
    }
    setRevoking(null)
    await qc.invalidateQueries({ queryKey: tokenKeys })
  }

  return (
    <div className="max-w-[760px]">
      <PageHeader
        title="API Token"
        sub="给其他系统调用只读 API 用。Token 只在创建时显示一次。"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> 新建 Token
          </Button>
        }
      />
      <div className="px-7">
        {q.isSuccess && tokens.length === 0 ? (
          <div className="flex items-center gap-5 rounded-2xl bg-surface-2 px-6 py-5 ring-1 ring-hairline">
            <EmptyRingArt />
            <div>
              <div className="font-display text-[18px] font-semibold">还没有 Token</div>
              <p className="mt-1 text-[13px] text-ink-3">下游系统要读取站点、线路、站牌集时，为它新建一个。</p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-label="API Token 列表">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="group flex items-center gap-4 rounded-2xl bg-surface px-4 py-3 shadow-xs ring-1 ring-hairline transition-shadow hover:shadow-float"
              >
                <KeyTag name={t.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{t.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-3">
                    <code className="font-mono text-ink-2">{t.prefix}…</code>
                    <span>创建于 {fmtDateTime(t.createdAt)}</span>
                    <span
                      className={cn('inline-flex items-center gap-1', t.lastUsedAt && 'text-ink-2')}
                      title={t.lastUsedAt ? fmtDateTime(t.lastUsedAt) : undefined}
                    >
                      <span className={cn('size-1.5 rounded-full', t.lastUsedAt ? 'bg-sage' : 'border border-ink-4')} />
                      {t.lastUsedAt ? `最后使用 ${fmtRelative(t.lastUsedAt)}` : '从未使用'}
                    </span>
                  </div>
                </div>
                <Button variant="danger" size="sm" onClick={() => setRevoking(t)}>
                  吊销
                </Button>
              </li>
            ))}
          </ul>
        )}

        <section className="mt-8 rounded-2xl border-2 border-dashed border-hairline-2 px-5 py-4" aria-label="接入要点">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <KeyRound size={14} className="text-accent" /> 接入要点
          </div>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-ink-2">
            <li>
              请求头{' '}
              <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[12.5px]">
                Authorization: Bearer gt_…
              </code>
              ，只有 GET。
            </li>
            <li>
              列表按游标翻页取完，记下 <code className="font-mono text-[12.5px]">nextUpdatedSince</code>
              ，下一轮作为 <code className="font-mono text-[12.5px]">updatedSince</code> 传入，做增量同步。
            </li>
          </ul>
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
          >
            打开 API 文档 <ExternalLink size={13} />
          </a>
        </section>
      </div>

      <CreateDialog open={creating} onClose={() => setCreating(false)} />
      <Dialog
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`吊销「${revoking?.name ?? ''}」？`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void revoke()}>
              吊销
            </Button>
          </>
        }
      >
        使用它的系统会立即无法调用。吊销后不能恢复，需要时请重新生成。
      </Dialog>
    </div>
  )
}
