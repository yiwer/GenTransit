import type { ApiTokenCreated, ApiTokenItem, BackupDay, BackupStatus } from '@gentransit/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/gt/toast'
import { HomePage } from '@/features/home/HomePage'
import { ApiTokensTab, tokenKeys } from './ApiTokensTab'
import { BackupTab, backupKeys } from './BackupTab'

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => json([]))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function mount(element: React.ReactNode, seed: (qc: QueryClient) => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  seed(qc)
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/settings'] })
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    )
  })
  return qc
}

const TOKEN = `gt_${'Ab9-_'.repeat(8)}xyz`
const item: ApiTokenItem = {
  id: 't1',
  name: '数据中台',
  prefix: TOKEN.slice(0, 10),
  createdAt: '2026-10-20T08:00:00.000Z',
  lastUsedAt: null,
}

describe('设置 → API Token', () => {
  it('列表：前缀、从未使用；钥匙齿形按名称不同', async () => {
    await mount(<ApiTokensTab />, (qc) =>
      qc.setQueryData(tokenKeys, [item, { ...item, id: 't2', name: '站牌印刷', lastUsedAt: new Date().toISOString() }]),
    )
    const list = screen.getByRole('list', { name: 'API Token 列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getAllByText(`${item.prefix}…`)).toHaveLength(2)
    expect(within(list).getByText('从未使用')).toBeInTheDocument()
    expect(within(list).getByText('最后使用 刚刚')).toBeInTheDocument()
    const [a, b] = screen.getAllByTestId('key-tag')
    expect(a.innerHTML).not.toBe(b.innerHTML)
    expect(screen.getByRole('link', { name: /打开 API 文档/ })).toHaveAttribute('href', '/api/v1/docs')
  })

  it('新建后明文只出现一次；关闭要确认；关闭后不再显示', async () => {
    const created: ApiTokenCreated = { ...item, token: TOKEN }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/api-tokens' && init?.method === 'POST') return json(created, 201)
      return json([item])
    })
    const user = userEvent.setup()
    await mount(<ApiTokensTab />, (qc) => qc.setQueryData(tokenKeys, []))
    await user.click(screen.getByRole('button', { name: '新建 Token' }))
    await user.type(screen.getByPlaceholderText(/数据中台/), '数据中台')
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(await screen.findByTestId('token-plain')).toHaveTextContent(TOKEN)
    expect(screen.getAllByText(TOKEN)).toHaveLength(1)
    expect(screen.getByText(/关闭后无法再次查看/)).toBeInTheDocument()

    // Esc 先询问，不直接关闭
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('token-plain')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('还没确认复制')
    await user.click(screen.getByRole('button', { name: '继续查看' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '我已复制' }))
    await waitFor(() => expect(screen.queryByTestId('token-plain')).not.toBeInTheDocument())
    expect(screen.queryByText(TOKEN)).not.toBeInTheDocument()
    // 列表里只有前缀
    expect(await screen.findByText(`${item.prefix}…`)).toBeInTheDocument()
  })

  it('吊销要确认，写明使用它的系统会立即无法调用', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      return json([])
    })
    const user = userEvent.setup()
    await mount(<ApiTokensTab />, (qc) => qc.setQueryData(tokenKeys, [item]))
    await user.click(screen.getByRole('button', { name: '吊销' }))
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent('吊销「数据中台」？')
    expect(dlg).toHaveTextContent('使用它的系统会立即无法调用')
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
    await user.click(within(dlg).getByRole('button', { name: '吊销' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/api-tokens/t1', expect.objectContaining({ method: 'DELETE' })),
    )
  })
})

const days = (fn: (i: number) => BackupDay['status']): BackupDay[] =>
  Array.from({ length: 30 }, (_, i) => {
    const d = new Date(2026, 9, 28 - (29 - i))
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const status = fn(i)
    return { date, status, size: status === 'ok' ? 1_234_567 : null }
  })

const status = (over: Partial<BackupStatus>): BackupStatus => ({
  configured: true,
  retentionDays: 30,
  lastSuccessAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  lastAttemptAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  lastError: null,
  latest: { name: '20261028-023000', size: 1_234_567, createdAt: new Date(Date.now() - 3 * 3600_000).toISOString() },
  days: days(() => 'ok'),
  alert: null,
  ...over,
})

describe('设置 → 备份', () => {
  it('未配置', async () => {
    await mount(<BackupTab />, (qc) => qc.setQueryData(backupKeys, status({ configured: false, days: [] })))
    expect(screen.getByTestId('backup-unconfigured')).toHaveTextContent('未配置备份')
    expect(screen.getByText('docs/deploy.md')).toBeInTheDocument()
  })

  it('正常：最近一次成功、30 天日历、恢复命令', async () => {
    await mount(<BackupTab />, (qc) =>
      qc.setQueryData(backupKeys, status({ days: days((i) => (i === 3 ? 'missing' : 'ok')) })),
    )
    expect(screen.getByTestId('backup-last')).toHaveTextContent('3 小时前')
    expect(screen.getByText('20261028-023000').parentElement).toHaveTextContent('1.2 MB')
    expect(screen.getAllByTestId('backup-day-ok')).toHaveLength(29)
    expect(screen.getAllByTestId('backup-day-missing')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('bash deploy/restore.sh 备份名')).toBeInTheDocument()
  })

  it('过期与失败', async () => {
    const old = new Date(Date.now() - 3 * 86400_000).toISOString()
    await mount(<BackupTab />, (qc) => qc.setQueryData(backupKeys, status({ lastSuccessAt: old, alert: 'stale' })))
    expect(screen.getByRole('alert')).toHaveTextContent('已经 3 天没有成功备份')
  })

  it('失败：日历上标出失败日', async () => {
    await mount(<BackupTab />, (qc) =>
      qc.setQueryData(
        backupKeys,
        status({ alert: 'failed', lastError: 'pg_dump: 连接失败', days: days((i) => (i === 29 ? 'failed' : 'ok')) }),
      ),
    )
    expect(screen.getByRole('alert')).toHaveTextContent('最近一次备份失败：pg_dump: 连接失败')
    expect(screen.getAllByTestId('backup-day-failed')).toHaveLength(1)
  })
})

describe('工作台备份提醒', () => {
  const home = (s: BackupStatus | null) =>
    mount(<HomePage />, (qc) => {
      qc.setQueryData(['sign-sets', 'summary'], { pendingSets: 0, waiting: 0, invalid: 0, signSets: 3 })
      qc.setQueryData(['snapshots', 'recent'], [])
      qc.setQueryData(backupKeys, s)
    })

  it('没有问题、没有配置时不显示', async () => {
    await home(status({}))
    expect(screen.queryByTestId('home-backup-alert')).not.toBeInTheDocument()
  })

  it('未配置也不显示', async () => {
    await home(status({ configured: false, alert: null }))
    expect(screen.queryByTestId('home-backup-alert')).not.toBeInTheDocument()
  })

  it('超过 48 小时或失败时显示赭石色提醒，链接到设置', async () => {
    await home(status({ alert: 'failed', lastError: '磁盘已满' }))
    const a = screen.getByTestId('home-backup-alert')
    expect(a).toHaveTextContent('最近一次备份失败：磁盘已满')
    expect(a).toHaveAttribute('href', '/settings/backup')
  })
})
