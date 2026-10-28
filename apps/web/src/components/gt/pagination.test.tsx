import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Pagination, pageList, usePageParams } from './pagination'

function Harness({ total }: { total: number }) {
  const p = usePageParams()
  const loc = useLocation()
  return (
    <>
      <Pagination page={p.page} size={p.size} total={total} onPage={p.setPage} onSize={p.setSize} unit="个" />
      <output data-testid="search">{loc.search}</output>
    </>
  )
}

const renderAt = (url: string, total: number) => {
  const router = createMemoryRouter([{ path: '/stops', element: <Harness total={total} /> }], { initialEntries: [url] })
  render(<RouterProvider router={router} />)
}

describe('pageList', () => {
  it('首末页、当前页前后各一页，其余省略', () => {
    expect(pageList(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageList(6, 12)).toEqual([1, '…', 5, 6, 7, '…', 12])
    expect(pageList(1, 12)).toEqual([1, 2, '…', 12])
  })
})

describe('Pagination', () => {
  it('显示范围与总数，当前页高亮', () => {
    renderAt('/stops?page=2', 45)
    expect(screen.getByText(/共 45 个/)).toBeInTheDocument()
    expect(screen.getByText('21–40')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page')
  })

  it('翻页写进 URL，第 1 页不写 page', async () => {
    const user = userEvent.setup()
    renderAt('/stops?q=人民', 45)
    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByTestId('search').textContent).toContain('page=2')
    expect(screen.getByTestId('search').textContent).toContain('q=')
    await user.click(screen.getByRole('button', { name: '上一页' }))
    expect(screen.getByTestId('search').textContent).not.toContain('page=')
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  })

  it('改每页条数回到第 1 页并写进 URL', async () => {
    const user = userEvent.setup()
    renderAt('/stops?page=3', 120)
    await user.selectOptions(screen.getByLabelText('每页条数'), '50')
    const s = screen.getByTestId('search').textContent
    expect(s).toContain('size=50')
    expect(s).not.toContain('page=')
    expect(screen.getByText('1–50')).toBeInTheDocument()
  })

  it('页码超出范围时按最后一页显示', () => {
    renderAt('/stops?page=9', 30)
    expect(screen.getByText('21–30')).toBeInTheDocument()
  })
})
