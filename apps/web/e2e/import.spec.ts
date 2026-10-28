import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { createStop, login } from './helpers'

// 用服务端的 ExcelJS 生成测试文件（前端不依赖它）
const here = path.dirname(fileURLToPath(import.meta.url))
interface Workbook {
  addWorksheet(name: string): { addRow(row: unknown[]): void }
  xlsx: { writeBuffer(): Promise<ArrayBuffer> }
}
const ExcelJS = createRequire(path.resolve(here, '../../server/package.json'))('exceljs') as {
  Workbook: new () => Workbook
}

test('AC-11：站点导出后原样导入，预览全是无变化', async ({ page }, info) => {
  await login(page)
  await createStop(page, '导出甲站', '南')
  await createStop(page, '导出乙站', '北', 120.21, 30.26)
  await page.goto('/stops')

  await page.getByRole('button', { name: '更多操作' }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: '导出当前结果' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^站点_\d{4}-\d{2}-\d{2}\.xlsx$/)
  const file = info.outputPath('stops.xlsx')
  await download.saveAs(file)

  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '导入站点' }).click()
  await page.getByLabel('选择导入文件').setInputFiles(file)
  await page.getByRole('button', { name: '上传并预览' }).click()
  const summary = page.getByTestId('import-summary')
  await expect(summary).toContainText('新增 0，修改 0')
  await expect(summary).toContainText('失败 0')
  await expect(page.getByRole('button', { name: /确认导入/ })).toBeDisabled()
  await page.getByRole('button', { name: '取消导入' }).click()
})

test('AC-12：线路导入有未匹配站点时整条失败，预览列出未匹配站点，其他线路照常', async ({ page }, info) => {
  await login(page)
  await createStop(page, '导入一站', '东')
  await createStop(page, '导入二站', '东', 120.21, 30.25)

  const wb = new ExcelJS.Workbook()
  const add = (name: string, header: string[], rows: (string | number)[][]) => {
    const ws = wb.addWorksheet(name)
    ws.addRow(header)
    rows.forEach((r) => ws.addRow(r))
  }
  add(
    '线路',
    ['管理编号*', '线路名*', '英文名', '模式*'],
    [
      ['I-1', '导入1路', '', '单向'],
      ['I-2', '导入2路', '', '单向'],
    ],
  )
  add(
    '路径站',
    ['管理编号*', '走向*', '序号*', '站名*', '方位*', '到站时刻'],
    [
      ['I-1', '单向', 1, '导入一站', '东', '07:00,07:30'],
      ['I-1', '单向', 2, '导入二站', '东', '07:05,07:35'],
      ['I-2', '单向', 1, '导入一站', '东', ''],
      ['I-2', '单向', 2, '没有这个站', '西', ''],
    ],
  )
  const file = info.outputPath('lines.xlsx')
  fs.writeFileSync(file, Buffer.from(await wb.xlsx.writeBuffer()))

  await page.goto('/lines')
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: '导入线路' }).click()
  await page.getByLabel('选择导入文件').setInputFiles(file)
  await page.getByRole('button', { name: '上传并预览' }).click()
  await expect(page.getByTestId('import-summary')).toContainText('新增 1，修改 0，无变化 0，失败 1')
  await page.getByRole('tab', { name: /失败/ }).click()
  await expect(page.getByText('I-2')).toBeVisible()
  await expect(page.getByText('没有这个站（西）')).toBeVisible()
  await page.getByRole('button', { name: '确认导入 1 个' }).click()
  await expect(page.getByText('已导入线路')).toBeVisible()
  await expect(page.getByRole('link', { name: '下载失败行' })).toBeVisible()
  await page.getByRole('button', { name: '完成' }).click()
  const list = page.getByRole('list', { name: '线路列表' })
  await expect(list.getByRole('button', { name: '导入1路', exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: '导入2路', exact: true })).toHaveCount(0)
})
