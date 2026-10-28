// Excel 读写（ExcelJS，默认决定 8）：读入时把单元格统一转成文本；写出时数值与文本格式和导入解析互逆（AC-11）
import type { Writable } from 'node:stream'
import ExcelJS from 'exceljs'

export interface SheetRow {
  /** Excel 行号（表头为第 1 行） */
  row: number
  /** 原始单元格文本，按表头顺序 */
  values: string[]
  /** 按表头名（去掉 * 与空白）取值 */
  get: (header: string) => string
}

export interface Sheet {
  name: string
  headers: string[]
  rows: SheetRow[]
}

/** 表头规整：去掉必填标记 * 与空白 */
export const headerKey = (h: string) => h.replace(/[*＊\s]/g, '')

const pad = (n: number) => String(n).padStart(2, '0')

/** 单元格 → 文本：数字原样，日期按 YYYY-MM-DD，纯时间按 HH:mm，富文本、超链接、公式取文字或结果 */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (v instanceof Date) {
    // Excel 的纯时间落在 1899-12-30
    if (v.getUTCFullYear() < 1901) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  }
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((t) => t.text)
        .join('')
        .trim()
    if ('formula' in v || 'sharedFormula' in v)
      return cellText((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue)
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? '').trim()
    if ('error' in v) return ''
  }
  return String(v).trim()
}

/** 文件头是 ZIP（xlsx 是 zip 包） */
export const looksLikeXlsx = (buf: Buffer) =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04

export async function readWorkbook(buf: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  return wb.worksheets.map((ws) => {
    const headerRow = ws.getRow(1)
    const headers: string[] = []
    for (let c = 1; c <= ws.columnCount; c++) headers.push(cellText(headerRow.getCell(c).value))
    while (headers.length && !headers.at(-1)) headers.pop()
    const index = new Map(headers.map((h, i) => [headerKey(h), i]))
    const rows: SheetRow[] = []
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return
      const values = headers.map((_, i) => cellText(r.getCell(i + 1).value))
      if (values.every((x) => !x)) return
      rows.push({ row: n, values, get: (h) => values[index.get(headerKey(h)) ?? -1] ?? '' })
    })
    return { name: ws.name, headers, rows }
  })
}

export interface ColumnSpec {
  header: string
  /** 写出时的列宽 */
  width?: number
  /** 写出时的数值格式（经纬度 6 位小数、整数） */
  numFmt?: string
}

export interface SheetSpec {
  name: string
  columns: ColumnSpec[]
  /** 数据行：字符串原样写；数字写成数值；null / '' 写空单元格 */
  rows: Iterable<(string | number | null)[]>
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3EEE5' } }

/** 流式写出（导出 2 万站点也不占满内存） */
export async function writeWorkbook(out: Writable, sheets: SheetSpec[], notes?: string[]) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false })
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = s.columns.map((c) => ({
      header: c.header,
      key: c.header,
      width: c.width ?? 14,
      style: c.numFmt ? { numFmt: c.numFmt } : {},
    }))
    const head = ws.getRow(1)
    head.font = { bold: true }
    head.fill = HEADER_FILL
    head.commit()
    for (const r of s.rows) ws.addRow(r.map((v) => (v === '' ? null : v))).commit()
    ws.commit()
  }
  if (notes?.length) {
    const ws = wb.addWorksheet('说明')
    ws.columns = [{ header: '说明', key: 'n', width: 100 }]
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).commit()
    for (const n of notes) ws.addRow([n]).commit()
    ws.commit()
  }
  await wb.commit()
}

/** 写入内存（小文件：失败行、测试） */
export async function workbookBuffer(sheets: SheetSpec[], notes?: string[]): Promise<Buffer> {
  const { PassThrough } = await import('node:stream')
  const pass = new PassThrough()
  const chunks: Buffer[] = []
  pass.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((r) => pass.on('end', () => r()))
  await writeWorkbook(pass, sheets, notes)
  await done
  return Buffer.concat(chunks)
}
