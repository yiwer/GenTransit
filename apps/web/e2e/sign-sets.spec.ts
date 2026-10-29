import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createStop, login } from './helpers'

const H = { 'X-GT-Request': '1' }

async function api<T>(page: Page, method: 'get' | 'post' | 'put', url: string, data?: unknown): Promise<T> {
  const res = await page.request[method](url, { headers: H, data })
  expect(res.ok(), `${method} ${url} → ${res.status()}`).toBe(true)
  return (await res.json()) as T
}

type Line = { id: string; rev: number; routes: { id: string; kind: string }[] }
const twoway = (name: string, number: string, up: string[], down: string[]) => ({
  name,
  number,
  mode: 'twoway',
  routes: [
    { kind: 'up', stops: up.map((stopId) => ({ stopId })) },
    { kind: 'down', stops: down.map((stopId) => ({ stopId })) },
  ],
})

/** dnd-kit 的指针传感器要先移动几像素才开始拖动 */
async function drag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 - 8, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 })
  await page.mouse.up()
  // 松手后 dnd-kit 会在约 50 毫秒内拦下点击（避免误触被拖的元素），紧接着的点击要稍等
  await page.waitForTimeout(120)
}

/** 站架类型：同一个测试库里各用例共用，已有就沿用 */
async function shelfType(page: Page, name: string) {
  const all = await api<{ id: string; category: string; name: string }[]>(page, 'get', '/api/dicts?category=shelfType')
  return (
    all.find((d) => d.name === name) ??
    (await api<{ id: string }>(page, 'post', '/api/dicts', { category: 'shelfType', name }))
  )
}

const board = (page: Page, label: string) => page.locator(`[data-testid="sign-board"][aria-label^="${label}，"]`)

test('上行加入站点 → 工作台待处理数加一 → 编辑器拖到一号牌保存（印章）→ 原样保存没有变化 → 停运显示失效 → 恢复回到已编排', async ({
  page,
}) => {
  await login(page)
  const x = await createStop(page, '编排甲站', '东')
  const y = await createStop(page, '编排乙站', '东', 120.21, 30.25)
  const z = await createStop(page, '编排丙站', '东', 120.22, 30.25)
  await shelfType(page, '双立柱站架')
  const l = (await api<{ item: Line }>(page, 'post', '/api/lines', twoway('P1路', 'P-1', [y.id, z.id], [z.id, y.id])))
    .item

  await page.goto('/home')
  const count = page.getByTestId('home-pending-count')
  await expect(count).toHaveText(/\d+/)
  const before = Number(await count.textContent())

  // AC-02：上行站序加入 X 并保存
  const full = await api<Line & Record<string, unknown>>(page, 'get', `/api/lines/${l.id}`)
  await api(page, 'put', `/api/lines/${l.id}`, {
    ...twoway('P1路', 'P-1', [x.id, y.id, z.id], [z.id, y.id]),
    rev: full.rev,
  })
  await page.reload()
  await expect(count).toHaveText(String(before + 1))
  await page.goto(`/sign-sets/${x.id}`)
  await expect(page.getByTestId('tray-waiting')).toHaveCount(1)

  // 空白站架 → 加一块站牌
  await page.getByRole('button', { name: '空白站架' }).click()
  await page
    .getByRole('region', { name: '属性' })
    .getByRole('button', { name: /加站牌/ })
    .click()
  await page.getByRole('button', { name: '关闭属性' }).click()

  // AC-03：拖到一号牌并保存
  await drag(page, page.getByTestId('tray-waiting').first(), board(page, '一号牌'))
  await expect(board(page, '一号牌').getByTestId('sign-row')).toHaveCount(1)
  await expect(page.getByTestId('tray-all-done')).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存站牌集，生成一份修改快照')).toBeVisible()
  await expect(page.getByTestId('history-count')).toHaveText('2')

  // AC-04：原样保存
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('内容没有变化，没有生成修改快照')).toBeVisible()
  await expect(page.getByTestId('history-count')).toHaveText('2')

  // AC-05：停运后编排失效，不出现在待编排，站牌集不生成快照
  await api(page, 'post', `/api/lines/${l.id}/suspend`, { rev: full.rev + 1 })
  await page.reload()
  const row = board(page, '一号牌').getByTestId('sign-row')
  await expect(row).toContainText('失效')
  await expect(page.getByTestId('tray-waiting')).toHaveCount(0)
  await expect(page.getByTestId('history-count')).toHaveText('2')

  // AC-06：恢复后回到已编排
  await api(page, 'post', `/api/lines/${l.id}/resume`, { rev: full.rev + 2 })
  await page.reload()
  await expect(row).toContainText('编排丙站')
  await expect(row).not.toContainText('失效')
})

test('双边改单向：确认弹窗写明下行编排数，保存后站牌集出现"连带修改"', async ({ page }) => {
  await login(page)
  const x = await createStop(page, '改向甲站', '东')
  const y = await createStop(page, '改向乙站', '东', 120.21, 30.25)
  const type = await shelfType(page, '单立柱站架')
  const l = (await api<{ item: Line }>(page, 'post', '/api/lines', twoway('Q1路', 'Q-1', [x.id, y.id], [y.id, x.id])))
    .item
  // 准备数据：X 的一号牌上放下行
  const ss = await api<{ id: string; rev: number }>(page, 'get', `/api/stops/${x.id}/sign-set`)
  const boardId = randomUUID()
  await api(page, 'put', `/api/sign-sets/${ss.id}`, {
    rev: ss.rev,
    reminder: '',
    shelves: [
      {
        id: randomUUID(),
        no: 1,
        typeId: type.id,
        boards: [{ id: boardId, no: 1, face: 'front', kind: 'whole', width: 600, height: 1200 }],
      },
    ],
    schedules: [
      { routeId: l.routes.find((r) => r.kind === 'down')!.id, pass: 1, placement: 'board', boardId, order: 1 },
    ],
  })

  await page.goto(`/lines/${l.id}/edit`)
  await page.getByRole('radio', { name: '单向' }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('改模式会删除走向')
  await expect(dialog.getByTestId('impact-note')).toHaveText(
    '下行在 1 个站牌集里的 1 条编排将被删除，受影响的站牌集各存一份"连带修改"快照。',
  )
  await dialog.getByRole('button', { name: '删除走向并保存' }).click()
  await expect(page).toHaveURL(new RegExp(`/lines/${l.id}$`))

  await page.goto(`/sign-sets/${x.id}`)
  await expect(board(page, '一号牌').getByTestId('sign-row')).toHaveCount(0)
  await page.getByRole('button', { name: /修改历史/ }).click()
  const history = page.getByRole('dialog')
  await expect(history.getByText('连带修改', { exact: true })).toBeVisible()
  await expect(history).toContainText('修改线路 Q1路 的模式，删除走向 下行，连带移除编排')
})

test('环线两次途经分别编排；站牌集列表"只看待处理"、预览抽屉、导出', async ({ page }) => {
  await login(page)
  const y = await createStop(page, '环线站', '北')
  const a = await createStop(page, '环线东站', '东', 120.21, 30.25)
  const b = await createStop(page, '环线西站', '西', 120.19, 30.25)
  const type = await shelfType(page, '双立柱站架')
  await api(page, 'post', '/api/shelf-templates', {
    name: '双面整版',
    typeId: type.id,
    boards: [
      { face: 'front', kind: 'whole', width: 1200, height: 1800 },
      { face: 'back', kind: 'whole', width: 1200, height: 1800 },
    ],
  })
  await api(page, 'post', '/api/lines', {
    name: '环9路',
    number: 'H-9',
    mode: 'loop',
    routes: [{ kind: 'loop', stops: [y.id, a.id, y.id, b.id].map((stopId) => ({ stopId })) }],
  })

  // AC-08：两条独立途经
  await page.goto(`/sign-sets/${y.id}`)
  const chips = page.getByTestId('tray-waiting')
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toContainText('第 1 次')
  await expect(chips.nth(1)).toContainText('第 2 次')
  await page.getByRole('button', { name: '从模板添加站架' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /双面整版/ })
    .click()
  await page.getByRole('button', { name: '添加 1 个站架' }).click()
  await expect(page.getByTestId('sign-board')).toHaveCount(2)
  // 不用拖拽："放到…"菜单
  await page.getByRole('button', { name: '环9路 环线（第 1 次） 的操作' }).click()
  await page.getByRole('menuitem', { name: /一号牌 · 整版/ }).click()
  await drag(page, page.getByTestId('tray-waiting').first(), board(page, '二号牌'))
  await expect(board(page, '一号牌')).toContainText('第1次')
  await expect(board(page, '二号牌')).toContainText('第2次')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存站牌集，生成一份修改快照')).toBeVisible()

  // 列表：只看待处理
  await page.goto('/sign-sets')
  await expect(page.getByRole('listitem', { name: '环线站（北）' })).toBeVisible()
  await page.getByRole('button', { name: '只看待处理' }).click()
  await expect(page).toHaveURL(/pending=1/)
  await expect(page.getByRole('listitem', { name: '环线站（北）' })).toHaveCount(0)
  await expect(page.getByRole('listitem', { name: '环线东站（东）' })).toBeVisible()

  // 预览抽屉
  await page.getByRole('button', { name: '只看待处理' }).click()
  await page.getByRole('listitem', { name: '环线站（北）' }).getByTitle('预览站牌集').click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('站牌集')
  await expect(drawer.getByTestId('sign-board')).toHaveCount(2)
  await expect(drawer.getByRole('link', { name: /编排/ })).toHaveAttribute('href', `/sign-sets/${y.id}`)
  await page.keyboard.press('Escape')

  // 导出当前结果
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出当前结果' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^站牌集_\d{4}-\d{2}-\d{2}\.xlsx$/)
})
