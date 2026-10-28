import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { FieldError, GhostInput, GhostSelect, Prop, Val } from './prop'

function Form() {
  const [name, setName] = useState('')
  const [dir, setDir] = useState('东')
  return (
    <>
      <Prop label="站名" required>
        <GhostInput value={name} onChange={(e) => setName(e.target.value)} placeholder="如：人民广场" />
        <FieldError>{name ? '' : '必填'}</FieldError>
      </Prop>
      <Prop label="方位">
        <GhostSelect value={dir} onChange={(e) => setDir(e.target.value)}>
          {['东', '西'].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </GhostSelect>
      </Prop>
      <output data-testid="out">
        {name}|{dir}
      </output>
    </>
  )
}

describe('属性表', () => {
  it('标签与输入框关联，输入后取值更新', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const input = screen.getByLabelText(/站名/)
    expect(screen.getByRole('alert')).toHaveTextContent('必填')
    await user.type(input, '人民广场')
    expect(screen.getByTestId('out')).toHaveTextContent('人民广场|东')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('方位'), '西')
    expect(screen.getByTestId('out')).toHaveTextContent('人民广场|西')
  })

  it('必填标记与只读空值', () => {
    render(
      <Prop label="备注" required>
        <Val>{''}</Val>
      </Prop>,
    )
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
