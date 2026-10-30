import type { StopCheck } from '@gentransit/shared'
import type { Prisma } from '../generated/prisma/client'

/** 数据体检的站点检查项（需求 5.2）：站点列表的 check 筛选与工作台计数共用 */
export function stopCheckWhere(check: StopCheck): Prisma.StopWhereInput {
  switch (check) {
    case 'noNameEn':
      return { nameEn: '' }
    case 'noRegion':
      return { OR: [{ districtId: null }, { streetId: null }, { roadId: null }] }
    case 'noPhoto':
      return { photos: { none: {} } }
    case 'noShelf':
      return {
        routeStops: { some: { route: { line: { status: 'running' } } } },
        signSet: { is: { shelves: { none: {} } } },
      }
  }
}
