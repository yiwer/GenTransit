import type { LineListItem, LineOptions } from '@gentransit/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LineFilter } from '@/components/gt/line-filter'
import { ToastProvider } from '@/components/gt/toast'
import { LineListPage } from '@/features/lines/LineListPage'
import { signSetQuery, useSignSet } from '@/features/sign-sets/data'
import { StopDetailPage } from '@/features/stops/StopDetailPage'

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** 按路径（不含查询串）给出响应；没列出的返回空数组 */
let routes: Record<string, (url: URL) => unknown>
let fetchMock: ReturnType<typeof vi.fn>
const requested = () => fetchMock.mock.calls.map(([u]) => String(u))
beforeEach(() => {
  routes = {}
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    const h = routes[url.pathname]
    return json(h ? await h(url) : [])
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

async function mount(element: React.ReactNode, path = '/', pattern = '*') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const router = createMemoryRouter([{ path: pattern, element }], { initialEntries: [path] })
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>,
    )
  })
  return { qc, router }
}

describe('线路列表的地图（Q79）', () => {
  const line: LineListItem = {
    id: 'L1',
    name: 'K1路',
    number: 'K-1',
    nameEn: '',
    mode: 'twoway',
    status: 'running',
    company: null,
    ticketType: null,
    fareSystem: null,
    fare: '',
    ext: {},
    updatedAt: '2026-10-30T00:00:00.000Z',
    routes: [
      {
        id: 'R1',
        kind: 'up',
        count: 2,
        origin: '甲',
        terminal: '乙',
        path: [
          [120.2, 30.25],
          [120.21, 30.26],
        ],
      },
      {
        id: 'R2',
        kind: 'down',
        count: 2,
        origin: '乙',
        terminal: '甲',
        path: [
          [120.21, 30.26],
          [120.2, 30.25],
        ],
      },
    ],
  }

  it('走向一律按站点连线画虚线；图例与卡片都按"按站点连线"', async () => {
    routes['/api/lines'] = () => ({ items: [line], total: 1, page: 1, size: 20 })
    routes['/api/config'] = () => ({ amapKey: null, amapProxy: false, regeo: false, routeTrack: false })
    routes['/api/stops/extent'] = () => null
    await mount(<LineListPage />, '/lines')

    const up = await screen.findByTestId('map-route-R1')
    expect(up).toHaveAttribute('data-road', 'stops')
    expect(screen.getByTestId('map-route-R2')).toHaveAttribute('data-road', 'stops')
    expect(screen.getByTestId('route-legend')).toHaveTextContent('虚线：按站点连线')
    expect(screen.getByTestId('route-legend')).not.toHaveTextContent('未算轨迹')

    // 选中线路浮出的卡片：各走向的线型示意都画虚线
    await userEvent.click(screen.getByRole('button', { name: 'K1路' }))
    const card = screen.getByRole('button', { name: '查看详情' }).closest('div.gt-rise') as HTMLElement
    const samples = within(card).getAllByRole('listitem')
    expect(samples).toHaveLength(2)
    for (const li of samples) expect(li.querySelector('line[stroke-dasharray]')).not.toBeNull()
  })
})

describe('"经过线路"选择器（M6）', () => {
  const option = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `${i}路` })
  const options = (from: number, n: number, total: number): LineOptions => ({
    items: Array.from({ length: n }, (_, k) => ({ ...option(from + k), status: 'running' as const })),
    total,
  })

  it('打开弹出层前不加载候选；已选线路的名称按 ID 查询，靠后的线路也能显示', async () => {
    const picked = option(2700)
    routes['/api/lines/options'] = (url) =>
      url.searchParams.get('ids') ? { items: [{ ...picked, status: 'running' }], total: 1 } : options(1, 100, 3000)
    await mount(<LineFilter value={[picked.id]} onChange={() => undefined} chip={() => ''} />)

    const trigger = screen.getByRole('button', { name: '经过线路' })
    await waitFor(() => expect(trigger).toHaveTextContent('2700路'))
    expect(requested()).toEqual([`/api/lines/options?ids=${picked.id}`])
    expect(requested().some((u) => u.startsWith('/api/lines?'))).toBe(false)

    await userEvent.click(trigger)
    expect(await screen.findByRole('button', { name: '1路', pressed: false })).toBeInTheDocument()
    expect(requested()).toContain('/api/lines/options?size=100')
    expect(screen.getByText('还有 2900 条，输入线路名缩小范围')).toBeInTheDocument()
  })

  it('输入时按 q 查询，选中后回调', async () => {
    routes['/api/lines/options'] = (url) => (url.searchParams.get('q') === '27' ? options(27, 1, 1) : options(1, 3, 3))
    const onChange = vi.fn()
    await mount(<LineFilter value={[]} onChange={onChange} chip={() => ''} />)
    expect(requested()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: '经过线路' }))
    await userEvent.type(await screen.findByRole('textbox', { name: '搜索线路' }), '27')
    await userEvent.click(await screen.findByRole('button', { name: '27路' }))
    expect(onChange).toHaveBeenCalledWith([option(27).id])
    expect(requested()).toContain('/api/lines/options?q=27&size=100')
  })
})

describe('站点详情（M6 计划 4.4）', () => {
  it('站牌集与站点详情同时请求，不等详情返回', async () => {
    let release = () => {}
    routes['/api/stops/S1'] = () =>
      new Promise((resolve) => {
        release = () => resolve({ message: '测试里不返回详情' })
      })
    await mount(<StopDetailPage />, '/stops/S1', '/stops/:id')
    await waitFor(() => expect(requested()).toContain('/api/stops/S1/sign-set'))
    expect(requested()).toContain('/api/stops/S1')
    release()
  })

  it('"站牌集"一节直接用预取的内容，不再重新读取', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } })
    routes['/api/stops/S1/sign-set'] = () => ({ id: 'ss1' })
    await qc.prefetchQuery(signSetQuery('S1'))
    function Probe() {
      return <span>{useSignSet('S1').data?.id}</span>
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('ss1')).toBeInTheDocument()
    expect(requested().filter((u) => u === '/api/stops/S1/sign-set')).toHaveLength(1)
  })
})
