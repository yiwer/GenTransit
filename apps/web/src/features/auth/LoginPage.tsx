import { loginInput, type LoginInput, type Me } from '@gentransit/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import loginArt from '@/assets/login-art.mp4'
import { BrandMark } from '@/components/gt/lively'
import { FieldError } from '@/components/gt/prop'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isApiError, post } from '@/lib/api'

/**
 * 右侧的艺术视频（720×1280，10 秒循环，静音）：宽屏才显示，从下向上浮现。
 * 卡片底色取视频首帧的纸色，视频还没加载出来时不闪；减少动态效果时不自动播放，只显示首帧
 */
function LoginArt() {
  const [still] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  return (
    <aside aria-hidden="true" className="hidden items-center justify-center p-5 pl-0 lg:flex">
      <div className="gt-art-rise aspect-[720/1280] h-[min(880px,calc(100svh-2.5rem))] max-w-full overflow-hidden rounded-[20px] bg-[#ebe6dc] shadow-[0_6px_28px_-8px_rgb(60_40_20/0.22)] ring-1 ring-hairline">
        <video
          data-testid="login-art"
          src={loginArt}
          autoPlay={!still}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          className="size-full object-cover"
        />
      </div>
    </aside>
  )
}

export function LoginPage() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const qc = useQueryClient()
  const form = useForm<LoginInput>({ resolver: zodResolver(loginInput), defaultValues: { username: '', password: '' } })
  const login = useMutation({
    mutationFn: (v: LoginInput) => post<Me>('/api/auth/login', v),
    onSuccess: (me) => {
      qc.setQueryData(['me'], me)
      const next = sp.get('next')
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/home', { replace: true })
    },
  })
  const err = login.error
  // 用户名或密码错误、连续失败被锁定都由服务端给出说明
  const message = err ? (isApiError(err) ? err.message : '无法连接服务器') : null

  return (
    <div className="grid h-full overflow-auto lg:grid-cols-2">
      <section className="flex min-h-full flex-col px-8 py-6">
        <div className="flex items-center gap-2.5">
          <BrandMark size={30} />
          <span className="font-display text-[19px] font-bold">GenTransit</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="gt-rise w-full max-w-[380px]">
            <h1 className="text-center font-display text-[40px] font-semibold leading-[1.2] tracking-tight">
              让每块站牌
              <br />
              说清每条路
            </h1>
            <p className="mt-3 text-center text-[14px] text-ink-3">公交站点、线路与站牌信息</p>
            <form
              className="mt-8 flex flex-col gap-4 rounded-[18px] bg-surface p-6 shadow-pop ring-1 ring-hairline"
              onSubmit={form.handleSubmit((v) => login.mutate(v))}
              noValidate
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-ink-3">用户名</span>
                <Input autoFocus autoComplete="username" className="h-10 text-[14px]" {...form.register('username')} />
                <FieldError>{form.formState.errors.username?.message}</FieldError>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-medium text-ink-3">密码</span>
                <Input
                  type="password"
                  autoComplete="current-password"
                  className="h-10 text-[14px]"
                  {...form.register('password')}
                />
                <FieldError>{form.formState.errors.password?.message}</FieldError>
              </label>
              {message && (
                <div role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                  {message}
                </div>
              )}
              <Button type="submit" variant="primary" size="lg" className="mt-2" disabled={login.isPending}>
                <LogIn size={16} /> 登录
              </Button>
            </form>
          </div>
        </div>
      </section>
      <LoginArt />
    </div>
  )
}
