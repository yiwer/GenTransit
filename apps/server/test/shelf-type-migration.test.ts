// 迁移测试（M7 计划第 7 节）：在迁移到上一版的库里造站架类型字典项、站架、背面与多面站牌、模板，
// 执行本次迁移后核对 ID、名称、引用不变，形式与参数和 guessShelfForm 一致且能通过 zod 校验，字典里不再有这一类
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { guessShelfForm, shelfSpec } from '@gentransit/shared'
import { Client } from 'pg'
import { GUESS_CASES } from '../../../packages/shared/test/guess-cases'

const MIGRATIONS = path.resolve(__dirname, '../prisma/migrations')
const M7 = '20261101000000_shelf_type'
const DB = 'gt_m7_migration'

describe('M7 迁移：站架类型从字典迁出', () => {
  let admin: Client
  let db: Client

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.DATABASE_URL })
    await admin.connect()
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
    await admin.query(`CREATE DATABASE ${DB}`)
    const url = new URL(process.env.DATABASE_URL!)
    url.pathname = `/${DB}`
    db = new Client({ connectionString: url.toString() })
    await db.connect()
    const dirs = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
    expect(dirs.at(-1)).toBe(M7)
    for (const dir of dirs.slice(0, -1))
      await db.query(readFileSync(path.join(MIGRATIONS, dir, 'migration.sql'), 'utf8'))
  })
  afterAll(async () => {
    await db?.end()
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`)
    await admin?.end()
  })

  it('迁出后 ID、名称、时间、引用不变；形式与参数和 guessShelfForm 一致；标"待核对"', async () => {
    const created = new Date('2026-10-01T08:00:00.000Z')
    const updated = new Date('2026-10-20T08:00:00.000Z')
    const types = GUESS_CASES.map((c) => ({ ...c, id: randomUUID() }))
    for (const ty of types)
      await db.query(
        `INSERT INTO "DictItem" (id, category, name, "createdAt", "updatedAt") VALUES ($1, 'shelfType', $2, $3, $4)`,
        [ty.id, ty.name, created, updated],
      )
    const road = randomUUID()
    await db.query(`INSERT INTO "DictItem" (id, category, name, "updatedAt") VALUES ($1, 'road', '解放路', now())`, [
      road,
    ])
    // 一个站点、一个站牌集；每个类型一个站架，站架上按用例放各面的站牌
    const stop = randomUUID()
    const set = randomUUID()
    await db.query(
      `INSERT INTO "Stop" (id, name, direction, lng, lat, "roadId", "updatedAt") VALUES ($1, '人民广场', '东', 120.2, 30.25, $2, now())`,
      [stop, road],
    )
    await db.query(`INSERT INTO "SignSet" (id, "stopId", "updatedAt") VALUES ($1, $2, now())`, [set, stop])
    const shelves: { id: string; typeId: string }[] = []
    let boardNo = 0
    for (const [i, ty] of types.entries()) {
      if (!ty.faces.length) continue
      const shelf = randomUUID()
      shelves.push({ id: shelf, typeId: ty.id })
      await db.query(
        `INSERT INTO "Shelf" (id, "signSetId", "typeId", no, sort, "updatedAt") VALUES ($1, $2, $3, $4, $5, now())`,
        [shelf, set, ty.id, shelves.length, i],
      )
      for (const face of ty.faces)
        await db.query(
          `INSERT INTO "Board" (id, "shelfId", "signSetId", no, face, kind, width, height, sort, "updatedAt")
           VALUES ($1, $2, $3, $4, $5, 'whole', 1200, 1800, 0, now())`,
          [randomUUID(), shelf, set, ++boardNo, face],
        )
    }
    expect(shelves.length).toBeLessThan(15)
    const template = randomUUID()
    await db.query(
      `INSERT INTO "ShelfTemplate" (id, name, "typeId", boards, "updatedAt") VALUES ($1, '单面', $2, '[]', now())`,
      [template, types[0].id],
    )

    await db.query(readFileSync(path.join(MIGRATIONS, M7, 'migration.sql'), 'utf8'))

    const rows = (
      await db.query<{
        id: string
        name: string
        form: string
        params: Record<string, unknown>
        needsReview: boolean
        createdAt: Date
        updatedAt: Date
      }>(`SELECT * FROM "ShelfType"`)
    ).rows
    expect(rows).toHaveLength(types.length)
    for (const ty of types) {
      const r = rows.find((x) => x.id === ty.id)!
      expect(r).toBeTruthy()
      const ts = guessShelfForm(ty.name, ty.faces)
      expect([ty.name, r.form, r.params]).toEqual([ty.name, ts.form, ts.params])
      expect([ty.name, r.form]).toEqual([ty.name, ty.form])
      expect(shelfSpec.safeParse({ form: r.form, params: r.params }).success).toBe(true)
      expect(r).toMatchObject({ name: ty.name, needsReview: true, createdAt: created, updatedAt: updated })
    }
    // 引用不变，外键改指向站架类型
    const after = (await db.query<{ id: string; typeId: string }>(`SELECT id, "typeId" FROM "Shelf"`)).rows
    expect(after.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(shelves.sort((a, b) => (a.id < b.id ? -1 : 1)))
    expect((await db.query(`SELECT "typeId" FROM "ShelfTemplate" WHERE id = $1`, [template])).rows[0].typeId).toBe(
      types[0].id,
    )
    await expect(
      db.query(
        `INSERT INTO "Shelf" (id, "signSetId", "typeId", no, sort, "updatedAt") VALUES ($1, $2, $3, 15, 99, now())`,
        [randomUUID(), set, road],
      ),
    ).rejects.toThrow(/Shelf_typeId_fkey/)
    // 字典里不再有这一类，其余字典项与引用不受影响
    const dicts = (await db.query<{ id: string; category: string }>(`SELECT id, category::text FROM "DictItem"`)).rows
    expect(dicts).toEqual([{ id: road, category: 'road' }])
    const cats = (await db.query<{ v: string }>(`SELECT unnest(enum_range(NULL::"DictCategory"))::text AS v`)).rows
    expect(cats.map((x) => x.v)).toEqual(['maintainer', 'road', 'fareSystem', 'platformType', 'safety', 'shelterType'])
    const tombs = (await db.query<{ v: string }>(`SELECT unnest(enum_range(NULL::"TombstoneType"))::text AS v`)).rows
    expect(tombs.map((x) => x.v)).toContain('shelfType')
    expect((await db.query(`SELECT "roadId" FROM "Stop" WHERE id = $1`, [stop])).rows[0].roadId).toBe(road)
  })
})
