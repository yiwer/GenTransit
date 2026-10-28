import type { ImportPreview } from '@gentransit/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ImportPreviewView } from './ImportDrawer'

const stopPreview: ImportPreview = {
  kind: 'stop',
  rows: 5,
  created: [{ key: '火车站（场站）', name: '火车站（场站）' }],
  updated: [
    {
      key: '人民广场（东）',
      name: '人民广场（东）',
      diff: [{ kind: 'value', label: '座椅数', from: '2', to: '6' }],
    },
  ],
  unchanged: 2,
  failures: [
    { sheet: '站点', rows: [5], key: '甲站（东北）', reasons: ['方位「东北」不是东、南、西、北、无、场站之一'] },
  ],
  newRefs: [{ category: '路段', name: '解放路' }],
  removedRoutes: [],
}

describe('导入预览', () => {
  it('顶部计数；页签：新增、修改（展开看改动字段）、失败、将新建的字典项', async () => {
    const user = userEvent.setup()
    render(<ImportPreviewView preview={stopPreview} />)
    expect(screen.getByTestId('import-summary')).toHaveTextContent('共 5 行：新增 1，修改 1，无变化 2，失败 1')
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['新增1', '修改1', '失败1', '将新建的字典项1'])
    expect(screen.getByRole('tab', { name: /新增/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('火车站（场站）')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /修改/ }))
    await user.click(screen.getByRole('button', { name: /人民广场（东）/ }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('2')).toHaveClass('line-through')
    expect(within(panel).getByText('6')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /失败/ }))
    expect(screen.getByText('方位「东北」不是东、南、西、北、无、场站之一')).toBeInTheDocument()
    expect(screen.getByText('站点 第 5 行')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /将新建/ }))
    expect(screen.getByText('解放路')).toBeInTheDocument()
  })

  it('线路导入：失败里列出未匹配站点，另有"将删除的走向"页签', async () => {
    const user = userEvent.setup()
    render(
      <ImportPreviewView
        preview={{
          kind: 'line',
          rows: 6,
          created: [],
          updated: [],
          unchanged: 0,
          failures: [
            {
              sheet: '线路',
              rows: [3, 4],
              key: 'G-2',
              reasons: ['有 1 个站点匹配不上'],
              unmatchedStops: ['不存在的站（北）'],
            },
          ],
          newRefs: [],
          removedRoutes: [{ key: 'K-1', name: 'K1路', routes: ['下行'] }],
        }}
      />,
    )
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['新增0', '修改0', '失败1', '将删除的走向1'])
    // 默认打开第一个有内容的页签
    expect(screen.getByRole('tab', { name: /失败/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('不存在的站（北）')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /将删除的走向/ }))
    expect(screen.getByText('删除走向 下行')).toBeInTheDocument()
  })
})
