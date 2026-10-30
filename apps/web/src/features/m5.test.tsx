import type { DataChecks as Checks, LineDetail, OppositeMap, StopBatchPreview } from '@gentransit/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/gt/toast'
import { DataChecks } from '@/features/home/DataChecks'
import { copyDraftOf, reverseWithOpposites, routeChanges, type RouteDraft, type StopRow } from '@/features/lines/draft'
import { StopTable } from '@/features/lines/stop-table'
import { queueParams, sourceHref, type Queue } from '@/features/sign-sets/queue'
import { QueueTrack } from '@/features/sign-sets/QueueTrack'
import { BatchEditDialog } from '@/features/stops/BatchEditDialog'

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

async function mount(element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: ['/home'] })
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

const stop = (id: string, name: string, direction = '东') => ({ id, name, direction, lng: 120.2, lat: 30.25 })
const row = (key: string, id: string, name: string, direction = '东'): StopRow => ({
  key,
  stop: stop(id, name, direction),
  times: ['06:00'],
  ext: {},
})
const route = (rows: StopRow[]): RouteDraft => ({
  kind: 'up',
  serviceType: null,
  serviceTime: '',
  interval: '',
  stops: rows,
})

describe('编辑器队列', () => {
  it('来源参数规范化；回到来源保留列表筛选', () => {
    expect(queueParams(new URLSearchParams('copyFrom=x'))).toBeNull()
    expect(queueParams(new URLSearchParams('from=nope'))).toBeNull()
    const p = queueParams(new URLSearchParams('pending=1&from=list&copyFrom=x&page=3'))!
    expect(p.toString()).toBe('from=list&page=3&pending=1')
    expect(sourceHref(p)).toEqual({ to: '/sign-sets?page=3&pending=1', label: '站牌集' })
    expect(sourceHref(new URLSearchParams('from=home'))).toEqual({ to: '/home', label: '工作台' })
    expect(sourceHref(new URLSearchParams('from=line&lineId=L'))).toEqual({ to: '/lines/L', label: '线路' })
  })

  it('轨道：第几站、上一站下一站', async () => {
    const onGo = vi.fn()
    const q: Queue = {
      index: 2,
      stopIds: ['a', 'b', 'c', 'd'],
      total: 4,
      done: new Set(['a', 'b']),
      prev: 'b',
      next: 'd',
      hrefOf: (id) => `/sign-sets/${id}`,
      source: { to: '/home', label: '工作台' },
      markDone: () => undefined,
    }
    await mount(<QueueTrack queue={q} onGo={onGo} />)
    expect(screen.getByTestId('queue-pos')).toHaveTextContent('第 3 / 4 站')
    await userEvent.click(screen.getByRole('button', { name: '下一站' }))
    await userEvent.click(screen.getByRole('button', { name: '上一站' }))
    expect(onGo.mock.calls).toEqual([['d'], ['b']])
  })
})

describe('线路表单的辅助', () => {
  it('反向生成换成对向站，没有对向站的行记下来', () => {
    const src = route([row('1', 'a', '甲'), row('2', 'b', '乙'), row('3', 'c', '丙')])
    const opp: OppositeMap = { a: stop('a2', '甲', '西'), b: stop('b2', '乙', '西'), c: null }
    const r = reverseWithOpposites(src, opp)
    expect(r.rows.map((x) => `${x.stop.name}${x.stop.direction}`)).toEqual(['丙东', '乙西', '甲西'])
    expect(r.rows.every((x) => x.times.length === 0)).toBe(true)
    expect(r.missing).toEqual([r.rows[0].key])
  })

  it('站序改动对比：按站点 + 第几次途经，新加的行与移除的站（带原来的前一站）', () => {
    const base = route([row('1', 'a', '甲'), row('2', 'b', '乙'), row('3', 'c', '丙')])
    const cur = route([base.stops[0], row('9', 'x', '新站'), base.stops[2]])
    const d = routeChanges(base, cur)
    expect([...d.added]).toEqual(['9'])
    expect(d.removed.map((r) => [r.row.stop.id, r.index, r.after])).toEqual([['b', 1, 'a']])
  })

  it('复制新建：线路名、管理编号清空，到站时刻不带', () => {
    const l = {
      name: 'K1路',
      number: 'K-1',
      nameEn: '',
      mode: 'oneway',
      status: 'suspended',
      company: null,
      ticketType: null,
      fareSystem: null,
      fare: '2 元',
      ext: {},
      routes: [
        {
          kind: 'oneway',
          serviceType: null,
          serviceTime: '06:00–22:00',
          interval: '',
          stops: [{ stop: stop('a', '甲'), pass: 1, times: ['06:00'], ext: { k: 1 } }],
        },
      ],
    } as unknown as LineDetail
    const d = copyDraftOf(l)
    expect(d).toMatchObject({ name: '', number: '', fare: '2 元', status: 'running' })
    expect(d.routes[0]).toMatchObject({ serviceTime: '06:00–22:00' })
    expect(d.routes[0].stops[0]).toMatchObject({ times: [], ext: { k: 1 } })
  })

  it('站序表：新加的行标"新"，提醒带一键修正', async () => {
    const fix = vi.fn()
    await mount(
      <StopTable
        rows={[row('1', 'a', '甲'), row('2', 'b', '乙')]}
        onChange={() => undefined}
        selected={null}
        onSelect={() => undefined}
        marks={{ '2': { added: true, notes: [{ text: '方位疑似反了', fix: { label: '换成对向站', run: fix } }] } }}
      />,
    )
    const rows = screen.getAllByTestId('stop-row')
    expect(within(rows[0]).queryByTestId('row-added')).toBeNull()
    expect(within(rows[1]).getByTestId('row-added')).toHaveTextContent('新')
    await userEvent.click(within(rows[1]).getByRole('button', { name: '换成对向站' }))
    expect(fix).toHaveBeenCalledOnce()
  })
})

describe('工作台数据体检', () => {
  const zero: Checks = {
    stops: { noNameEn: 0, noRegion: 0, noShelf: 0, noPhoto: 0 },
    lines: { noTrack: 0, trackStale: 0, gap: 0, wrongSide: 0 },
    pendingSets: 0,
  }
  it('有问题的项是链接，带 check 筛选；没有问题的淡显', async () => {
    fetchMock.mockImplementation(async () =>
      json({ ...zero, stops: { ...zero.stops, noNameEn: 12 }, lines: { ...zero.lines, wrongSide: 2 } }),
    )
    await mount(<DataChecks />)
    await waitFor(() => expect(screen.getByTestId('check-noNameEn')).toBeInTheDocument())
    expect(screen.getByTestId('check-noNameEn')).toHaveAttribute('href', '/stops?check=noNameEn')
    expect(screen.getByTestId('check-wrongSide')).toHaveTextContent('方位疑似反了2')
    expect(screen.queryByTestId('check-noPhoto')).toBeNull()
  })
  it('全部为 0：数据完整', async () => {
    fetchMock.mockImplementation(async () => json(zero))
    await mount(<DataChecks />)
    await waitFor(() => expect(screen.getByTestId('data-checks')).toHaveTextContent('数据完整'))
  })
})

describe('批量修改站点', () => {
  it('设为座椅数：预览、确认后提交补丁', async () => {
    const preview: StopBatchPreview = {
      selected: 3,
      changing: 2,
      sample: [{ id: 's1', name: '甲', direction: '东', fields: ['座椅数'] }],
    }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/stops/batch/preview')) return json(preview)
      if (url.includes('/api/stops/batch')) return json({ selected: 3, changed: 2 })
      void init
      return json([])
    })
    const onDone = vi.fn()
    await mount(
      <BatchEditDialog
        open
        onOpenChange={() => undefined}
        scope={{ ids: ['a', 'b', 'c'] }}
        count={3}
        onDone={onDone}
      />,
    )
    const dialog = screen.getByRole('dialog')
    await userEvent.click(
      within(within(dialog).getByRole('radiogroup', { name: '座椅数怎么改' })).getByRole('radio', { name: '设为' }),
    )
    await userEvent.type(within(dialog).getByLabelText('seats'), '4')
    await waitFor(() => expect(within(dialog).getByTestId('batch-preview')).toHaveTextContent('选中 3 个，将变化 2 个'))
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/batch/preview'))!
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      scope: { ids: ['a', 'b', 'c'] },
      patch: { facilities: { seats: 4 } },
    })
    await userEvent.click(within(dialog).getByRole('button', { name: '修改 2 个站点' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(screen.getByText('已修改 2 个站点，各生成一份修改快照')).toBeInTheDocument()
  })
})
