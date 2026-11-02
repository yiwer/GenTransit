// M7：站架类型（立面按类型画、属性卡面选项、站架类型页、3D 懒加载与兜底）
import fs from 'node:fs'
import path from 'node:path'
import {
  SHELF_PARAM_DEFAULTS,
  countsOf,
  poolOf,
  type ShelfForm,
  type ShelfTypeItem,
  type SignSetView,
} from '@gentransit/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Elevation } from '@/components/gt/elevation'
import { ToastProvider } from '@/components/gt/toast'
import { ShelfTypesTab } from '@/features/base-data/ShelfTypesTab'
import { keys } from '@/features/common/data'
import { signSetKey, templatesKey } from '@/features/sign-sets/data'
import { SignSetEditorPage } from '@/features/sign-sets/SignSetEditorPage'
import { pickOnClick } from '@/three/ShelfScene3D'

const type = (id: string, name: string, form: ShelfForm, params: object = {}, extra: Partial<ShelfTypeItem> = {}) =>
  ({
    id,
    name,
    form,
    params: { ...SHELF_PARAM_DEFAULTS[form], ...params },
    desc: '',
    needsReview: false,
    shelfCount: 0,
    templateCount: 0,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  }) as ShelfTypeItem

const TYPES = [
  type('t-single', '单立柱站架', 'singlePost'),
  type('t-double', '双立柱站架', 'doublePost', {}, { shelfCount: 3, templateCount: 1 }),
  type('t-shelter', '候车亭灯箱', 'shelter', { mountBottom: 400 }),
  type('t-totem', '三面图腾柱', 'totem', { faces: 3 }),
  type('t-wall', '挂墙站牌', 'attached', { host: 'wall' }),
  type('t-epost', '电子站牌立杆', 'ePost', {}, { needsReview: true }),
]

const board = (id: string, no: number, face: string, width = 1200, height = 1800) => ({
  id,
  no,
  face: face as 'front',
  kind: 'whole' as const,
  width,
  height,
  remark: '',
  slots: [],
})
const shelf = (id: string, no: number, typeId: string, boards: ReturnType<typeof board>[]) => ({
  id,
  no,
  typeId,
  typeName: TYPES.find((t) => t.id === typeId)?.name ?? '?',
  name: '',
  desc: '',
  noPhysical: false,
  material: '',
  boards,
})

function view(shelves: ReturnType<typeof shelf>[]): SignSetView {
  const v = {
    id: 'ss1',
    rev: 1,
    stop: { id: 's1', name: '金融中心', direction: '西' },
    reminder: '',
    shelves,
    schedules: [],
    routes: [],
    passages: [],
    snapshotCount: 1,
    updatedAt: '2026-11-01T08:00:00.000Z',
  }
  return { ...v, counts: countsOf(poolOf(v, v.passages, v.routes)) }
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json([]))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderEditor(v: SignSetView) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  qc.setQueryData(signSetKey('s1'), v)
  fetchMock.mockImplementation(async (url: string) =>
    String(url) === '/api/stops/s1/sign-set' ? Response.json(v) : Response.json([]),
  )
  qc.setQueryData(keys.shelfTypes, TYPES)
  qc.setQueryData(templatesKey, [])
  const router = createMemoryRouter([{ path: '/sign-sets/:stopId', element: <SignSetEditorPage /> }], {
    initialEntries: ['/sign-sets/s1'],
  })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return qc
}

const parts = (el: HTMLElement) =>
  new Set([...el.querySelectorAll('[data-part]')].map((x) => x.getAttribute('data-part')))
const faces = (el: HTMLElement) =>
  within(el)
    .getAllByTestId('shelf-face')
    .map((f) => f.getAttribute('data-face'))

describe('立面按站架类型画（M7 T3）', () => {
  it('每种形式画出对应的部件，按面展开并标面名；没有按名称判断', () => {
    const v = view([
      shelf('a', 1, 't-single', [board('b1', 1, 'front')]),
      shelf('b', 2, 't-double', [board('b2', 2, 'front'), board('b3', 3, 'back')]),
      shelf('c', 3, 't-shelter', [board('b4', 4, 'front', 1500, 2000)]),
      shelf('d', 4, 't-totem', [board('b5', 5, 'A', 600, 1500), board('b6', 6, 'B', 600, 1500)]),
      shelf('e', 5, 't-wall', [board('b7', 7, 'front')]),
      shelf('f', 6, 't-epost', [board('b8', 8, 'front')]),
    ])
    render(<Elevation draft={v} pool={[]} types={TYPES} />)
    const [single, double, shelter, totem, wall, epost] = screen.getAllByTestId('sign-shelf')
    expect(single).toHaveAttribute('data-form', 'singlePost')
    expect(parts(single)).toEqual(new Set(['ground', 'post']))
    expect(faces(double)).toEqual(['front', 'back'])
    expect(within(double).getByText('正面')).toBeInTheDocument()
    expect(within(double).getByText('背面')).toBeInTheDocument()
    expect(double.querySelectorAll('[data-part=post]')).toHaveLength(4)
    expect(parts(shelter)).toEqual(new Set(['ground', 'canopy', 'backPanel', 'post']))
    expect(within(shelter).queryByText('亭内')).toBeNull()
    expect(faces(totem)).toEqual(['A', 'B', 'C'])
    expect(within(totem).getByText('C面')).toBeInTheDocument()
    expect(parts(totem)).toEqual(new Set(['ground', 'base', 'column', 'cap']))
    expect(parts(wall)).toEqual(new Set(['ground', 'wall']))
    expect(parts(epost)).toEqual(new Set(['ground', 'base', 'box', 'screen']))
    // 改名不影响画法：类型名叫"候车亭"的双立柱仍画双立柱
    const renamed = TYPES.map((t) => (t.id === 't-double' ? { ...t, name: '候车亭（其实是双立柱）' } : t))
    const { container } = render(<Elevation draft={view([shelf('x', 1, 't-double', [])])} pool={[]} types={renamed} />)
    expect(parts(container.querySelector('[data-testid=sign-shelf]')!)).toEqual(new Set(['ground', 'post']))
  })

  it('不属于类型的面归入"其他面"；牌面下方过高时画折断号；类型未读到时画占位', () => {
    const v = view([shelf('a', 1, 't-totem', [board('b1', 1, 'A', 600, 1500), board('b2', 2, 'front')])])
    const { unmount } = render(<Elevation draft={v} pool={[]} types={TYPES} />)
    const sh = screen.getByTestId('sign-shelf')
    expect(faces(sh)).toEqual(['A', 'B', 'C', 'other'])
    expect(within(sh).getByText('其他面')).toBeInTheDocument()
    unmount()
    const high = TYPES.map((t) => (t.id === 't-single' ? { ...t, params: { ...t.params, mountBottom: 2200 } } : t))
    const { container, unmount: u2 } = render(
      <Elevation draft={view([shelf('a', 1, 't-single', [board('b1', 1, 'front')])])} pool={[]} types={high} />,
    )
    expect(container.querySelector('[data-part=break]')).not.toBeNull()
    u2()
    render(<Elevation draft={v} pool={[]} types={undefined} />)
    expect(screen.getByTestId('elevation-loading')).toBeInTheDocument()
  })
})

describe('属性卡（M7 T3）', () => {
  it('站牌的面只列出类型有的面；当前值不在其中时也列出并标"不属于此类型"；改类型后提示其他面', async () => {
    const user = userEvent.setup()
    renderEditor(view([shelf('a', 1, 't-totem', [board('b1', 1, 'A', 600, 1500), board('b2', 2, 'front')])]))
    await screen.findByRole('heading', { name: /金融中心/ })
    await user.click(screen.getByLabelText(/^一号牌，/))
    const face = screen.getByRole('combobox', { name: '面' })
    expect(
      within(face)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['A面', 'B面', 'C面'])
    await user.click(screen.getByLabelText(/^二号牌，/))
    const stray = screen.getByRole('combobox', { name: '面' })
    expect(
      within(stray)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['A面', 'B面', 'C面', '正面（不属于此类型）'])
    expect(screen.getByText(/正面不属于站架类型「三面图腾柱」/)).toBeInTheDocument()
    // 选站架，改类型为单立柱：A 面的站牌落到其他面
    await user.click(screen.getByRole('button', { name: /^一号架/ }))
    await user.click(screen.getByRole('button', { name: '站架类型' }))
    await user.click(await screen.findByRole('option', { name: /单立柱站架/ }))
    expect(await screen.findByText(/1 块站牌的面不属于「单立柱站架」/)).toBeInTheDocument()
    expect(faces(screen.getByTestId('sign-shelf'))).toEqual(['front', 'other'])
  })

  it('每个面各有"加站牌"，加的站牌在这一面', async () => {
    const user = userEvent.setup()
    renderEditor(view([shelf('a', 1, 't-totem', [])]))
    await screen.findByRole('heading', { name: /金融中心/ })
    await user.click(screen.getByRole('button', { name: '给一号架的B面加站牌' }))
    expect(screen.getByRole('combobox', { name: '面' })).toHaveValue('B')
  })
})

describe('3D 预览（M7 T5）', () => {
  it('three 只在 src/three 里，且只通过 lazy(() => import()) 引用（首包里没有 three）', () => {
    const root = path.resolve(__dirname, '..')
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true }))
        if (e.isDirectory()) walk(path.join(d, e.name))
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(path.join(d, e.name))
    }
    walk(root)
    const outside = files.filter((f) => !f.includes(`${path.sep}three${path.sep}`))
    for (const f of outside) {
      const src = fs.readFileSync(f, 'utf8')
      expect([f, /from ['"](three|@react-three\/[\w-]+)(\/[^'"]*)?['"]/.test(src)]).toEqual([f, false])
      for (const m of src.matchAll(/['"]@\/three\/[^'"]+['"]/g)) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index))
        expect([f, line.includes('lazy(() => import(')]).toEqual([f, true])
      }
    }
  })

  it('没有 WebGL 时提示并可回到立面；切换记在本浏览器；托盘不能拖并提示切回立面', async () => {
    const user = userEvent.setup()
    renderEditor(view([shelf('a', 1, 't-double', [board('b1', 1, 'front')])]))
    await screen.findByRole('heading', { name: /金融中心/ })
    await user.click(screen.getByRole('radio', { name: '3D' }))
    expect(await screen.findByText('当前浏览器无法显示 3D')).toBeInTheDocument()
    expect(localStorage.getItem('gt-elev-mode')).toContain('3d')
    expect(screen.getByText('3D 只能看，不能拖线路')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切回立面编排' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /回到立面/ }))
    await waitFor(() => expect(screen.getAllByTestId('sign-shelf')).toHaveLength(1))
    expect(localStorage.getItem('gt-elev-mode')).toContain('elevation')
  })

  it('点击站牌：没拖动才选中', () => {
    const onPick = vi.fn()
    const stop = vi.fn()
    expect(pickOnClick({ delta: 1, stopPropagation: stop }, 'b1', onPick)).toBe(true)
    expect(onPick).toHaveBeenCalledWith('b1')
    expect(stop).toHaveBeenCalled()
    expect(pickOnClick({ delta: 30, stopPropagation: stop }, 'b2', onPick)).toBe(false)
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})

describe('基础数据 · 站架类型（M7 T4）', () => {
  function mountTab(types = TYPES) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(keys.shelfTypes, types)
    qc.setQueryData(templatesKey, [])
    render(
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <ShelfTypesTab />
        </ToastProvider>
      </QueryClientProvider>,
    )
    return qc
  }

  it('按形式分组的卡片；"待核对"提示；被引用时删除不可用', () => {
    mountTab()
    expect(screen.getAllByTestId('shelf-type-card')).toHaveLength(6)
    expect(screen.getByTestId('review-banner')).toHaveTextContent('有 1 个站架类型由字典迁移而来')
    expect(within(screen.getByRole('article', { name: '电子站牌立杆' })).getByText('待核对')).toBeInTheDocument()
    const double = screen.getByRole('article', { name: '双立柱站架' })
    expect(within(double).getByText('3 个站架 · 1 个模板')).toBeInTheDocument()
    expect(within(double).getByRole('button', { name: '删除 双立柱站架' })).toBeDisabled()
    expect(
      within(screen.getByRole('article', { name: '挂墙站牌' })).getByRole('button', { name: '删除 挂墙站牌' }),
    ).toBeEnabled()
  })

  it('从预设库新建：参数复制过来，名称重复时加序号；保存提交形式与参数', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ ...TYPES[3], id: 'new' })
        : Response.json(String(url) === '/api/shelf-types' ? TYPES : []),
    )
    mountTab()
    await user.click(screen.getByRole('button', { name: /新建站架类型/ }))
    await user.click(screen.getByRole('listitem', { name: '预设：三面图腾柱' }))
    expect(screen.getByDisplayValue('三面图腾柱 2')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /多面柱/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('shelf-preview-2d')).toHaveAccessibleName('A面、B面、C面立面预览')
    expect(screen.getAllByTestId('reference-line')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(url).toBe('/api/shelf-types')
    expect(JSON.parse(init.body)).toMatchObject({ name: '三面图腾柱 2', form: 'totem', params: { faces: 3 } })
  })

  it('切换形式先确认，保留通用参数，其余换默认值', async () => {
    const user = userEvent.setup()
    mountTab()
    await user.click(screen.getByRole('article', { name: '挂墙站牌' }))
    const mb = screen.getByRole('textbox', { name: '牌面下沿离地' })
    await user.clear(mb)
    await user.type(mb, '1300')
    await user.click(screen.getByRole('radio', { name: /候车亭/ }))
    const dlg = await screen.findByRole('dialog', { name: '改为候车亭？' })
    await user.click(within(dlg).getByRole('button', { name: '改形式' }))
    expect(screen.getByRole('textbox', { name: '牌面下沿离地' })).toHaveValue('1300')
    expect(screen.getByRole('textbox', { name: '顶棚下沿高' })).toHaveValue('2500')
    expect(screen.queryByRole('textbox', { name: '杆径' })).toBeNull()
  })

  it('迁移来的类型打开后说明"待核对"；保存走 PATCH', async () => {
    const user = userEvent.setup()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? Response.json({ ...TYPES[5], needsReview: false })
        : Response.json(String(url) === '/api/shelf-types' ? TYPES : []),
    )
    mountTab()
    await act(async () => user.click(screen.getByRole('article', { name: '电子站牌立杆' })))
    expect(screen.getByText(/这个类型由字典迁移而来/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
    expect(fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH')![0]).toBe('/api/shelf-types/t-epost')
  })
})
