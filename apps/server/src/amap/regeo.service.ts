import { Inject, Injectable } from '@nestjs/common'
import type { Ref, RegeoMatch, RegeoResult } from '@gentransit/shared'
import { ENV, type Env } from '../config/env'
import { PrismaService } from '../prisma/prisma.service'

/** 高德上游地址；测试里换成本地假服务 */
export const AMAP_UPSTREAMS = Symbol('AMAP_UPSTREAMS')
export interface AmapUpstreams {
  webapi: string
  fmap: string
  restapi: string
}
export const DEFAULT_UPSTREAMS: AmapUpstreams = {
  webapi: 'https://webapi.amap.com',
  fmap: 'https://fmap01.amap.com',
  restapi: 'https://restapi.amap.com',
}

/** 规则沿用原型 prototype/vite.config.ts */
export function upstreamOf(rest: string, up: AmapUpstreams) {
  if (rest.startsWith('/v4/map/styles')) return up.webapi
  if (rest.startsWith('/v3/vectormap')) return up.fmap
  return up.restapi
}

/** 去掉行政区划与道路的常见后缀，用于模糊匹配 */
export const stripSuffix = (s: string) =>
  s.replace(/(特别行政区|自治州|自治县|市|地区|区|县|街道办事处|街道|镇|乡|大道|大街|路|街)$/, '')

export function matchName(name: string, candidates: Ref[]): RegeoMatch | null {
  if (!name) return null
  const exact = candidates.find((c) => c.name === name)
  if (exact) return { name, match: exact, how: 'exact' }
  const key = stripSuffix(name)
  const fuzzy = key ? candidates.find((c) => stripSuffix(c.name) === key) : undefined
  return fuzzy ? { name, match: fuzzy, how: 'fuzzy' } : { name, match: null, how: null }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

@Injectable()
export class RegeoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(AMAP_UPSTREAMS) private readonly up: AmapUpstreams,
  ) {}

  /**
   * 逆地理编码：服务端用 Web 服务 Key 调高德，把市、区、街道、道路先按名称精确匹配本库的行政区划与路段字典，
   * 再去后缀模糊匹配；匹配不到的作为"新建建议"返回，由用户确认后才建（F-COM-07）
   */
  async reverse(lng: number, lat: number): Promise<RegeoResult> {
    const empty: RegeoResult = { available: false, address: '', city: null, district: null, street: null, road: null }
    const key = this.env.AMAP_WEB_SERVICE_KEY
    if (!key) return empty
    const url = `${this.up.restapi}/v3/geocode/regeo?key=${encodeURIComponent(key)}&location=${lng.toFixed(6)},${lat.toFixed(6)}&extensions=base&output=JSON`
    let data: {
      status?: string
      regeocode?: { formatted_address?: unknown; addressComponent?: Record<string, unknown> }
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      data = (await res.json()) as typeof data
    } catch {
      return empty
    }
    if (data.status !== '1' || !data.regeocode) return empty
    const ac = data.regeocode.addressComponent ?? {}
    // 直辖市的 city 为空数组，用省份名
    const cityName = str(ac.city) || str(ac.province)
    const streetNumber = (ac.streetNumber ?? {}) as Record<string, unknown>
    const roadName = str(streetNumber.street)

    const regions = await this.prisma.region.findMany({ select: { id: true, name: true, level: true, parentId: true } })
    const byLevel = (level: string, parentId?: string | null) =>
      regions.filter((r) => r.level === level && (parentId === undefined || r.parentId === parentId))
    const city = matchName(cityName, byLevel('city'))
    const district = matchName(str(ac.district), byLevel('district', city?.match ? city.match.id : undefined))
    const street = matchName(str(ac.township), byLevel('street', district?.match ? district.match.id : undefined))
    const roads = await this.prisma.dictItem.findMany({ where: { category: 'road' }, select: { id: true, name: true } })
    const road = matchName(roadName, roads)
    const pick = (m: RegeoMatch | null) =>
      m ? { name: m.name, match: m.match && { id: m.match.id, name: m.match.name }, how: m.how } : null
    return {
      available: true,
      address: str(data.regeocode.formatted_address),
      city: pick(city),
      district: pick(district),
      street: pick(street),
      road: pick(road),
    }
  }
}
