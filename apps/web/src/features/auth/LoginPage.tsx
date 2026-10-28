import { loginInput, type LoginInput, type Me } from '@gentransit/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import { BrandMark } from '@/components/gt/lively'
import { FieldError } from '@/components/gt/prop'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isApiError, post } from '@/lib/api'

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
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/stops', { replace: true })
    },
  })
  const err = login.error
  // 用户名或密码错误、连续失败被锁定都由服务端给出说明
  const message = err ? (isApiError(err) ? err.message : '无法连接服务器') : null

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="gt-rise w-[380px] rounded-[18px] bg-surface p-8 shadow-pop ring-1 ring-hairline">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <div className="leading-tight">
            <div className="font-display text-[22px] font-bold">GenTransit</div>
            <div className="text-[12.5px] text-ink-3">公交站点、线路与站牌信息</div>
          </div>
        </div>
        <form className="mt-8 flex flex-col gap-4" onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
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
  )
}
