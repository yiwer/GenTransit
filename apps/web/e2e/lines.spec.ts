import { expect, test } from '@playwright/test'
import { createStop, login } from './helpers'

test('新建双边线路（粘贴站序、反向生成下行、填到站时刻）→ 条形图单击定位、双击进站点 → 停运再恢复 → 修改历史', async ({
  page,
}) => {
  await login(page)
  for (const [i, name] of ['东一站', '东二站', '东三站'].entries())
    await createStop(page, name, '东', 120.2 + i * 0.004, 30.25)

  await page.goto('/lines/new')
  await page.getByLabel('线路名').fill('E1路')
  await page.getByLabel('管理编号').fill('E-0001')
  await expect(page.getByRole('radio', { name: '双边' })).toHaveAttribute('aria-checked', 'true')

  // 上行：粘贴两列文本
  await page.getByRole('button', { name: '粘贴两列' }).click()
  await page.getByLabel('站名与方位').fill('东一站\t东\n东二站\t东\n东三站\t东')
  await page.getByRole('button', { name: '匹配站点' }).click()
  await page.getByRole('button', { name: '追加 3 个站' }).click()
  await expect(page.getByTestId('stop-row')).toHaveCount(3)

  // 下行：反向生成
  await page.getByRole('tab', { name: /下行/ }).click()
  await page.getByRole('button', { name: '反向生成' }).click()
  await expect(page.getByTestId('stop-row').first()).toHaveAccessibleName('第 1 站 东三站（东）')

  // 上行：按间隔填到站时刻
  await page.getByRole('tab', { name: /上行/ }).click()
  await page.getByRole('button', { name: '到站时刻' }).click()
  await page.getByLabel('首站各班时刻').fill('06:00, 06:30')
  await page.getByLabel('站间用时').fill('4')
  await page.getByRole('button', { name: '填充' }).click()
  await expect(page.getByLabel('东三站 第 2 个时刻')).toHaveValue('06:38')
  await page.getByRole('button', { name: '应用到站序' }).click()
  await expect(page.getByTestId('stop-row').nth(2)).toContainText('06:08 … 06:38 · 2 班')

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page).toHaveURL(/\/lines\/[0-9a-f-]{36}$/)
  await expect(page.getByText('已新建线路')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('东一站 — 东三站')
  const lineUrl = page.url()

  // 条形图：单击定位并浮出卡片，双击进入站点详情
  const second = page.getByRole('button', { name: '第 2 站 东二站（东）' })
  await second.click()
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('↑ 上行 · 第 2 站')).toBeVisible()
  await second.dblclick()
  await expect(page).toHaveURL(/\/stops\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('东二站')
  await expect(page.getByRole('link', { name: /E1路/ }).first()).toBeVisible()
  await page.goto(lineUrl)

  // 停运再恢复
  await page.getByRole('button', { name: '停运' }).click()
  await page.getByRole('button', { name: '确认停运' }).click()
  await expect(page.getByText('停运中：这条线路的走向视为不经过任何站点')).toBeVisible()
  await page.getByRole('button', { name: '恢复运营' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '恢复运营' }).click()
  await expect(page.getByText('停运中')).toBeHidden()

  // 修改历史：新增、停运、恢复运营
  await page.getByRole('button', { name: /修改历史/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('共 3 份修改快照')
  await expect(dialog.getByText('恢复运营', { exact: true })).toBeVisible()
  await expect(dialog.getByText('停运', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新增', { exact: true })).toBeVisible()
})
