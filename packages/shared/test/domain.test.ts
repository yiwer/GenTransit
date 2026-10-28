import { describe, expect, it } from 'vitest'
import { checkExtValue, cnNum, compareLineName, haversineMeters, stopInput } from '../src'

describe('compareLineName', () => {
  it('按需求 5.5.6 的规则排序（ICU 中文排序规则把汉字前缀排在拉丁字母前）', () => {
    const names = ['K12路', '夜1路', '', 'B2路', '10路', 'K', '1路', 'K1路', '2路', 'B1路']
    expect([...names].sort(compareLineName)).toEqual([
      '1路',
      '2路',
      '10路',
      '夜1路',
      'B1路',
      'B2路',
      'K',
      'K1路',
      'K12路',
      '',
    ])
  })
})

describe('cnNum', () => {
  it('转中文数字', () => {
    expect([1, 10, 11, 20, 23, 90].map(cnNum)).toEqual(['一', '十', '十一', '二十', '二十三', '九十'])
  })
})

describe('haversineMeters', () => {
  it('纬度差 0.001 度约 111 米', () => {
    expect(haversineMeters(120.2, 30.25, 120.2, 30.251)).toBeCloseTo(111.2, 0)
  })
})

describe('checkExtValue', () => {
  const def = (type: 'text' | 'select' | 'number' | 'date' | 'time' | 'textList') => ({
    key: 'k',
    name: '字段',
    type,
    options: ['甲', '乙'],
  })
  it('空值统一为 null', () => {
    expect(checkExtValue(def('text'), '')).toEqual({ ok: true, value: null })
    expect(checkExtValue(def('textList'), [])).toEqual({ ok: true, value: null })
  })
  it('按类型校验', () => {
    expect(checkExtValue(def('select'), '丙').ok).toBe(false)
    expect(checkExtValue(def('select'), '甲')).toEqual({ ok: true, value: '甲' })
    expect(checkExtValue(def('number'), '12.5')).toEqual({ ok: true, value: 12.5 })
    expect(checkExtValue(def('number'), 'abc').ok).toBe(false)
    expect(checkExtValue(def('date'), '2026-10-28').ok).toBe(true)
    expect(checkExtValue(def('date'), '2026/10/28').ok).toBe(false)
    expect(checkExtValue(def('time'), '07:30').ok).toBe(true)
    expect(checkExtValue(def('time'), '24:00').ok).toBe(false)
    expect(checkExtValue(def('textList'), [' a ', '', 'b'])).toEqual({ ok: true, value: ['a', 'b'] })
  })
})

describe('stopInput', () => {
  it('英文名只允许英文字母、数字、空格与常用标点', () => {
    const r = stopInput.safeParse({ name: '人民广场', direction: '东', nameEn: '人民', lng: 120, lat: 30 })
    expect(r.success).toBe(false)
  })
  it('补齐默认值', () => {
    const r = stopInput.parse({ name: ' 人民广场 ', direction: '东', lng: 120, lat: 30 })
    expect(r.name).toBe('人民广场')
    expect(r.roadId).toBeNull()
    expect(r.landmarkIds).toEqual([])
  })
})
