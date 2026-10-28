import { expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './env'

export async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(E2E_ADMIN.username)
  await page.getByLabel('密码').fill(E2E_ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/stops$/)
}

/** 用当前登录会话直接调接口建站点（测试准备数据） */
export async function createStop(page: Page, name: string, direction: string, lng = 120.2, lat = 30.25) {
  const res = await page.request.post('/api/stops', {
    headers: { 'X-GT-Request': '1' },
    data: { name, direction, lng, lat },
  })
  expect(res.ok()).toBe(true)
  return ((await res.json()) as { item: { id: string } }).item
}
