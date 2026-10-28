import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changeMode, blankLineDraft, type StopRow } from './draft'
import { PasteDialog, parsePairs } from './route-tools'
import { StopTable } from './stop-table'
import { TimesEditor } from './times-editor'

const stop = (id: string, name: string, direction = '东') => ({ id, name, direction, lng: 120.2, lat: 30.25 })
const row = (key: string, s: ReturnType<typeof stop>, times: string[] = []): StopRow => ({
  key,
  stop: s,
  times,
  ext: {},
})

function Table({ initial, spy }: { initial: StopRow[]; spy?: (rows: StopRow[]) => void }) {
  const [rows, setRows] = useState(initial)
  const [sel, setSel] = useState<string | null>(null)
  return (
    <StopTable
      rows={rows}
      selected={sel}
      onSelect={setSel}
      onChange={(r) => {
        setRows(r)
        spy?.(r)
      }}
    />
  )
}

const names = () => screen.getAllByTestId('stop-row').map((li) => li.getAttribute('aria-label'))

describe('站序表', () => {
  const a = stop('a', '人民广场')
  const b = stop('b', '火车站', '场站')
  const c = stop('c', '北门', '南')

  it('第 2 次起标出第几次途经', () => {
    render(<Table initial={[row('1', a), row('2', b), row('3', a)]} />)
    const rows = screen.getAllByTestId('stop-row')
    expect(within(rows[0]).queryByText(/第 \d 次/)).toBeNull()
    expect(within(rows[2]).getByText('第 2 次')).toBeInTheDocument()
  })

  it('键盘替代拖拽：Alt + ↓ / ↑ 移动选中行', async () => {
    const user = userEvent.setup()
    render(<Table initial={[row('1', a), row('2', b), row('3', c)]} />)
    const first = screen.getAllByTestId('stop-row')[0]
    first.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(names()).toEqual(['第 1 站 火车站（场站）', '第 2 站 人民广场（东）', '第 3 站 北门（南）'])
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(names()).toEqual(['第 1 站 火车站（场站）', '第 2 站 北门（南）', '第 3 站 人民广场（东）'])
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
    expect(names()[1]).toBe('第 2 站 人民广场（东）')
  })

  it('行内删除', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Table initial={[row('1', a), row('2', b)]} spy={spy} />)
    await user.click(screen.getByRole('button', { name: '删除第 1 站 人民广场' }))
    expect(names()).toEqual(['第 1 站 火车站（场站）'])
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('改模式', () => {
  it('按位置改名；多出的走向暂存，切回时恢复', () => {
    const d = blankLineDraft('twoway')
    d.routes[1].stops = [row('x', stop('a', '甲')), row('y', stop('b', '乙'))]
    const one = changeMode(d, 'oneway')
    expect(one.routes.map((r) => r.kind)).toEqual(['oneway'])
    expect(one.stash).toHaveLength(1)
    const back = changeMode(one, 'twoway')
    expect(back.routes.map((r) => [r.kind, r.stops.length])).toEqual([
      ['up', 0],
      ['down', 2],
    ])
  })
})

describe('粘贴两列文本', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('解析：制表符或最后一段空白分隔', () => {
    expect(parsePairs('人民广场\t东\n解放 路口 南\n\n火车站')).toEqual([
      { name: '人民广场', direction: '东' },
      { name: '解放 路口', direction: '南' },
      { name: '火车站', direction: '' },
    ])
  })

  it('匹配到的预览后追加，匹配不到的标红不追加', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { index: 0, name: '人民广场', direction: '东', stop: stop('a', '人民广场') },
            { index: 1, name: '不存在', direction: '西', stop: null },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onAppend = vi.fn()
    render(<PasteDialog open onOpenChange={() => {}} onAppend={onAppend} />)
    await user.type(screen.getByLabelText('站名与方位'), '人民广场 东{enter}不存在 西')
    await user.click(screen.getByRole('button', { name: '匹配站点' }))
    const result = await screen.findByRole('list', { name: '匹配结果' })
    expect(within(result).getAllByRole('listitem')).toHaveLength(2)
    expect(within(result).getByText('没有这个站点')).toBeInTheDocument()
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      rows: [
        { name: '人民广场', direction: '东' },
        { name: '不存在', direction: '西' },
      ],
    })
    await user.click(screen.getByRole('button', { name: '追加 1 个站' }))
    expect(onAppend).toHaveBeenCalledWith([stop('a', '人民广场')])
  })
})

describe('到站时刻编辑器', () => {
  const rows = [row('1', stop('a', '甲')), row('2', stop('b', '乙')), row('3', stop('c', '丙'))]

  it('按间隔填充：首站各班时刻 + 统一站间用时', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<TimesEditor open onOpenChange={() => {}} title="上行 · 到站时刻" rows={rows} onSave={onSave} />)
    await user.type(screen.getByLabelText('首站各班时刻'), '06:00, 06:30')
    await user.clear(screen.getByLabelText('站间用时'))
    await user.type(screen.getByLabelText('站间用时'), '3,4')
    await user.click(screen.getByRole('button', { name: '填充' }))
    expect(screen.getByLabelText('丙 第 2 个时刻')).toHaveValue('06:37')
    await user.click(screen.getByRole('button', { name: '应用到站序' }))
    expect(onSave).toHaveBeenCalledWith([
      ['06:00', '06:30'],
      ['06:03', '06:33'],
      ['06:07', '06:37'],
    ])
  })

  it('首班、末班与发车间隔生成首站班次；格式错误或顺序不对时不能应用', async () => {
    const user = userEvent.setup()
    render(<TimesEditor open onOpenChange={() => {}} title="t" rows={rows.slice(0, 2)} onSave={() => {}} />)
    await user.type(screen.getByLabelText('首班'), '06:00')
    await user.type(screen.getByLabelText('末班'), '07:00')
    await user.type(screen.getByLabelText('发车间隔分钟'), '30')
    await user.click(screen.getByRole('button', { name: '填充' }))
    expect(screen.getByLabelText('乙 第 3 个时刻')).toHaveValue('07:03')
    // 与前一班重复：不算按先后排列（跨午夜一次是允许的，所以用重复时刻）
    fireEvent.change(screen.getByLabelText('甲 第 2 个时刻'), { target: { value: '06:00' } })
    expect(screen.getByText('没有按先后排列')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '应用到站序' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('甲 第 2 个时刻'), { target: { value: '6点' } })
    await waitFor(() => expect(screen.getByText('格式应为 HH:mm')).toBeInTheDocument())
  })
})
