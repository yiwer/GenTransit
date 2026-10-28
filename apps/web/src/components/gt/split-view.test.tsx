import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { SplitView } from './split-view'

beforeEach(() => {
  // jsdom 没有布局：给分栏容器一个 1200px 的宽度
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 })
})

const renderSplit = () =>
  render(
    <SplitView
      storageKey="t"
      defaultWidth={440}
      left={({ width, mapOpen }) => (
        <div>
          左栏 {width} {mapOpen ? '有地图' : '无地图'}
        </div>
      )}
      map={<div>地图</div>}
    />,
  )

const leftWidth = () => Number(screen.getByTestId('split-left').style.width.replace('px', ''))

describe('SplitView', () => {
  it('拖动分隔条调宽，左栏最小 360px、最多 62%', () => {
    renderSplit()
    const sep = screen.getByRole('separator')
    expect(leftWidth()).toBe(440)

    fireEvent.pointerDown(sep, { clientX: 440 })
    fireEvent.pointerMove(window, { clientX: 600 })
    expect(leftWidth()).toBe(600)
    fireEvent.pointerMove(window, { clientX: 100 })
    expect(leftWidth()).toBe(360)
    fireEvent.pointerMove(window, { clientX: 1100 })
    expect(leftWidth()).toBe(744)
    fireEvent.pointerUp(window)
    // 宽度记在本浏览器
    expect(JSON.parse(localStorage.getItem('gt-split-t-w')!)).toBe(744)
  })

  it('键盘左右键调宽', async () => {
    const user = userEvent.setup()
    renderSplit()
    screen.getByRole('separator').focus()
    await user.keyboard('{ArrowRight}')
    expect(leftWidth()).toBe(464)
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(leftWidth()).toBe(416)
  })

  it('收起地图后左栏占满，可再展开；开关记在本浏览器', async () => {
    const user = userEvent.setup()
    renderSplit()
    expect(screen.getByText('地图')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '收起地图' }))
    expect(screen.queryByText('地图')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(leftWidth()).toBe(1200)
    expect(screen.getByText(/无地图/)).toBeInTheDocument()
    expect(localStorage.getItem('gt-split-t-map')).toBe('false')
    await user.click(screen.getByRole('button', { name: '展开地图' }))
    expect(screen.getByText('地图')).toBeInTheDocument()
    expect(leftWidth()).toBe(440)
  })

  it('记住的宽度在下次打开时恢复', () => {
    localStorage.setItem('gt-split-t-w', '520')
    renderSplit()
    expect(leftWidth()).toBe(520)
  })
})
