// 站牌集导出（需求 5.11，M3 计划 3.6）：站架、站牌、插片、线路编排四个 sheet；编号导出为阿拉伯数字（默认决定 10）
import {
  BOARD_FACE_LABEL,
  BOARD_KIND_LABEL,
  ROUTE_KIND_LABEL,
  SCHEDULE_STATUS_LABEL,
  SLOT_KIND_LABEL,
  allBoards,
  comparePassages,
  keyOf,
  type RouteInfo,
  type SignSetDraft,
  type SignSetStop,
} from '@gentransit/shared'
import type { SheetSpec } from '../import/excel'

export interface ExportBatchItem {
  stop: SignSetStop
  draft: SignSetDraft
  /** 当前途经的键 */
  live: Set<string>
  routes: Map<string, RouteInfo>
}

type Batches = () => AsyncIterable<ExportBatchItem[]>
type Row = (string | number | null)[]

const INT = '0'
const head = (header: string, width = 12, numFmt?: string) => ({ header, width, numFmt })

async function* rows(batches: Batches, each: (x: ExportBatchItem) => Row[]): AsyncIterable<Row> {
  for await (const batch of batches()) for (const x of batch) yield* each(x)
}

/** 四个 sheet 各自分批读库，不把全部站牌集放进内存 */
export function signSetSheets(batches: Batches): SheetSpec[] {
  return [
    {
      name: '站架',
      columns: [
        head('站名', 18),
        head('方位', 8),
        head('站架编号', 10, INT),
        head('站架类型', 14),
        head('名称', 14),
        head('说明', 20),
        head('无实物站架', 10),
        head('材质说明', 20),
        head('排列顺序', 10, INT),
      ],
      rows: rows(batches, ({ stop, draft }) =>
        draft.shelves.map((sh, i) => [
          stop.name,
          stop.direction,
          sh.no,
          sh.typeName,
          sh.name,
          sh.desc,
          sh.noPhysical ? '是' : '否',
          sh.material,
          i + 1,
        ]),
      ),
    },
    {
      name: '站牌',
      columns: [
        head('站名', 18),
        head('方位', 8),
        head('站架编号', 10, INT),
        head('站牌编号', 10, INT),
        head('面', 8),
        head('类型', 8),
        head('宽', 8, INT),
        head('高', 8, INT),
        head('备注', 20),
      ],
      rows: rows(batches, ({ stop, draft }) =>
        allBoards(draft).map(({ shelf, board: b }) => [
          stop.name,
          stop.direction,
          shelf.no,
          b.no,
          BOARD_FACE_LABEL[b.face],
          BOARD_KIND_LABEL[b.kind],
          b.width,
          b.height,
          b.remark,
        ]),
      ),
    },
    {
      name: '插片',
      columns: [
        head('站名', 18),
        head('方位', 8),
        head('站牌编号', 10, INT),
        head('插片编号', 10, INT),
        head('类型', 12),
        head('非线路说明', 16),
        head('宽', 8, INT),
        head('高', 8, INT),
      ],
      rows: rows(batches, ({ stop, draft }) =>
        allBoards(draft).flatMap(({ board: b }) =>
          b.slots.map((s) => [
            stop.name,
            stop.direction,
            b.no,
            s.no,
            SLOT_KIND_LABEL[s.kind],
            s.kind === 'other' ? s.note : '',
            s.width,
            s.height,
          ]),
        ),
      ),
    },
    {
      name: '线路编排',
      columns: [
        head('站名', 18),
        head('方位', 8),
        head('线路名', 12),
        head('走向', 8),
        head('第几次途经', 10, INT),
        head('站牌编号', 10, INT),
        head('插片编号', 10, INT),
        head('顺序', 8, INT),
        head('状态', 8),
      ],
      // 待编排没有编排行，不导出
      rows: rows(batches, ({ stop, draft, live, routes }) => {
        const boards = new Map(allBoards(draft).map(({ board }) => [board.id, board]))
        const slots = new Map([...boards.values()].flatMap((b) => b.slots.map((s) => [s.id, s.no] as const)))
        const sortKey = (s: (typeof draft.schedules)[number]) => {
          const r = routes.get(s.routeId)
          return { lineName: r?.lineName ?? '', kind: r?.kind ?? ('oneway' as const), pass: s.pass }
        }
        return [...draft.schedules]
          .sort(
            (a, b) =>
              comparePassages(sortKey(a), sortKey(b)) ||
              (boards.get(a.boardId ?? '')?.no ?? 0) - (boards.get(b.boardId ?? '')?.no ?? 0),
          )
          .map((s) => {
            const r = routes.get(s.routeId)
            const status = !live.has(keyOf(s)) ? 'invalid' : s.placement === 'hidden' ? 'hidden' : 'placed'
            return [
              stop.name,
              stop.direction,
              r?.lineName ?? '',
              r ? ROUTE_KIND_LABEL[r.kind] : '',
              s.pass,
              s.boardId ? (boards.get(s.boardId)?.no ?? null) : null,
              s.slotId ? (slots.get(s.slotId) ?? null) : null,
              s.order,
              SCHEDULE_STATUS_LABEL[status],
            ]
          })
      }),
    },
  ]
}
