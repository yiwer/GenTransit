// M5 流程简化的验收（需求第 9 节 AC-19 至 AC-24）
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { createStop, login } from './helpers'

const H = { 'X-GT-Request': '1' }

async function api<T>(page: Page, method: 'get' | 'post' | 'put', url: string, data?: unknown): Promise<T> {
  const res = await page.request[method](url, { headers: H, data })
  expect(res.ok(), `${method} ${url} → ${res.status()}`).toBe(true)
  return (await res.json()) as T
}

type Line = { id: string; rev: number; routes: { id: string; kind: string }[] }
const twoway = (name: string, up: string[], down: string[]) => ({
  name,
  number: name,
  mode: 'twoway',
  routes: [
    { kind: 'up', stops: up.map((stopId) => ({ stopId })) },
    { kind: 'down', stops: down.map((stopId) => ({ stopId })) },
  ],
})

/** 以 base 为原点按米偏移（x 向东、y 向北） */
const at = (base: [number, number], x: number, y: number): [number, number] => [
  Number((base[0] + x / (Math.cos((base[1] * Math.PI) / 180) * 111320)).toFixed(6)),
  Number((base[1] + y / 110540).toFixed(6)),
]

async function shelfType(page: Page) {
  const all = await api<{ id: string; name: string }[]>(page, 'get', '/api/shelf-types')
  return (
    all.find((d) => d.name === '双立柱站架') ??
    (await api<{ id: string }>(page, 'post', '/api/shelf-types', { name: '双立柱站架', form: 'doublePost' }))
  )
}

/** 给站点装一个站架、一块整版站牌 */
async function oneBoard(page: Page, stopId: string, typeId: string) {
  const ss = await api<{ id: string; rev: number }>(page, 'get', `/api/stops/${stopId}/sign-set`)
  await api(page, 'put', `/api/sign-sets/${ss.id}`, {
    rev: ss.rev,
    reminder: '',
    shelves: [
      {
        id: randomUUID(),
        no: 1,
        typeId,
        boards: [{ id: randomUUID(), no: 1, face: 'front', kind: 'whole', width: 1200, height: 1800 }],
      },
    ],
    schedules: [],
  })
}

test('AC-20：在线路中把站点替换掉，然后删除它', async ({ page }) => {
  await login(page)
  const a = await createStop(page, '替换甲站', '东', 120.31, 30.31)
  const x = await createStop(page, '替换乙站', '东', 120.312, 30.31)
  const b = await createStop(page, '替换丙站', '东', 120.314, 30.31)
  await createStop(page, '替换丁站', '东', 120.3121, 30.3101)
  await api(page, 'post', '/api/lines', twoway('R1路', [a.id, x.id, b.id], [b.id, x.id, a.id]))
  await api(page, 'post', '/api/lines', {
    name: 'R2路',
    number: 'R2路',
    mode: 'oneway',
    routes: [{ kind: 'oneway', stops: [{ stopId: x.id }, { stopId: b.id }] }],
  })

  await page.goto(`/stops/${x.id}`)
  // 先试删除：被引用，对话框里直接给"替换为其他站点"
  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('menuitem', { name: '删除站点' }).click()
  const blocked = page.getByRole('dialog')
  await expect(blocked).toContainText('这个站点还不能删除')
  await expect(blocked.getByRole('link', { name: 'R1路 上行' })).toBeVisible()
  await blocked.getByRole('button', { name: '替换为其他站点' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('引用这个站点的 3 处路径站')
  await dialog.getByLabel('添加站点').fill('替换丁')
  await expect(dialog.getByRole('option').first()).toContainText('距上一站')
  await dialog.getByLabel('添加站点').press('Enter')
  await expect(dialog.getByTestId('replace-target')).toContainText('替换丁站')
  await dialog.getByRole('button', { name: '替换 3 处' }).click()
  await expect(page.getByTestId('replace-done')).toBeVisible()
  await page.getByRole('button', { name: '删除这个站点' }).click()
  await page.getByRole('button', { name: '删除站点和站牌集' }).click()
  await expect(page).toHaveURL(/\/stops$/)
})

test('AC-21：线路详情"逐站编排"，每站全部放到一号牌，Ctrl+Enter 进下一站，处理完回到线路', async ({ page }) => {
  await login(page)
  const type = await shelfType(page)
  const ids: string[] = []
  for (const [i, n] of ['逐站甲站', '逐站乙站', '逐站丙站'].entries()) {
    const s = await createStop(page, n, '东', 120.33 + i * 0.004, 30.33)
    await oneBoard(page, s.id, type.id)
    ids.push(s.id)
  }
  const l = (await api<{ item: Line }>(page, 'post', '/api/lines', twoway('Z1路', ids, [...ids].reverse()))).item

  await page.goto(`/lines/${l.id}`)
  await expect(page.getByTestId('arrange-summary')).toContainText('待编排 6')
  await page.getByRole('button', { name: '逐站编排' }).click()
  for (let i = 0; i < 3; i++) {
    await expect(page.getByTestId('queue-pos')).toHaveText(`第 ${i + 1} / 3 站`)
    await page.getByRole('button', { name: /全部放到/ }).click()
    await page.getByRole('menuitem', { name: /一号牌/ }).click()
    await expect(page.getByTestId('tray-all-done')).toBeVisible()
    await page.keyboard.press('Control+Enter')
  }
  await expect(page.getByTestId('queue-finished')).toContainText('3 站都过了一遍')
  await page.getByRole('button', { name: '回到线路' }).click()
  await expect(page).toHaveURL(new RegExp(`/lines/${l.id}$`))
  await expect(page.getByTestId('arrange-summary')).toContainText('已编排 6')
  await expect(page.getByTestId('arrange-placed')).toHaveCount(3)
})

test('AC-22：新建对向站点带入字段，照着原站复制站牌集，线路编排一并带过来', async ({ page }) => {
  await login(page)
  const type = await shelfType(page)
  const road = await api<{ id: string }>(page, 'post', '/api/dicts', { category: 'road', name: `对向路${Date.now()}` })
  const res = await page.request.post('/api/stops', {
    headers: H,
    data: { name: '对向测试站', direction: '东', lng: 120.35, lat: 30.35, roadId: road.id, seats: 3 },
  })
  const src = ((await res.json()) as { item: { id: string } }).item
  const next = await createStop(page, '对向下一站', '东', 120.354, 30.35)
  const l = (
    await api<{ item: Line }>(page, 'post', '/api/lines', twoway('D1路', [src.id, next.id], [next.id, src.id]))
  ).item
  // 原站：一号牌放上行
  const ss = await api<{ id: string; rev: number }>(page, 'get', `/api/stops/${src.id}/sign-set`)
  const boardId = randomUUID()
  await api(page, 'put', `/api/sign-sets/${ss.id}`, {
    rev: ss.rev,
    reminder: '',
    shelves: [
      {
        id: randomUUID(),
        no: 1,
        typeId: type.id,
        boards: [{ id: boardId, no: 1, face: 'front', kind: 'whole', width: 1200, height: 1800 }],
      },
    ],
    schedules: [{ routeId: l.routes.find((r) => r.kind === 'up')!.id, pass: 1, placement: 'board', boardId, order: 1 }],
  })

  await page.goto(`/stops/${src.id}`)
  await page.getByRole('button', { name: '更多' }).click()
  await page.getByRole('menuitem', { name: '新建对向站点' }).click()
  await expect(page.getByTestId('opposite-of')).toContainText('对向测试站（东）')
  await expect(page.getByLabel('站名')).toHaveValue('对向测试站')
  await expect(page.getByRole('radio', { name: '西' })).toHaveAttribute('aria-checked', 'true')
  const map = page.getByTestId('plane-map')
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2)
  await page.keyboard.press('Control+s')
  await expect(page).toHaveURL(/\/stops\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('对向测试站')
  const created = page.url().split('/').at(-1)!
  const detail = await api<{ road: { id: string } | null; facilities: { seats: number | null } }>(
    page,
    'get',
    `/api/stops/${created}`,
  )
  expect(detail.road?.id).toBe(road.id)
  expect(detail.facilities.seats).toBe(3)

  // 下行改停新的对向站，再照着原站复制站牌集
  const cur = await api<Line & { name: string; number: string; mode: string }>(page, 'get', `/api/lines/${l.id}`)
  await api(page, 'put', `/api/lines/${l.id}`, {
    ...twoway('D1路', [src.id, next.id], [next.id, created]),
    rev: cur.rev,
  })
  await page
    .getByTestId('next-steps')
    .getByRole('button', { name: /照着原站复制站牌集/ })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('copy-estimate')).toContainText('将追加 1 个站架、1 块站牌；带过 1 条编排')
  await dialog.getByRole('button', { name: '复制过来' }).click()
  await page.keyboard.press('Control+s')
  await expect(page.getByText('已保存站牌集，生成一份修改快照')).toBeVisible()
  await expect(page.getByTestId('tray-all-done')).toBeVisible()
})

test('AC-23：站点列表勾选后批量修改座椅数，预览只算真的会变的站点', async ({ page }) => {
  await login(page)
  for (const [i, n] of ['批量甲站', '批量乙站', '批量丙站'].entries()) {
    const res = await page.request.post('/api/stops', {
      headers: H,
      data: { name: n, direction: '东', lng: 120.37 + i * 0.002, lat: 30.37, seats: i === 0 ? 4 : null },
    })
    expect(res.ok()).toBe(true)
  }
  await page.goto('/stops?q=批量')
  await expect(page.getByText('3 个站点')).toBeVisible()
  const row = page.getByRole('button', { name: '批量甲站（东）' })
  await row.hover()
  await page.getByRole('checkbox', { name: '勾选 批量甲站（东）' }).click()
  await page.getByRole('button', { name: '选择当前筛选的全部 3 个' }).click()
  await expect(page.getByTestId('batch-bar')).toContainText('已选 3 个站点')
  await page.getByRole('button', { name: '批量修改' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radiogroup', { name: '座椅数怎么改' }).getByRole('radio', { name: '设为' }).click()
  await dialog.getByLabel('seats').fill('4')
  await expect(dialog.getByTestId('batch-preview')).toContainText('选中 3 个，将变化 2 个')
  await dialog.getByRole('button', { name: '修改 2 个站点' }).click()
  await expect(page.getByText('已修改 2 个站点，各生成一份修改快照')).toBeVisible()
})

test('AC-19、AC-24：方位反了的行可一键换成对向站；反向生成换成对向站，没有对向站的行标出', async ({ page }) => {
  await login(page)
  const base: [number, number] = [120.39, 30.39]
  const mk = (name: string, dir: string, x: number, y: number) => createStop(page, name, dir, ...at(base, x, y))
  // 一段向北的路：东侧是上行的右侧
  await mk('向北甲站', '东', 12, 0)
  await mk('向北甲站', '西', -12, 0)
  await mk('向北乙站', '东', 12, 400)
  await mk('向北乙站', '西', -12, 400)
  await mk('向北丙站', '东', 12, 800)

  await page.goto('/lines/new')
  await page.getByLabel('线路名').fill('N1路')
  await page.getByLabel('管理编号').fill('N-0001')
  await page.getByRole('button', { name: '粘贴两列' }).click()
  await page.getByLabel('站名与方位').fill('向北甲站\t东\n向北乙站\t西\n向北丙站\t东')
  await page.getByRole('button', { name: '匹配站点' }).click()
  await page.getByRole('button', { name: '追加 3 个站' }).click()
  const rows = page.getByTestId('stop-row')
  await expect(rows).toHaveCount(3)
  // AC-24：乙站方位反了（对向站在行驶方向右侧）
  await expect(rows.nth(1).getByTestId('row-note')).toBeVisible()
  await rows.nth(1).getByRole('button', { name: '换成对向站' }).click()
  await expect(rows.nth(1)).toHaveAccessibleName('第 2 站 向北乙站（东）')
  await expect(rows.nth(1).getByTestId('row-note')).toHaveCount(0)

  // AC-19：下行反向生成，甲、乙换成西侧，丙没有对向站
  await page.getByRole('tab', { name: /下行/ }).click()
  await page.getByRole('button', { name: '反向生成' }).click()
  await expect(rows.nth(0)).toHaveAccessibleName('第 1 站 向北丙站（东）')
  await expect(rows.nth(1)).toHaveAccessibleName('第 2 站 向北乙站（西）')
  await expect(rows.nth(2)).toHaveAccessibleName('第 3 站 向北甲站（西）')
  await expect(rows.nth(0).getByTestId('row-note')).toBeVisible()
  await expect(rows.nth(1).getByTestId('row-note')).toHaveCount(0)
})
