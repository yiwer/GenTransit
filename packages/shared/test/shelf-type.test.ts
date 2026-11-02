import { describe, expect, it } from 'vitest'
import {
  SHELF_FORMS,
  SHELF_PARAM_DEFAULTS,
  SHELF_PRESETS,
  guessShelfForm,
  parseShelfSpec,
  shelfFaceLabel,
  shelfFaces,
  shelfParamFields,
  shelfSpec,
  shelfTypeInput,
  switchForm,
  v1ShelfType,
} from '../src'
import { GUESS_CASES } from './guess-cases'

describe('站架类型参数', () => {
  it('六种形式都有默认参数，且能通过判别联合校验', () => {
    for (const form of SHELF_FORMS) {
      const r = shelfSpec.safeParse({ form, params: SHELF_PARAM_DEFAULTS[form] })
      expect(r.success).toBe(true)
      expect(SHELF_PARAM_DEFAULTS[form].mountBottom).toBe(800)
      expect(SHELF_PARAM_DEFAULTS[form].orientation).toBe('parallel')
    }
    expect(SHELF_PARAM_DEFAULTS.shelter).toMatchObject({ length: 6000, canopyBottom: 2500, posts: 3, backPanel: true })
    expect(SHELF_PARAM_DEFAULTS.doublePost).toMatchObject({ postHeight: 2600, postInset: 100, sides: 2 })
    expect(SHELF_PARAM_DEFAULTS.totem.faces).toBe(3)
  })

  it('缺的参数补默认值；越界、错类型被拒绝', () => {
    expect(shelfSpec.parse({ form: 'totem', params: { faces: 5 } }).params).toMatchObject({ faces: 5, height: 3000 })
    expect(shelfSpec.safeParse({ form: 'totem', params: { faces: 7 } }).success).toBe(false)
    expect(shelfSpec.safeParse({ form: 'shelter', params: { posts: 1 } }).success).toBe(false)
    expect(shelfSpec.safeParse({ form: 'doublePost', params: { mountBottom: -1 } }).success).toBe(false)
    expect(shelfSpec.safeParse({ form: 'doublePost', params: { sides: 3 } }).success).toBe(false)
    expect(shelfSpec.safeParse({ form: 'nope', params: {} }).success).toBe(false)
  })

  it('挂墙只能单面', () => {
    const r = shelfSpec.safeParse({ form: 'attached', params: { host: 'wall', sides: 2 } })
    expect(r.success).toBe(false)
    expect(r.error?.issues[0].path).toEqual(['params', 'sides'])
    expect(shelfSpec.safeParse({ form: 'attached', params: { host: 'pole', sides: 2 } }).success).toBe(true)
  })

  it('请求体：名称必填，形式与参数一起校验', () => {
    const ok = shelfTypeInput.parse({ name: ' 三面柱 ', form: 'totem', params: { faces: 3 } })
    expect(ok).toMatchObject({ name: '三面柱', desc: '', form: 'totem', params: { faces: 3, baseHeight: 200 } })
    expect(shelfTypeInput.safeParse({ name: '', form: 'totem', params: {} }).success).toBe(false)
    expect(shelfTypeInput.safeParse({ name: 'x', form: 'totem', params: { faces: 2 } }).success).toBe(false)
  })

  it('读库里的参数：不合法时退回默认，不抛错', () => {
    expect(parseShelfSpec('totem', { faces: 99 }).params).toEqual(SHELF_PARAM_DEFAULTS.totem)
    expect(parseShelfSpec('ePost', null).params).toEqual(SHELF_PARAM_DEFAULTS.ePost)
  })

  it('切换形式保留通用参数，其余换默认值', () => {
    const s = switchForm({ form: 'totem', params: { ...SHELF_PARAM_DEFAULTS.totem, mountBottom: 1000 } }, 'shelter')
    expect(s).toEqual({ form: 'shelter', params: { ...SHELF_PARAM_DEFAULTS.shelter, mountBottom: 1000 } })
  })

  it('每种形式的面', () => {
    const faces = (form: string, params: object) => shelfFaces(shelfSpec.parse({ form, params }))
    expect(faces('singlePost', { sides: 1 })).toEqual(['front'])
    expect(faces('doublePost', {})).toEqual(['front', 'back'])
    expect(faces('totem', { faces: 4 })).toEqual(['A', 'B', 'C', 'D'])
    expect(faces('attached', { host: 'wall' })).toEqual(['front'])
    expect(faces('attached', { host: 'pole', sides: 2 })).toEqual(['front', 'back'])
    expect(shelfFaceLabel('shelter', 'front')).toBe('亭内')
    expect(shelfFaceLabel('shelter', 'back')).toBe('亭外')
    expect(shelfFaceLabel('totem', 'A')).toBe('A面')
  })

  it('参数表覆盖每个参数', () => {
    for (const form of SHELF_FORMS) {
      const keys = shelfParamFields(form).map((x) => x.key)
      expect(keys.sort()).toEqual(Object.keys(SHELF_PARAM_DEFAULTS[form]).sort())
    }
  })

  it('预设库 11 项都能通过校验，名称不重复', () => {
    expect(SHELF_PRESETS).toHaveLength(11)
    expect(new Set(SHELF_PRESETS.map((p) => p.name)).size).toBe(11)
    for (const p of SHELF_PRESETS) expect(shelfSpec.safeParse(p.spec).success).toBe(true)
    expect(new Set(SHELF_PRESETS.map((p) => p.spec.form))).toEqual(new Set(SHELF_FORMS))
    const flag = SHELF_PRESETS.find((p) => p.key === 'single-flag')!.spec
    expect(flag.params).toMatchObject({ mount: 'flag', sides: 2, orientation: 'perpendicular' })
  })

  it('只读 API 的站架类型模式接受默认参数，拒绝多余字段', () => {
    const base = { id: '0190a0a0-0000-7000-8000-000000000000', name: 'x', desc: '' }
    const stamps = { createdAt: '2026-11-01T00:00:00.000Z', changedAt: '2026-11-01T00:00:00.000Z' }
    for (const form of SHELF_FORMS)
      expect(v1ShelfType.safeParse({ ...base, form, params: SHELF_PARAM_DEFAULTS[form], ...stamps }).success).toBe(true)
    const extra = { ...SHELF_PARAM_DEFAULTS.totem, foo: 1 }
    expect(v1ShelfType.safeParse({ ...base, form: 'totem', params: extra, ...stamps }).success).toBe(false)
  })
})

describe('guessShelfForm', () => {
  it.each(GUESS_CASES)('$name → $form', (c) => {
    const s = guessShelfForm(c.name, c.faces)
    expect(s.form).toBe(c.form)
    expect(shelfSpec.safeParse(s).success).toBe(true)
    // 指定的参数按识别结果，其余取默认值
    expect(s.params).toEqual({ ...SHELF_PARAM_DEFAULTS[s.form], ...c.params })
  })
})
