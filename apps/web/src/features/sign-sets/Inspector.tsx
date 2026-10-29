// 属性卡：选中站架、站牌或插片时在右上角浮出，编辑其字段（属性表版式，输入框平时像文字）
import {
  BOARD_FACE_LABEL,
  BOARD_FACES,
  BOARD_NO_MAX,
  SHELF_NO_MAX,
  SIZE_MAX_MM,
  SLOT_NO_MAX,
  addBoard,
  addSlot,
  allBoards,
  autoSort,
  boardLabel,
  deleteBoard,
  deleteShelf,
  deleteSlot,
  findBoard,
  findShelf,
  findSlot,
  moveBoard,
  moveShelf,
  onBoard,
  placementsOnBoard,
  placementsOnShelf,
  shelfLabel,
  slotLabel,
  updateBoard,
  updateShelf,
  updateSlot,
  type BoardFace,
} from '@gentransit/shared'
import { ArrowDownUp, ArrowLeft, ArrowRight, Layers, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { FieldError, GhostInput, GhostSelect, Prop } from '@/components/gt/prop'
import { Segmented } from '@/components/gt/symbols'
import { Button, IconButton } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useDict } from '@/features/common/data'
import { useEditor } from './editor-api'

/** 整数输入：本地保留文本，合法时才写进草稿 */
function IntField({
  value,
  min,
  max,
  onCommit,
  label,
}: {
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
  label: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text)
  const ok = /^\d+$/.test(text) && n >= min && n <= max
  return (
    <>
      <GhostInput
        inputMode="numeric"
        aria-label={label}
        aria-invalid={!ok}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (/^\d+$/.test(e.target.value) && v >= min && v <= max) onCommit(v)
        }}
        className="font-mono text-[13px] tabular-nums"
      />
      {!ok && <FieldError>{`${min}–${max} 的整数`}</FieldError>}
    </>
  )
}

function Card({
  title,
  sub,
  children,
  actions,
}: {
  title: ReactNode
  sub?: ReactNode
  children: ReactNode
  actions: ReactNode
}) {
  const ed = useEditor()
  return (
    <div
      className="gt-rise absolute right-4 top-4 z-10 flex max-h-[calc(100%-32px)] w-[312px] flex-col overflow-hidden rounded-2xl bg-surface shadow-pop ring-1 ring-hairline"
      onClick={(e) => e.stopPropagation()}
      role="region"
      aria-label="属性"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <span className="font-display text-[15px] font-bold">{title}</span>
        {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
        <IconButton label="关闭属性" className="ml-auto size-7" onClick={() => ed.setSel(null)}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-2">{children}</div>
      <div className="flex flex-wrap gap-2 border-t border-hairline bg-surface-2 px-4 py-3">{actions}</div>
    </div>
  )
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export function Inspector({ onReapply }: { onReapply: (shelfId: string) => void }) {
  const ed = useEditor()
  const types = useDict('shelfType').data ?? []
  const d = ed.draft
  const sel = ed.sel
  if (!sel) return null

  if (sel.type === 'shelf') {
    const s = findShelf(d, sel.id)
    if (!s) return null
    const used = d.shelves.map((x) => x.no)
    const i = d.shelves.indexOf(s)
    const placed = placementsOnShelf(d, s.id)
    const up = (patch: Parameters<typeof updateShelf>[2], merge?: string) =>
      ed.run((x) => updateShelf(x, s.id, patch), merge && `${s.id}:${merge}`)
    return (
      <Card
        title={shelfLabel(s.no)}
        sub={`${s.boards.length} 块站牌`}
        actions={
          <>
            <Button size="sm" onClick={() => ed.run((x) => addBoard(x, s.id))}>
              <Plus size={13} /> 加站牌
            </Button>
            <Button size="sm" onClick={() => onReapply(s.id)}>
              <Layers size={13} /> 重新套用模板…
            </Button>
            <IconButton
              label="左移"
              className="size-7"
              disabled={i === 0}
              onClick={() => ed.run((x) => moveShelf(x, s.id, -1))}
            >
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton
              label="右移"
              className="size-7"
              disabled={i === d.shelves.length - 1}
              onClick={() => ed.run((x) => moveShelf(x, s.id, 1))}
            >
              <ArrowRight size={14} />
            </IconButton>
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              onClick={() => {
                const go = () => {
                  ed.run((x) => deleteShelf(x, s.id))
                  ed.setSel(null)
                }
                if (!s.boards.length) return go()
                ed.confirm({
                  title: `删除${shelfLabel(s.no)}？`,
                  body: `连同其下 ${s.boards.length} 块站牌一起删除${placed ? `，其上 ${placed} 条编排随之移除，相关线路回到待编排` : ''}。保存前可以撤销。`,
                  ok: '删除站架',
                  danger: true,
                  run: go,
                })
              }}
            >
              <Trash2 size={13} /> 删除
            </Button>
          </>
        }
      >
        <Prop label="编号" required>
          <GhostSelect value={s.no} onChange={(e) => up({ no: Number(e.target.value) })}>
            {range(SHELF_NO_MAX).map((n) => (
              <option key={n} value={n} disabled={n !== s.no && used.includes(n)}>
                {shelfLabel(n)}
              </option>
            ))}
          </GhostSelect>
        </Prop>
        <Prop label="站架类型" required>
          <GhostSelect
            value={s.typeId}
            onChange={(e) =>
              up({ typeId: e.target.value, typeName: types.find((t) => t.id === e.target.value)?.name ?? '' })
            }
          >
            {!types.some((t) => t.id === s.typeId) && <option value={s.typeId}>{s.typeName}</option>}
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </GhostSelect>
        </Prop>
        <Prop label="名称">
          <GhostInput
            value={s.name}
            maxLength={50}
            placeholder="如：主站架"
            onChange={(e) => up({ name: e.target.value }, 'name')}
          />
        </Prop>
        <Prop label="说明">
          <GhostInput value={s.desc} maxLength={200} onChange={(e) => up({ desc: e.target.value }, 'desc')} />
        </Prop>
        <Prop label="材质说明">
          <GhostInput
            value={s.material}
            maxLength={200}
            placeholder="如：铝型材 + 钢化玻璃"
            onChange={(e) => up({ material: e.target.value }, 'material')}
          />
        </Prop>
        <Prop label="无实物站架" hint="电子站牌等没有实物站架时打开，立面画成虚线">
          <Switch checked={s.noPhysical} onCheckedChange={(v) => up({ noPhysical: v })} aria-label="无实物站架" />
        </Prop>
      </Card>
    )
  }

  if (sel.type === 'board') {
    const f = findBoard(d, sel.id)
    if (!f) return null
    const b = f.board
    const used = allBoards(d).map((x) => x.board.no)
    const i = f.shelf.boards.indexOf(b)
    const placed = placementsOnBoard(d, b.id)
    const up = (patch: Parameters<typeof updateBoard>[2], merge?: string) =>
      ed.run((x) => updateBoard(x, b.id, patch), merge && `${b.id}:${merge}`)
    return (
      <Card
        title={boardLabel(b.no)}
        sub={shelfLabel(f.shelf.no)}
        actions={
          <>
            {b.kind === 'whole' ? (
              <Button
                size="sm"
                disabled={onBoard(d, b.id).length < 2}
                onClick={() => {
                  if (ed.run((x) => autoSort(x, b.id, (rid) => ed.view.routes.find((r) => r.id === rid))))
                    ed.toast('已按线路名自动排序', 'ok')
                }}
              >
                <ArrowDownUp size={13} /> 自动排序
              </Button>
            ) : (
              <Button size="sm" onClick={() => ed.run((x) => addSlot(x, b.id))}>
                <Plus size={13} /> 加插片
              </Button>
            )}
            <IconButton
              label="左移"
              className="size-7"
              disabled={i === 0}
              onClick={() => ed.run((x) => moveBoard(x, b.id, -1))}
            >
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton
              label="右移"
              className="size-7"
              disabled={i === f.shelf.boards.length - 1}
              onClick={() => ed.run((x) => moveBoard(x, b.id, 1))}
            >
              <ArrowRight size={14} />
            </IconButton>
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              onClick={() => {
                const go = () => {
                  ed.run((x) => deleteBoard(x, b.id))
                  ed.setSel(null)
                }
                if (!placed) return go()
                ed.confirm({
                  title: `删除${boardLabel(b.no)}？`,
                  body: `其上 ${placed} 条编排随之移除，相关线路回到待编排。保存前可以撤销。`,
                  ok: '删除站牌',
                  danger: true,
                  run: go,
                })
              }}
            >
              <Trash2 size={13} /> 删除
            </Button>
          </>
        }
      >
        <Prop label="编号" required>
          <GhostSelect value={b.no} onChange={(e) => up({ no: Number(e.target.value) })}>
            {range(BOARD_NO_MAX).map((n) => (
              <option key={n} value={n} disabled={n !== b.no && used.includes(n)}>
                {boardLabel(n)}
              </option>
            ))}
          </GhostSelect>
        </Prop>
        <Prop label="面" required>
          <GhostSelect value={b.face} onChange={(e) => up({ face: e.target.value as BoardFace })}>
            {BOARD_FACES.map((x) => (
              <option key={x} value={x}>
                {BOARD_FACE_LABEL[x]}
              </option>
            ))}
          </GhostSelect>
        </Prop>
        <Prop label="类型" required hint={b.kind === 'whole' ? '整版：线路直接排在牌上' : '分片：线路放进线路插片'}>
          <Segmented
            size="sm"
            label="站牌类型"
            value={b.kind}
            options={[
              { value: 'whole', label: '整版' },
              { value: 'sliced', label: '分片' },
            ]}
            onChange={(v) => {
              if (v === b.kind) return
              const go = () => up({ kind: v })
              if (!placed && !b.slots.length) return go()
              ed.confirm({
                title: `把${boardLabel(b.no)}改为${v === 'whole' ? '整版' : '分片'}？`,
                body:
                  `${placed ? `这块牌上 ${placed} 条编排随之移除，相关线路回到待编排。` : ''}` +
                  (v === 'sliced'
                    ? '改为分片后生成 1 个与牌面同尺寸的线路插片，可以再增删。'
                    : '改为整版会删除全部插片。'),
                ok: '改类型',
                run: go,
              })
            }}
          />
        </Prop>
        <div className="grid grid-cols-2 gap-x-4">
          <Prop label="宽" required className="grid-cols-[40px_1fr]">
            <IntField
              label="站牌宽（毫米）"
              value={b.width}
              min={1}
              max={SIZE_MAX_MM}
              onCommit={(v) => up({ width: v }, 'w')}
            />
          </Prop>
          <Prop label="高" required className="grid-cols-[40px_1fr]">
            <IntField
              label="站牌高（毫米）"
              value={b.height}
              min={1}
              max={SIZE_MAX_MM}
              onCommit={(v) => up({ height: v }, 'h')}
            />
          </Prop>
        </div>
        <Prop label="备注">
          <GhostInput value={b.remark} maxLength={200} onChange={(e) => up({ remark: e.target.value }, 'remark')} />
        </Prop>
      </Card>
    )
  }

  const f = findSlot(d, sel.id)
  if (!f) return null
  const s = f.slot
  const up = (patch: Parameters<typeof updateSlot>[2], merge?: string) =>
    ed.run((x) => updateSlot(x, s.id, patch), merge && `${s.id}:${merge}`)
  return (
    <Card
      title={slotLabel(s.no)}
      sub={`${boardLabel(f.board.no)} · ${shelfLabel(f.shelf.no)}`}
      actions={
        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          onClick={() => {
            ed.run((x) => deleteSlot(x, s.id))
            ed.setSel(null)
          }}
        >
          <Trash2 size={13} /> 删除插片
        </Button>
      }
    >
      <Prop label="编号" required hint="所在站牌内唯一">
        <IntField label="插片编号" value={s.no} min={1} max={SLOT_NO_MAX} onCommit={(v) => up({ no: v })} />
      </Prop>
      <Prop label="类型" required>
        <Segmented
          size="sm"
          label="插片类型"
          value={s.kind}
          options={[
            { value: 'route', label: '线路插片' },
            { value: 'other', label: '非线路' },
          ]}
          onChange={(v) => up({ kind: v })}
        />
      </Prop>
      {s.kind === 'other' && (
        <Prop label="非线路说明" required>
          <GhostInput
            value={s.note}
            maxLength={50}
            placeholder="如：广告位、公告栏"
            aria-invalid={!s.note.trim()}
            onChange={(e) => up({ note: e.target.value }, 'note')}
          />
          {!s.note.trim() && <FieldError>非线路插片要写说明</FieldError>}
        </Prop>
      )}
      <div className="grid grid-cols-2 gap-x-4">
        <Prop label="宽" required className="grid-cols-[40px_1fr]">
          <IntField
            label="插片宽（毫米）"
            value={s.width}
            min={1}
            max={SIZE_MAX_MM}
            onCommit={(v) => up({ width: v }, 'w')}
          />
        </Prop>
        <Prop label="高" required className="grid-cols-[40px_1fr]">
          <IntField
            label="插片高（毫米）"
            value={s.height}
            min={1}
            max={SIZE_MAX_MM}
            onCommit={(v) => up({ height: v }, 'h')}
          />
        </Prop>
      </div>
    </Card>
  )
}
