// 设置（5.8）：账号、API Token、方位模式、地标设置、扩展字段、备份（M4）
import {
  ERROR_CODES,
  EXT_OWNERS,
  EXT_OWNER_LABEL,
  EXT_TYPES,
  EXT_TYPE_LABEL,
  ORIENTATION_MODE_LABEL,
  STOP_SECTIONS,
  STOP_SECTION_LABEL,
  changePasswordInput,
  type ChangePasswordInput,
  type ExtFieldDef,
  type ExtOwner,
  type ExtType,
  type OrientationConflict,
  type OrientationMode,
  type StopSection,
} from '@gentransit/shared'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Lock, Pencil, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, NavLink, useParams } from 'react-router'
import { FieldError, Prop } from '@/components/gt/prop'
import { PageHeader, Segmented, Tag } from '@/components/gt/symbols'
import { useToast } from '@/components/gt/toast'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useMe } from '@/features/auth/auth'
import { keys, useExtFields, useSettings } from '@/features/common/data'
import { isApiError, post, put } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ApiTokensTab } from './ApiTokensTab'
import { BackupTab } from './BackupTab'

const TABS = [
  { to: 'account', label: '账号' },
  { to: 'api-tokens', label: 'API Token' },
  { to: 'orientation', label: '方位模式' },
  { to: 'landmarks', label: '地标设置' },
  { to: 'ext-fields', label: '扩展字段' },
  { to: 'backup', label: '备份' },
]

export function SettingsPage() {
  const { tab = 'account' } = useParams()
  return (
    <div className="flex h-full">
      <nav className="w-[200px] shrink-0 border-r border-hairline px-3 pt-6" aria-label="设置分类">
        <h1 className="mb-4 px-3 font-display text-[22px] font-semibold">设置</h1>
        <ul className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <li key={t.to}>
              <NavLink
                to={`/settings/${t.to}`}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center rounded-xl px-3 text-[13.5px]',
                    isActive || (tab === t.to && t.to === 'account')
                      ? 'bg-accent-soft font-semibold text-ink'
                      : 'text-ink-2 hover:bg-sunken',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        {tab === 'account' && <AccountTab />}
        {tab === 'api-tokens' && <ApiTokensTab />}
        {tab === 'orientation' && <OrientationTab />}
        {tab === 'landmarks' && <LandmarkSettingsTab />}
        {tab === 'ext-fields' && <ExtFieldsTab />}
        {tab === 'backup' && <BackupTab />}
      </div>
    </div>
  )
}

/* ---------------- 账号 ---------------- */

function AccountTab() {
  const me = useMe()
  const toast = useToast()
  const form = useForm<ChangePasswordInput & { confirm: string }>({
    resolver: zodResolver(
      changePasswordInput
        .extend({ confirm: changePasswordInput.shape.newPassword })
        .refine((v) => v.confirm === v.newPassword, { path: ['confirm'], message: '两次输入的新密码不一致' }),
    ),
    defaultValues: { oldPassword: '', newPassword: '', confirm: '' },
  })
  const [error, setError] = useState('')
  const submit = form.handleSubmit(async (v) => {
    setError('')
    try {
      await post('/api/auth/password', { oldPassword: v.oldPassword, newPassword: v.newPassword })
      form.reset()
      toast('已修改密码，其他地方的登录已退出')
    } catch (e) {
      setError(isApiError(e) ? e.message : '修改失败')
    }
  })
  const e = form.formState.errors
  return (
    <div className="max-w-[560px]">
      <PageHeader title="账号" sub="一套部署只有一个内置账号" />
      <div className="px-7">
        <Prop label="用户名">
          <span className="font-medium">{me.data?.username}</span>
        </Prop>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3" noValidate>
          <h2 className="text-[13px] font-semibold">修改密码</h2>
          {(
            [
              ['oldPassword', '原密码', 'current-password'],
              ['newPassword', '新密码（至少 8 位）', 'new-password'],
              ['confirm', '再输入一次新密码', 'new-password'],
            ] as const
          ).map(([k, label, ac]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-[12.5px] font-medium text-ink-3">{label}</span>
              <Input type="password" autoComplete={ac} {...form.register(k)} />
              <FieldError>{e[k]?.message}</FieldError>
            </label>
          ))}
          <FieldError>{error}</FieldError>
          <div>
            <Button type="submit" variant="primary" disabled={form.formState.isSubmitting}>
              <Lock size={14} /> 修改密码
            </Button>
          </div>
          <p className="text-[12.5px] text-ink-3">修改成功后，其他浏览器或设备上的登录会退出，当前登录保留。</p>
        </form>
      </div>
    </div>
  )
}

/* ---------------- 方位模式（BR-13） ---------------- */

function OrientationTab() {
  const settings = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [conflict, setConflict] = useState<{
    message: string
    stops: (OrientationConflict & { label: string })[]
    total: number
  } | null>(null)
  const mode = settings.data?.orientationMode ?? 'orientation'
  const change = async (m: OrientationMode) => {
    if (m === mode) return
    try {
      await put('/api/settings/orientation', { mode: m })
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast(`已切换为${ORIENTATION_MODE_LABEL[m]}`)
    } catch (e) {
      if (isApiError(e, ERROR_CODES.orientationIncompatible)) {
        const d = e.details as { stops: (OrientationConflict & { label: string })[]; total: number }
        setConflict({ message: e.message, ...d })
      } else toast(isApiError(e) ? e.message : '切换失败', 'error')
    }
  }
  return (
    <div className="max-w-[640px]">
      <PageHeader title="方位模式" sub="站点以「站名 + 方位」或「站名 + 编码」区分同名站点" />
      <div className="px-7">
        <Segmented
          label="方位模式"
          value={mode}
          onChange={(m) => void change(m)}
          options={[
            { value: 'orientation', label: '方位模式' },
            { value: 'code', label: '编码模式' },
          ]}
        />
        <ul className="mt-5 flex flex-col gap-2 text-[13.5px] text-ink-2">
          <li>
            <b className="text-ink">方位模式</b>：方位只能是东、南、西、北、无、场站之一。
          </li>
          <li>
            <b className="text-ink">编码模式</b>：用任意非空文本代替方位。从方位模式切过去随时可以，原值作为文本保留。
          </li>
          <li>从编码模式切回方位模式时，所有站点的值都必须属于上面六个方位，否则会列出不符合的站点。</li>
        </ul>
      </div>
      <Dialog
        open={Boolean(conflict)}
        onOpenChange={(o) => !o && setConflict(null)}
        title="不能切回方位模式"
        footer={
          <Button variant="primary" onClick={() => setConflict(null)}>
            知道了
          </Button>
        }
      >
        <p>{conflict?.message}。先把这些站点的编码改成方位，再切换。</p>
        <ul className="mt-3 max-h-[260px] overflow-auto rounded-xl ring-1 ring-hairline">
          {conflict?.stops.map((s) => (
            <li key={s.id} className="border-b border-hairline px-3 py-2 last:border-0">
              <Link to={`/stops/${s.id}`} className="text-[13.5px] text-accent hover:underline">
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
        {conflict && conflict.total > conflict.stops.length && (
          <p className="mt-2 text-[12.5px] text-ink-3">另有 {conflict.total - conflict.stops.length} 个未列出</p>
        )}
      </Dialog>
    </div>
  )
}

/* ---------------- 地标设置 ---------------- */

function LandmarkSettingsTab() {
  const settings = useSettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [limit, setLimit] = useState('5')
  const [auto, setAuto] = useState(true)
  useEffect(() => {
    if (settings.data) {
      setLimit(String(settings.data.landmarkLimit))
      setAuto(settings.data.autoMatch)
    }
  }, [settings.data])
  const [error, setError] = useState('')
  const save = async () => {
    setError('')
    try {
      await put('/api/settings/landmarks', { landmarkLimit: Number(limit), autoMatch: auto })
      await qc.invalidateQueries({ queryKey: keys.settings })
      toast('已保存地标设置')
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败')
    }
  }
  return (
    <div className="max-w-[560px]">
      <PageHeader title="地标设置" />
      <div className="px-7">
        <Prop label="单站绑定上限" hint="一个站点最多绑定几个地标">
          <Input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28"
          />
        </Prop>
        <Prop label="自动匹配候选" hint="站点坐标落在地标位置点的辐射半径内时，在站点表单里给出候选">
          <Switch checked={auto} onCheckedChange={setAuto} aria-label="启用自动匹配候选" />
        </Prop>
        <FieldError>{error}</FieldError>
        <Button className="mt-4" variant="primary" onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  )
}

/* ---------------- 扩展字段（5.8.1） ---------------- */

function ExtFieldsTab() {
  const [owner, setOwner] = useState<ExtOwner>('stop')
  const fields = useExtFields(owner)
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<ExtFieldDef | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: keys.ext })
  const list = fields.data ?? []
  const move = async (i: number, d: -1 | 1) => {
    const ids = list.map((f) => f.id)
    ;[ids[i], ids[i + d]] = [ids[i + d], ids[i]]
    await put('/api/ext-fields/order', { ids })
    await refresh()
  }
  const toggle = async (f: ExtFieldDef, enabled: boolean) => {
    try {
      await put(`/api/ext-fields/${f.id}`, { ...f, enabled })
      await refresh()
      toast(enabled ? `已启用「${f.name}」` : `已停用「${f.name}」，已有取值保留`)
    } catch (e) {
      toast(isApiError(e) ? e.message : '保存失败', 'error')
    }
  }
  return (
    <div className="max-w-[860px]">
      <PageHeader
        title="扩展字段"
        sub="字段已有值后类型不能修改；只能停用，不能删除，停用后表单与列表不再显示，已有值保留"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={14} /> 新建字段
          </Button>
        }
      >
        <div className="mt-4">
          <Segmented
            label="归属"
            value={owner}
            onChange={setOwner}
            options={EXT_OWNERS.map((o) => ({ value: o, label: EXT_OWNER_LABEL[o] }))}
          />
        </div>
      </PageHeader>
      <div className="px-7 pb-10">
        <div className="overflow-hidden rounded-2xl ring-1 ring-hairline">
          {list.map((f, i) => (
            <div
              key={f.id}
              className={cn(
                'flex items-center gap-3 border-b border-hairline px-4 py-2.5 last:border-0',
                !f.enabled && 'opacity-60',
              )}
            >
              <div className="flex flex-col">
                <IconButton
                  label={`上移 ${f.name}`}
                  className="size-5"
                  disabled={i === 0}
                  onClick={() => void move(i, -1)}
                >
                  <ArrowUp size={12} />
                </IconButton>
                <IconButton
                  label={`下移 ${f.name}`}
                  className="size-5"
                  disabled={i === list.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  <ArrowDown size={12} />
                </IconButton>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{f.name}</span>
                  <span className="font-mono text-[12px] text-ink-3">{f.key}</span>
                  <Tag>{EXT_TYPE_LABEL[f.type]}</Tag>
                  {f.section && <Tag className="bg-accent-soft text-accent">{STOP_SECTION_LABEL[f.section]}</Tag>}
                  {f.hasValues && (
                    <span
                      className="inline-flex items-center gap-1 text-[11.5px] text-ink-3"
                      title="已有取值，类型锁定"
                    >
                      <Lock size={11} /> 类型已锁定
                    </span>
                  )}
                </div>
                {(f.description || f.options.length > 0) && (
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-3">
                    {f.type === 'select' ? `选项：${f.options.join('、')}` : ''}
                    {f.type === 'select' && f.description ? ' · ' : ''}
                    {f.description}
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-ink-3">
                {f.enabled ? '启用' : '已停用'}
                <Switch checked={f.enabled} onCheckedChange={(v) => void toggle(f, v)} aria-label={`启用 ${f.name}`} />
              </label>
              <IconButton label={`编辑 ${f.name}`} onClick={() => setEditing(f)}>
                <Pencil size={14} />
              </IconButton>
            </div>
          ))}
          {fields.isSuccess && list.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-ink-3">还没有{EXT_OWNER_LABEL[owner]}扩展字段</div>
          )}
        </div>
      </div>
      {editing && (
        <ExtFieldDialog
          owner={owner}
          field={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function ExtFieldDialog({
  owner,
  field,
  onClose,
  onSaved,
}: {
  owner: ExtOwner
  field: ExtFieldDef | null
  onClose: () => void
  onSaved: () => void
}) {
  const [v, setV] = useState({
    key: field?.key ?? '',
    name: field?.name ?? '',
    type: (field?.type ?? 'text') as ExtType,
    options: (field?.options ?? []).join('\n'),
    description: field?.description ?? '',
    section: (field?.section ?? 'other') as StopSection,
    enabled: field?.enabled ?? true,
  })
  const [error, setError] = useState('')
  const toast = useToast()
  const save = async () => {
    setError('')
    const body = {
      name: v.name,
      type: v.type,
      options: v.options
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      description: v.description,
      section: owner === 'stop' ? v.section : null,
      enabled: v.enabled,
    }
    try {
      if (field) await put(`/api/ext-fields/${field.id}`, body)
      else await post('/api/ext-fields', { ...body, owner, key: v.key })
      toast(field ? '已保存扩展字段' : '已新建扩展字段')
      onSaved()
    } catch (e) {
      setError(isApiError(e) ? e.message : '保存失败')
    }
  }
  const label = (text: string, required = false) => (
    <span className="text-[12.5px] font-medium text-ink-3">
      {text}
      {required && <span className="ml-0.5 text-danger">*</span>}
    </span>
  )
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width={500}
      title={field ? `编辑扩展字段「${field.name}」` : `新建${EXT_OWNER_LABEL[owner]}扩展字段`}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          {label('字段名', true)}
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          {label('键', true)}
          <Input
            value={v.key}
            disabled={Boolean(field)}
            placeholder="如 area"
            className="font-mono"
            onChange={(e) => setV({ ...v, key: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          {label('类型', true)}
          <NativeSelect
            value={v.type}
            disabled={field?.hasValues}
            onChange={(e) => setV({ ...v, type: e.target.value as ExtType })}
          >
            {EXT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EXT_TYPE_LABEL[t]}
              </option>
            ))}
          </NativeSelect>
          {field?.hasValues && <span className="text-[12px] text-ink-3">已有取值，类型不能修改</span>}
        </label>
        {owner === 'stop' && (
          <label className="flex flex-col gap-1">
            {label('显示分区')}
            <NativeSelect value={v.section} onChange={(e) => setV({ ...v, section: e.target.value as StopSection })}>
              {STOP_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {STOP_SECTION_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {v.type === 'select' && (
          <label className="col-span-2 flex flex-col gap-1">
            {label('下拉选项（每行一个）', true)}
            <Textarea value={v.options} onChange={(e) => setV({ ...v, options: e.target.value })} />
          </label>
        )}
        <label className="col-span-2 flex flex-col gap-1">
          {label('说明')}
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </label>
      </div>
      <FieldError>{error}</FieldError>
    </Dialog>
  )
}
