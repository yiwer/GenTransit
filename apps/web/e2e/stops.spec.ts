import { expect, test, type Page } from '@playwright/test'
import { E2E_ADMIN } from './env'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(E2E_ADMIN.username)
  await page.getByLabel('密码').fill(E2E_ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/stops$/)
}

test('登录 → 地图点选新建站点 → 详情 → 修改历史里有"新增"；原样保存不产生快照', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '新建' }).click()
  await expect(page).toHaveURL(/\/stops\/new$/)

  await page.getByLabel('站名').fill('端到端测试站')
  await page.getByRole('radio', { name: '北' }).click()
  // 示意平面：点一下地图放置站点
  const map = page.getByTestId('plane-map')
  await expect(map).toBeVisible()
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByLabel('经度')).not.toHaveValue('')
  await expect(page.getByTestId('map-marker')).toBeVisible()
  await expect(page.getByTestId('unsaved')).toContainText('未保存')

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/stops\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('端到端测试站')
  await expect(page.getByText('已新建站点，并为它创建了空站牌集')).toBeVisible()

  await page.getByRole('button', { name: /修改历史/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('站点 · 修改历史')
  await expect(dialog).toContainText('端到端测试站（北）')
  await expect(dialog.getByText('新增', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('共 1 份修改快照')
  await page.keyboard.press('Escape')

  // 不做改动再保存：没有变化，不生成快照
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.getByTestId('unsaved')).toHaveText('没有修改')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('内容没有变化，没有生成修改快照')).toBeVisible()
  await expect(page.getByTestId('history-count')).toHaveText('1')
})

test('AC-10：两个标签页先后保存同一站点，后者看到冲突提示，不覆盖前者', async ({ page, context }) => {
  await login(page)
  const created = await page.request.post('/api/stops', {
    headers: { 'X-GT-Request': '1' },
    data: { name: '冲突测试站', direction: '东', lng: 120.2, lat: 30.25 },
  })
  expect(created.ok()).toBe(true)
  const { item } = (await created.json()) as { item: { id: string } }

  const a = page
  const b = await context.newPage()
  await a.goto(`/stops/${item.id}/edit`)
  await b.goto(`/stops/${item.id}/edit`)
  await expect(a.getByLabel('备注')).toBeVisible()
  await expect(b.getByLabel('备注')).toBeVisible()

  await a.getByLabel('备注').fill('标签页 A 的修改')
  await a.getByRole('button', { name: '保存', exact: true }).click()
  await expect(a).toHaveURL(new RegExp(`/stops/${item.id}$`))
  await expect(a.getByText(/已保存，生成修改快照/)).toBeVisible()

  await b.getByLabel('备注').fill('标签页 B 的修改')
  await b.getByRole('button', { name: '保存', exact: true }).click()
  const conflict = b.getByRole('dialog', { name: '已在别处修改' })
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('别处保存的最新内容')
  await expect(conflict).toContainText('标签页 A 的修改')
  await expect(conflict).toContainText('标签页 B 的修改')
  // 没有覆盖前者
  const now = await (await b.request.get(`/api/stops/${item.id}`)).json()
  expect(now.remark).toBe('标签页 A 的修改')

  await conflict.getByRole('button', { name: '以最新内容重新编辑' }).click()
  await expect(b.getByLabel('备注')).toHaveValue('标签页 A 的修改')
  await expect(b.getByTestId('unsaved')).toHaveText('没有修改')
})
