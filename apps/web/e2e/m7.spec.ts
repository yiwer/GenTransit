// M7：站架类型预设与 2D / 3D 模型（AC-25、AC-26；AC-27 的迁移由后端迁移测试覆盖）
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createStop, login } from './helpers'

const H = { 'X-GT-Request': '1' }

async function api<T>(page: Page, method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  const res = await page.request[method](url, { headers: H, data })
  expect(res.ok(), `${method} ${url} → ${res.status()}`).toBe(true)
  return (res.status() === 204 ? null : await res.json()) as T
}

const shelves = (page: Page) => page.getByTestId('sign-shelf')
const facesOf = async (page: Page) =>
  shelves(page)
    .first()
    .getByTestId('shelf-face')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-face')))

test('AC-25：从预设库新建三面图腾柱 → 编辑器里用它添加站架，A、B、C 面各加一块站牌 → 3D 出现画布，回到立面', async ({
  page,
}) => {
  await login(page)
  const stop = await createStop(page, '图腾甲站', '东')

  await page.goto('/base-data/shelf-types')
  await page.getByRole('button', { name: '新建站架类型' }).click()
  await page.getByRole('listitem', { name: '预设：三面图腾柱' }).click()
  await page.getByRole('textbox', { name: '名称' }).fill('E2E 三面图腾柱')
  await expect(page.getByTestId('shelf-preview-2d')).toHaveAttribute('aria-label', 'A面、B面、C面立面预览')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('article', { name: 'E2E 三面图腾柱' })).toBeVisible()

  await page.goto(`/sign-sets/${stop.id}`)
  await page.getByRole('button', { name: /^站架/ }).click()
  await page.getByRole('menuitem', { name: '空白站架' }).click()
  await page.getByRole('button', { name: '站架类型' }).click()
  await page.getByRole('option', { name: /E2E 三面图腾柱/ }).click()
  await expect.poll(() => facesOf(page)).toEqual(['A', 'B', 'C'])
  await expect(shelves(page).first().locator('[data-part=column]').first()).toBeAttached()
  for (const f of ['A', 'B', 'C']) await page.getByRole('button', { name: `给一号架的${f}面加站牌` }).click()
  await expect(page.getByTestId('sign-board')).toHaveCount(3)
  // 站牌的面只能选 A、B、C
  await expect(page.getByRole('combobox', { name: '面' }).locator('option')).toHaveText(['A面', 'B面', 'C面'])
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存', { exact: false }).first()).toBeVisible()

  await page.getByRole('radio', { name: '3D' }).click()
  await expect(page.getByTestId('scene-3d').locator('canvas')).toBeVisible()
  await expect(page.getByText('3D 只能看，不能拖线路')).toBeVisible()
  await page.getByRole('button', { name: '回到立面' }).click()
  await expect(shelves(page)).toHaveCount(1)
  await expect.poll(() => facesOf(page)).toEqual(['A', 'B', 'C'])
})

test('AC-26：改双立柱的柱高，引用它的站牌集立面随之变化，不生成新快照', async ({ page }) => {
  await login(page)
  const type = await api<{ id: string }>(page, 'post', '/api/shelf-types', {
    name: 'E2E 双立柱',
    form: 'doublePost',
    params: { postHeight: 2600, sides: 1 },
  })
  const stop = await createStop(page, '柱高甲站', '东')
  const ss = await api<{ id: string; rev: number }>(page, 'get', `/api/stops/${stop.id}/sign-set`)
  await api(page, 'put', `/api/sign-sets/${ss.id}`, {
    rev: ss.rev,
    reminder: '',
    shelves: [
      {
        id: randomUUID(),
        no: 1,
        typeId: type.id,
        boards: [{ id: randomUUID(), no: 1, face: 'front', kind: 'whole', width: 1200, height: 1800 }],
      },
    ],
    schedules: [],
  })
  const snaps = async () => (await api<unknown[]>(page, 'get', `/api/snapshots?type=signSet&id=${ss.id}`)).length
  const before = await snaps()
  const postHeight = async () => {
    await page.goto(`/sign-sets/${stop.id}`)
    const post = shelves(page).first().locator('[data-part=post]').first()
    await expect(post).toBeAttached()
    return (await post.boundingBox())!.height
  }
  const h1 = await postHeight()

  await page.goto('/base-data/shelf-types')
  await page.getByRole('article', { name: 'E2E 双立柱' }).click()
  const field = page.getByRole('textbox', { name: '柱高' })
  await field.fill('3200')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已保存站架类型「E2E 双立柱」')).toBeVisible()

  const h2 = await postHeight()
  expect(h2 / h1).toBeGreaterThan(1.15)
  expect(await snaps()).toBe(before)
})

test('删除被引用的站架类型被拒绝；未引用的可以删除', async ({ page }) => {
  await login(page)
  const used = await api<{ id: string }>(page, 'post', '/api/shelf-types', { name: 'E2E 被引用', form: 'singlePost' })
  await api(page, 'post', '/api/shelf-templates', { name: '单面', typeId: used.id, boards: [] })
  await api(page, 'post', '/api/shelf-types', { name: 'E2E 没人用', form: 'ePost' })

  await page.goto('/base-data/shelf-types')
  await expect(
    page.getByRole('article', { name: 'E2E 被引用' }).getByRole('button', { name: '删除 E2E 被引用' }),
  ).toBeDisabled()
  const res = await page.request.delete(`/api/shelf-types/${used.id}`, { headers: H })
  expect(res.status()).toBe(409)
  expect((await res.json()).code).toBe('IN_USE')

  await page.getByRole('article', { name: 'E2E 没人用' }).getByRole('button', { name: '删除 E2E 没人用' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除站架类型' }).click()
  await expect(page.getByRole('article', { name: 'E2E 没人用' })).toHaveCount(0)
})
