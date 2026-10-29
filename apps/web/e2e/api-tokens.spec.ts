import { expect, test } from '@playwright/test'
import { createStop, login } from './helpers'

// AC-17：在设置里新建 Token → 用它带 updatedSince 调用站点列表，只返回之后有变化的站点 → 吊销后 401
test('设置 → API Token：新建、调用只读 API、吊销', async ({ page, request }) => {
  await login(page)
  const old = await createStop(page, `旧站${Date.now()}`, '东')
  await page.waitForTimeout(30)
  const since = new Date().toISOString()
  await page.waitForTimeout(30)
  const fresh = await createStop(page, `新站${Date.now()}`, '西')

  await page.goto('/settings/api-tokens')
  const name = `数据中台${Date.now()}`
  await page.getByRole('button', { name: '新建 Token' }).click()
  await page.getByPlaceholder(/数据中台/).fill(name)
  await page.getByRole('button', { name: '生成' }).click()
  const plain = page.getByTestId('token-plain')
  await expect(plain).toBeVisible()
  const token = (await plain.textContent())!.trim()
  expect(token).toMatch(/^gt_[A-Za-z0-9_-]{43}$/)
  // Esc 先询问，不直接关闭
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alert')).toContainText('还没确认复制')
  await page.getByRole('button', { name: '继续查看' }).click()
  await page.getByRole('button', { name: '我已复制' }).click()
  await expect(plain).toBeHidden()
  const card = page.getByRole('listitem').filter({ hasText: name })
  await expect(card).toContainText(token.slice(0, 10))
  await expect(card).toContainText('从未使用')
  await expect(page.getByText(token)).toHaveCount(0)

  // 只读 API：只返回 since 之后有变化的站点；不带 Token、带 Cookie 都不行
  const auth = { Authorization: `Bearer ${token}` }
  const res = await request.get(`/api/v1/stops?updatedSince=${encodeURIComponent(since)}`, { headers: auth })
  expect(res.status()).toBe(200)
  const ids = ((await res.json()) as { items: { id: string }[] }).items.map((s) => s.id)
  expect(ids).toContain(fresh.id)
  expect(ids).not.toContain(old.id)
  expect((await page.request.get('/api/v1/stops')).status()).toBe(401)

  await page.reload()
  await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText('最后使用 刚刚')

  // 吊销
  await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: '吊销' }).click()
  await expect(page.getByRole('dialog')).toContainText('使用它的系统会立即无法调用')
  await page.getByRole('dialog').getByRole('button', { name: '吊销' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0)
  const after = await request.get('/api/v1/stops', { headers: auth })
  expect(after.status()).toBe(401)
  expect(await after.json()).toEqual({ code: 'UNAUTHORIZED', message: 'API Token 无效或已吊销' })

  // 文档页不需要 Token，能打开
  await page.goto('/api/v1/docs')
  await expect(page.locator('.swagger-ui .info .title')).toContainText('GenTransit 只读 API')
})
