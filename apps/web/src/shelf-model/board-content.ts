// 3D 牌面要画的内容（M7 计划 5.3 节）：与立面一致的牌头、线路行、插片。纯数据，不依赖 three，编辑器按草稿与途经算出
import {
  BOARD_KIND_LABEL,
  boardLabel,
  inSlot,
  keyOf,
  onBoard,
  shelfFaceLabel,
  type PoolItem,
  type RouteKind,
  type ShelfForm,
  type SignSetDraft,
} from '@gentransit/shared'

export const KIND_MARK: Record<RouteKind, string> = {
  up: '↑',
  down: '↓',
  inner: '⟳',
  outer: '⟲',
  loop: '⟳',
  oneway: '→',
}

export interface BoardRow {
  name: string
  mark: string
  terminal: string
  /** 失效：陶土色加删除线 */
  bad: boolean
  badText: string
}

export interface BoardSlotContent {
  no: number
  other: boolean
  note: string
  width: number
  height: number
  row: BoardRow | null
}

export interface BoardContent {
  id: string
  title: string
  faceLabel: string
  kindLabel: string
  count: number
  whole: boolean
  rows: BoardRow[]
  slots: BoardSlotContent[]
  width: number
  height: number
  /** 悬停提示："三号牌 · 正面 · 整版 6 条" */
  tip: string
}

const rowOf = (item: PoolItem | undefined): BoardRow => {
  const bad = item?.status === 'invalid'
  return {
    name: item?.lineName ?? '?',
    mark: item ? KIND_MARK[item.kind] : '·',
    terminal: item?.terminal ?? '',
    bad,
    badText: item?.suspended ? '线路停运' : '已不经过本站',
  }
}

/** 草稿里每块站牌的牌面内容；formOf 给出站架的结构形式（面名：候车亭的正面叫亭内） */
export function boardContents(
  draft: Pick<SignSetDraft, 'shelves' | 'schedules'>,
  pool: PoolItem[],
  formOf: (typeId: string) => ShelfForm | undefined,
): Record<string, BoardContent> {
  const byKey = new Map(pool.map((p) => [p.key, p]))
  const out: Record<string, BoardContent> = {}
  for (const sh of draft.shelves)
    for (const b of sh.boards) {
      const whole = b.kind === 'whole'
      const rows = whole ? onBoard(draft, b.id).map((s) => rowOf(byKey.get(keyOf(s)))) : []
      const slots = b.slots.map((sl) => {
        const s = inSlot(draft, sl.id)
        return {
          no: sl.no,
          other: sl.kind === 'other',
          note: sl.note,
          width: sl.width,
          height: sl.height,
          row: s ? rowOf(byKey.get(keyOf(s))) : null,
        }
      })
      const count = whole ? rows.length : slots.filter((x) => x.row).length
      const faceLabel = shelfFaceLabel(formOf(sh.typeId), b.face)
      out[b.id] = {
        id: b.id,
        title: boardLabel(b.no),
        faceLabel,
        kindLabel: BOARD_KIND_LABEL[b.kind],
        count,
        whole,
        rows,
        slots,
        width: b.width,
        height: b.height,
        tip: `${boardLabel(b.no)} · ${faceLabel} · ${BOARD_KIND_LABEL[b.kind]} ${count} 条`,
      }
    }
  return out
}
