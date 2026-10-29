import { createHash } from 'node:crypto'
import type { Writable } from 'node:stream'
import { Inject, Injectable } from '@nestjs/common'
import {
  ERROR_CODES,
  IMPORT_MAX_BYTES,
  IMPORT_TTL_MS,
  ROUTE_KIND_LABEL,
  canonicalJson,
  compareLineName,
  type CoordSystem,
  type ImportJobView,
  type ImportKind,
  type ImportOptions,
  type ImportPreview,
  type ImportResult,
  type LineListQuery,
  type StopListQuery,
} from '@gentransit/shared'
import { AppError, invalid, notFound } from '../common/errors'
import type { Prisma } from '../generated/prisma/client'
import { LineService } from '../lines/line.service'
import { ROUTE_REMOVAL_HOOK, type RouteRemovalHook } from '../lines/route-removal.hook'
import { PrismaService, type Tx } from '../prisma/prisma.service'
import { SnapshotService } from '../snapshots/snapshot.service'
import { STOP_DETAIL_INCLUDE, StopService } from '../stops/stop.service'
import { looksLikeXlsx, readWorkbook, workbookBuffer, writeWorkbook, type Sheet, type SheetSpec } from './excel'
import {
  LINE_NOTES,
  LINE_SHEETS,
  analyzeLines,
  applyLines,
  lineSheetColumns,
  lineSheetSpecs,
  loadLineCtx,
  numbersIn,
} from './line-import'
import {
  analyzeStops,
  applyStops,
  loadStopCtx,
  stopExportRows,
  stopNotes,
  stopSheetSpec,
  type Analysis,
  type FailedRow,
} from './stop-import'

/** 导入事务可能写入上万行，给足时间 */
const TX_OPTIONS = { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 }
const NO_FILE = new Uint8Array(0)
const JOB_KEEP_MS = 7 * 24 * 3600 * 1000

const planHash = (plan: unknown) => createHash('sha256').update(canonicalJson(plan)).digest('hex')

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stops: StopService,
    private readonly lines: LineService,
    private readonly snapshots: SnapshotService,
    @Inject(ROUTE_REMOVAL_HOOK) private readonly hook: RouteRemovalHook,
  ) {}

  /* ---------------- 模板与导出 ---------------- */

  private async extDefs(db: Tx) {
    const defs = await db.extField.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] })
    return {
      stop: defs.filter((d) => d.owner === 'stop'),
      line: defs.filter((d) => d.owner === 'line'),
      routeStop: defs.filter((d) => d.owner === 'routeStop'),
    }
  }

  /** 模板：按当前启用的扩展字段生成列，另附"说明"sheet */
  async template(kind: ImportKind, out: Writable) {
    const ext = await this.extDefs(this.prisma)
    if (kind === 'stop') {
      const { orientationMode } = await this.prisma.setting.findUniqueOrThrow({ where: { id: 1 } })
      await writeWorkbook(out, [stopSheetSpec(orientationMode, ext.stop, [])], stopNotes(orientationMode))
    } else {
      const cols = lineSheetColumns(ext.line, ext.routeStop)
      await writeWorkbook(
        out,
        (Object.keys(LINE_SHEETS) as (keyof typeof LINE_SHEETS)[]).map((k) => ({
          name: LINE_SHEETS[k],
          columns: cols[k],
          rows: [],
        })),
        LINE_NOTES,
      )
    }
  }

  /** 站点导出：范围为当前筛选结果，格式与模板一致 */
  async exportStops(q: Omit<StopListQuery, 'page' | 'size'>, out: Writable) {
    const { where, orderBy } = this.stops.query(q)
    const [ext, setting, rows] = await Promise.all([
      this.extDefs(this.prisma),
      this.prisma.setting.findUniqueOrThrow({ where: { id: 1 } }),
      this.prisma.stop.findMany({ where, orderBy, include: STOP_DETAIL_INCLUDE }),
    ])
    await writeWorkbook(out, [stopSheetSpec(setting.orientationMode, ext.stop, stopExportRows(rows, ext.stop))])
  }

  /** 线路导出：三个 sheet，范围为当前筛选结果（按自动排序） */
  async exportLines(q: Omit<LineListQuery, 'page' | 'size'>, out: Writable) {
    const page = await this.lines.list({ ...q, page: 1, size: 100_000 } as LineListQuery)
    const details = await this.lines.details(
      this.prisma,
      page.items.map((l) => l.id),
    )
    details.sort((a, b) => compareLineName(a.name, b.name))
    const ext = await this.extDefs(this.prisma)
    await writeWorkbook(out, lineSheetSpecs(details, ext.line, ext.routeStop))
  }

  /* ---------------- 导入任务 ---------------- */

  private async analyze(kind: ImportKind, sheets: Sheet[], options: ImportOptions, db: Tx): Promise<Analysis<unknown>> {
    if (kind === 'stop') return analyzeStops(sheets, options.coordSystem ?? 'gcj02', await loadStopCtx(db))
    const ctx = await loadLineCtx(db, numbersIn(sheets), this.lines)
    const a = analyzeLines(sheets, ctx)
    // 改模式将删除的走向：写明受影响的站牌集数与编排数
    for (const r of a.preview.removedRoutes) {
      const routes = ctx.existing.get(r.key)?.routes ?? []
      const ids = routes.filter((x) => r.routes.includes(ROUTE_KIND_LABEL[x.kind])).map((x) => x.id)
      Object.assign(r, await this.hook.affected(ids))
    }
    return a
  }

  private async parse(buf: Buffer): Promise<Sheet[]> {
    if (!looksLikeXlsx(buf)) throw invalid('请上传 Excel（.xlsx）文件')
    try {
      return await readWorkbook(buf)
    } catch {
      throw invalid('无法读取这个 Excel 文件')
    }
  }

  private view(j: {
    id: string
    kind: ImportKind
    status: ImportJobView['status']
    fileName: string
    options: unknown
    preview: unknown
    createdAt: Date
    expiresAt: Date
  }): ImportJobView {
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      fileName: j.fileName,
      options: j.options as ImportOptions,
      preview: j.preview as ImportPreview,
      createdAt: j.createdAt.toISOString(),
      expiresAt: j.expiresAt.toISOString(),
    }
  }

  /** 上传：解析、校验、生成预览；此时不写业务数据 */
  async create(
    kind: ImportKind,
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    coord?: CoordSystem,
  ) {
    if (!file) throw invalid('请选择要导入的文件')
    if (file.size > IMPORT_MAX_BYTES) throw new AppError(413, ERROR_CODES.uploadRejected, '文件不能超过 20 MB')
    const sheets = await this.parse(file.buffer)
    const options: ImportOptions = kind === 'stop' ? { coordSystem: coord ?? 'gcj02' } : {}
    const a = await this.analyze(kind, sheets, options, this.prisma)
    await this.prune()
    const job = await this.prisma.importJob.create({
      data: {
        kind,
        fileName: file.originalname.slice(0, 200),
        file: new Uint8Array(file.buffer),
        options: options as Prisma.InputJsonValue,
        preview: a.preview as unknown as Prisma.InputJsonValue,
        failures: { rows: a.failedRows, headers: a.headers } as unknown as Prisma.InputJsonValue,
        planHash: planHash(a.plan),
        expiresAt: new Date(Date.now() + IMPORT_TTL_MS),
      },
    })
    return this.view(job)
  }

  async get(id: string) {
    const j = await this.prisma.importJob.findUnique({ where: { id } })
    if (!j) throw notFound('导入任务')
    return this.view(j)
  }

  /** 原文件只在待确认期间有用：过期的标记为已过期并清掉文件；7 天前的任务整条删除 */
  private async prune() {
    const now = Date.now()
    await this.prisma.importJob.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date(now) } },
      data: { status: 'expired', file: NO_FILE },
    })
    await this.prisma.importJob.deleteMany({ where: { createdAt: { lt: new Date(now - JOB_KEEP_MS) } } })
  }

  private async open(id: string) {
    const j = await this.prisma.importJob.findUnique({ where: { id } })
    if (!j) throw notFound('导入任务')
    if (j.status === 'pending' && j.expiresAt.getTime() < Date.now()) {
      await this.prisma.importJob.update({ where: { id }, data: { status: 'expired', file: NO_FILE } })
      throw new AppError(409, ERROR_CODES.importClosed, '导入任务已过期，请重新上传')
    }
    if (j.status !== 'pending')
      throw new AppError(
        409,
        ERROR_CODES.importClosed,
        `导入任务已${j.status === 'confirmed' ? '确认' : j.status === 'cancelled' ? '取消' : '过期'}`,
      )
    return j
  }

  /**
   * 确认：在一个事务里重新分析文件；计划与预览时不一致（这期间有人改了数据）就拒绝；
   * 一致则写入（新建字典项与区划、写对象、各存一份导入快照）。整个导入原子提交
   */
  async confirm(id: string): Promise<ImportResult> {
    const j = await this.open(id)
    const sheets = await this.parse(Buffer.from(j.file))
    const preview = j.preview as unknown as ImportPreview
    const result = await this.prisma.$transaction(async (tx) => {
      const a = await this.analyze(j.kind, sheets, j.options as ImportOptions, tx)
      if (planHash(a.plan) !== j.planHash)
        throw new AppError(409, ERROR_CODES.importStale, '数据已变化，请重新预览', { preview: a.preview })
      const written =
        j.kind === 'stop'
          ? await applyStops(tx, a.plan as Parameters<typeof applyStops>[1], this.stops)
          : {
              ...(await applyLines(tx, a.plan as Parameters<typeof applyLines>[1], this.lines, this.snapshots)),
              newRefs: 0,
            }
      const r: ImportResult = {
        created: written.created,
        updated: written.updated,
        unchanged: preview.unchanged,
        failed: preview.failures.length,
        newRefs: written.newRefs,
      }
      await tx.importJob.update({
        where: { id },
        data: { status: 'confirmed', file: NO_FILE, result: r as unknown as Prisma.InputJsonValue },
      })
      return r
    }, TX_OPTIONS)
    return result
  }

  async cancel(id: string) {
    await this.open(id)
    await this.prisma.importJob.update({ where: { id }, data: { status: 'cancelled', file: NO_FILE } })
  }

  /** 失败行：原样附一列"失败原因" */
  async failures(id: string): Promise<{ name: string; buffer: Buffer }> {
    const j = await this.prisma.importJob.findUnique({ where: { id }, select: { fileName: true, failures: true } })
    if (!j) throw notFound('导入任务')
    const { rows, headers } = j.failures as unknown as { rows: FailedRow[]; headers: Record<string, string[]> }
    const sheets: SheetSpec[] = Object.entries(headers)
      .map(([name, hs]) => ({
        name,
        columns: [...hs.map((h) => ({ header: h })), { header: '失败原因', width: 60 }],
        rows: rows.filter((r) => r.sheet === name).map((r) => [...r.values, r.reason]),
      }))
      .filter((s) => s.rows.length)
    const base = j.fileName.replace(/\.xlsx$/i, '')
    return { name: `${base}_失败行.xlsx`, buffer: await workbookBuffer(sheets) }
  }
}
