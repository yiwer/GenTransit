import { countsOf, poolOf, type DictItem, type Passage, type RouteInfo, type SignSetView } from '@gentransit/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Elevation } from '@/components/gt/elevation'
import { ToastProvider } from '@/components/gt/toast'
import { keys } from '@/features/common/data'
import { HomePage } from '@/features/home/HomePage'
import { signSetKey, templatesKey } from './data'
import { SignSetEditorPage } from './SignSetEditorPage'

const ROUTES: RouteInfo[] = [
  { id: 'r1', lineId: 'l1', lineName: 'K1路', kind: 'up', suspended: false, terminal: '火车站' },
  { id: 'r2', lineId: 'l2', lineName: '2路', kind: 'up', suspended: false, terminal: '东站' },
  { id: 'r3', lineId: 'l3', lineName: '10路', kind: 'down', suspended: false, terminal: '西站' },
  { id: 'r9', lineId: 'l9', lineName: '9路', kind: 'up', suspended: true, terminal: '南站' },
]
const PASSAGES: Passage[] = ['r1', 'r2', 'r3'].map((routeId) => ({ routeId, pass: 1, count: 1 }))
const board = (id: string, no: number, width: number) => ({
  id,
  no,
  face: 'front' as const,
  kind: 'whole' as const,
  width,
  height: 1800,
  remark: '',
  slots: [],
})
const shelf = (boards: ReturnType<typeof board>[]) => ({
  id: 'sh1',
  no: 1,
  typeId: 't1',
  typeName: '双立柱站架',
  name: '',
  desc: '',
  noPhysical: false,
  material: '',
  boards,
})

/** 一号牌上：9路（停运，失效）、2路；待编排：K1路、10路 */
function view(): SignSetView {
  const v = {
    id: 'ss1',
    rev: 1,
    stop: { id: 's1', name: '人民广场', direction: '东' },
    reminder: '',
    shelves: [shelf([board('b1', 1, 1800), board('b2', 2, 1800)])],
    schedules: [
      { id: 'x1', routeId: 'r9', pass: 1, placement: 'board' as const, boardId: 'b1', slotId: null, order: 1 },
      { id: 'x2', routeId: 'r2', pass: 1, placement: 'board' as const, boardId: 'b1', slotId: null, order: 2 },
    ],
    routes: ROUTES,
    passages: PASSAGES,
    snapshotCount: 2,
    updatedAt: '2026-10-28T08:00:00.000Z',
  }
  return { ...v, counts: countsOf(poolOf(v, v.passages, v.routes)) }
}

const DICTS: DictItem[] = [{ id: 't1', category: 'shelfType', name: '双立柱站架', refCount: 1 }]

beforeAll(() => {
  // Radix 菜单在 jsdom 里需要的几个浏览器接口
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderEditor(v = view()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(signSetKey('s1'), v)
  qc.setQueryData(keys.dicts, DICTS)
  qc.setQueryData(templatesKey, [])
  const router = createMemoryRouter(
    [
      { path: '/sign-sets/:stopId', element: <SignSetEditorPage /> },
      { path: '*', element: <div>其他页面</div> },
    ],
    { initialEntries: ['/sign-sets/s1'] },
  )
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { qc, router }
}

const boardEl = (label: string) =>
  screen.getAllByTestId('sign-board').find((b) => b.getAttribute('aria-label')!.startsWith(`${label}，`))!
const rowsOf = (label: string) =>
  within(boardEl(label))
    .queryAllByTestId('sign-row')
    .map((r) => r.getAttribute('title')!.split(' · ')[0])
const waiting = () => screen.queryAllByTestId('tray-waiting').map((c) => c.getAttribute('aria-label'))

describe('立面组件', () => {
  it('线路行按牌面宽度分三级；失效编排陶土色加删除线，停运线路的线路牌用停运样式', () => {
    const v = view()
    v.shelves = [shelf([board('n', 1, 600), board('m', 2, 1200), board('w', 3, 1800)])]
    v.schedules = ['n', 'm', 'w'].flatMap((b, i) => [
      { id: `a${i}`, routeId: 'r1', pass: 1, placement: 'board' as const, boardId: b, slotId: null, order: 1 },
      { id: `z${i}`, routeId: 'r9', pass: 1, placement: 'board' as const, boardId: b, slotId: null, order: 2 },
    ])
    render(<Elevation draft={v} pool={poolOf(v, v.passages, v.routes)} />)
    const [narrow, mid, wide] = screen.getAllByTestId('sign-board')
    // 窄：只有线路牌与方向
    expect(within(narrow).queryByText('火车站')).toBeNull()
    expect(within(narrow).getByText('K1路')).toBeInTheDocument()
    // 中：加终点站，不写"开往"
    expect(within(mid).getByText('火车站')).toBeInTheDocument()
    expect(within(mid).queryByText(/开往/)).toBeNull()
    expect(within(mid).getByText('失效')).toHaveClass('line-through')
    // 宽：序号与"开往"
    expect(within(wide).getByText(/开往/)).toBeInTheDocument()
    expect(within(wide).getByText('线路停运')).toHaveClass('line-through')
    expect(within(wide).getByText('9路')).toHaveClass('outline-dashed')
    expect(within(wide).getByText('K1路')).toHaveClass('bg-plate')
  })
})

describe('站牌集编辑器', () => {
  it('托盘菜单（拖拽的键盘替代）："放到…""复制到…""隐藏"', async () => {
    const user = userEvent.setup()
    renderEditor()
    expect(await screen.findByRole('heading', { name: /人民广场/ })).toBeInTheDocument()
    expect(waiting()).toEqual(['10路 下行（待编排），可拖到站牌', 'K1路 上行（待编排），可拖到站牌'])

    await user.click(screen.getByRole('button', { name: 'K1路 上行 的操作' }))
    await user.click(await screen.findByRole('menuitem', { name: /二号牌 · 整版/ }))
    expect(rowsOf('二号牌')).toEqual(['K1路 上行'])
    expect(waiting()).toEqual(['10路 下行（待编排），可拖到站牌'])
    expect(screen.getByText('未保存')).toBeInTheDocument()

    // 站牌上的线路行：复制到另一块牌
    const row = screen.getAllByTestId('sign-row').find((r) => r.getAttribute('title')?.startsWith('K1路'))!
    await user.click(within(row).getByRole('button', { name: 'K1路 上行 的操作' }))
    const menu = await screen.findByRole('menu')
    for (const it of within(menu).getAllByRole('menuitem', { name: /二号牌 · 整版/ }))
      expect(it).toHaveAttribute('data-disabled')
    const copies = within(menu).getAllByRole('menuitem', { name: /一号牌 · 整版/ })
    await user.click(copies[1])
    expect(rowsOf('一号牌')).toEqual(['9路 上行', '2路 上行', 'K1路 上行'])
    expect(rowsOf('二号牌')).toEqual(['K1路 上行'])

    // 隐藏：移除本站全部放置，进入隐藏区
    await user.click(screen.getByRole('button', { name: '10路 下行 的操作' }))
    await user.click(await screen.findByRole('menuitem', { name: /隐藏，不在本站展示/ }))
    expect(screen.getAllByTestId('tray-hidden').map((c) => c.getAttribute('aria-label'))).toEqual([
      '10路 下行（隐藏），可拖到站牌',
    ])
    expect(screen.getByTestId('tray-all-done')).toHaveTextContent('本站途经都已编排')
  })

  it('Ctrl+Z 逐步撤销、Ctrl+Shift+Z 重做；"撤销修改"放弃全部未保存内容', async () => {
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: /人民广场/ })
    await user.click(screen.getByRole('button', { name: 'K1路 上行 的操作' }))
    await user.click(await screen.findByRole('menuitem', { name: /二号牌 · 整版/ }))
    await user.click(screen.getByRole('button', { name: '10路 下行 的操作' }))
    await user.click(await screen.findByRole('menuitem', { name: /二号牌 · 整版/ }))
    expect(rowsOf('二号牌')).toEqual(['K1路 上行', '10路 下行'])

    await user.keyboard('{Control>}z{/Control}')
    expect(rowsOf('二号牌')).toEqual(['K1路 上行'])
    await user.keyboard('{Control>}z{/Control}')
    expect(rowsOf('二号牌')).toEqual([])
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}')
    expect(rowsOf('二号牌')).toEqual(['K1路 上行'])

    await user.click(screen.getByRole('button', { name: /撤销修改/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '撤销修改' }))
    expect(rowsOf('二号牌')).toEqual([])
    expect(screen.queryByText('未保存')).toBeNull()
  })

  it('属性卡改类型时先提示编排会移除；自动排序保留失效编排（AC-15）', async () => {
    const user = userEvent.setup()
    renderEditor()
    await screen.findByRole('heading', { name: /人民广场/ })
    // 先把两条待编排也放到一号牌，再自动排序
    for (const name of ['K1路 上行', '10路 下行']) {
      await user.click(screen.getByRole('button', { name: `${name} 的操作` }))
      await user.click(await screen.findByRole('menuitem', { name: /一号牌 · 整版/ }))
    }
    expect(rowsOf('一号牌')).toEqual(['9路 上行', '2路 上行', 'K1路 上行', '10路 下行'])
    await user.click(boardEl('一号牌'))
    const card = await screen.findByRole('region', { name: '属性' })
    await user.click(within(card).getByRole('button', { name: /自动排序/ }))
    expect(rowsOf('一号牌')).toEqual(['2路 上行', '9路 上行', '10路 下行', 'K1路 上行'])

    await user.click(within(card).getByRole('radio', { name: '分片' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('把一号牌改为分片？')
    expect(dialog).toHaveTextContent('这块牌上 4 条编排随之移除，相关线路回到待编排')
    await user.click(within(dialog).getByRole('button', { name: '改类型' }))
    expect(await screen.findByText('4 条编排随之移除，相关线路回到待编排')).toBeInTheDocument()
    expect(within(boardEl('一号牌')).getAllByTestId('sign-slot')).toHaveLength(1)
    expect(waiting()).toHaveLength(3)
  })

  it('保存：有效修改提示印章；分片站牌没有线路插片时先确认', async () => {
    const user = userEvent.setup()
    const { qc } = renderEditor()
    await screen.findByRole('heading', { name: /人民广场/ })
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/sign-sets/ss1') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        expect(body.rev).toBe(1)
        expect(body.shelves[0]).not.toHaveProperty('typeName')
        return new Response(JSON.stringify({ changed: true, item: { ...view(), rev: 2 } }), { status: 200 })
      }
      return new Response('[]', { status: 200 })
    })
    await user.click(boardEl('二号牌'))
    const card = await screen.findByRole('region', { name: '属性' })
    await user.click(within(card).getByRole('radio', { name: '分片' }))
    const slot = within(boardEl('二号牌')).getByTestId('sign-slot')
    await user.click(slot)
    await user.click(within(await screen.findByRole('region', { name: '属性' })).getByRole('radio', { name: '非线路' }))
    await user.type(screen.getByPlaceholderText('如：广告位、公告栏'), '公告栏')

    await user.click(screen.getByRole('button', { name: /保存/ }))
    const confirm = await screen.findByRole('dialog')
    expect(confirm).toHaveTextContent('二号牌是分片站牌，但没有线路插片')
    await user.click(within(confirm).getByRole('button', { name: '仍然保存' }))
    expect(await screen.findByText('已保存站牌集，生成一份修改快照')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('未保存')).toBeNull())
    expect(qc).toBeTruthy()
  })
})

describe('工作台', () => {
  it('没有待处理时显示空状态', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['sign-sets', 'summary'], { pendingSets: 0, waiting: 0, invalid: 0, signSets: 32 })
    qc.setQueryData(['snapshots', 'recent'], [])
    const router = createMemoryRouter([{ path: '/home', element: <HomePage /> }], { initialEntries: ['/home'] })
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )
    })
    expect(screen.getByTestId('home-all-done')).toHaveTextContent('所有站牌集都已编排妥当')
    expect(screen.getByText('32 个站牌集里，没有待编排或失效的线路。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /新建站点/ })).toHaveAttribute('href', '/stops/new')
  })
})
