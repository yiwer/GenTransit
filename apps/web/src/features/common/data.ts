// 基础数据与设置的查询钩子
import type {
  BusCompany,
  DictCategory,
  DictItem,
  ExtFieldDef,
  ExtOwner,
  Landmark,
  LandmarkCategory,
  Region,
  Settings,
} from '@gentransit/shared'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api'

export const keys = {
  dicts: ['dicts'] as const,
  regions: ['regions'] as const,
  companies: ['companies'] as const,
  settings: ['settings'] as const,
  ext: ['ext-fields'] as const,
  landmarkCategories: ['landmark-categories'] as const,
  landmarks: ['landmarks'] as const,
  stops: ['stops'] as const,
}

/** 全部字典项（数量小），按类别在前端分组 */
export const useDicts = () => useQuery({ queryKey: keys.dicts, queryFn: () => get<DictItem[]>('/api/dicts') })

export function useDict(category: DictCategory) {
  const q = useDicts()
  return { ...q, data: q.data?.filter((d) => d.category === category) }
}

export const useRegions = () => useQuery({ queryKey: keys.regions, queryFn: () => get<Region[]>('/api/regions') })

export const useCompanies = () =>
  useQuery({ queryKey: keys.companies, queryFn: () => get<BusCompany[]>('/api/companies') })

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => get<Settings>('/api/settings') })

export const useExtFields = (owner: ExtOwner) =>
  useQuery({
    queryKey: [...keys.ext, owner],
    queryFn: () => get<ExtFieldDef[]>('/api/ext-fields', { owner }),
  })

export const useLandmarkCategories = () =>
  useQuery({ queryKey: keys.landmarkCategories, queryFn: () => get<LandmarkCategory[]>('/api/landmark-categories') })

export const useLandmarks = (q?: { q?: string; categoryId?: string }) =>
  useQuery({ queryKey: [...keys.landmarks, q ?? {}], queryFn: () => get<Landmark[]>('/api/landmarks', q) })
