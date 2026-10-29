// 从站架模板添加站架（可多选）、重新套用模板（单选）；模板按站架类型分组，缩略图用立面组件画出结构
import { BOARD_FACE_LABEL, BOARD_KIND_LABEL, type ShelfTemplate, type SignSetDraft } from '@gentransit/shared'
import { Check, Layers } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Elevation } from '@/components/gt/elevation'
import { OrbitLoader } from '@/components/gt/lively'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useShelfTemplates } from './data'

/** 模板结构转成立面组件能画的草稿 */
export const templatePreview = (
  t: Pick<ShelfTemplate, 'type' | 'noPhysical' | 'boards'>,
): Pick<SignSetDraft, 'shelves' | 'schedules'> => ({
  shelves: [
    {
      id: 'tpl',
      no: 1,
      typeId: t.type.id,
      typeName: t.type.name,
      name: '',
      desc: '',
      noPhysical: t.noPhysical,
      material: '',
      boards: t.boards.map((b, i) => ({
        ...b,
        id: `b${i}`,
        no: i + 1,
        slots: b.slots.map((s, j) => ({ ...s, id: `s${i}-${j}` })),
      })),
    },
  ],
  schedules: [],
})

export const templateSummary = (t: Pick<ShelfTemplate, 'boards'>) =>
  t.boards
    .map(
      (b) => `${BOARD_FACE_LABEL[b.face]}${BOARD_KIND_LABEL[b.kind]}${b.slots.length ? ` ${b.slots.length} 插片` : ''}`,
    )
    .join('、')

export function groupByType(list: ShelfTemplate[]) {
  const groups = new Map<string, { type: ShelfTemplate['type']; items: ShelfTemplate[] }>()
  for (const t of list) {
    const g = groups.get(t.type.id) ?? { type: t.type, items: [] }
    g.items.push(t)
    groups.set(t.type.id, g)
  }
  return [...groups.values()]
}

export function TemplatePicker({
  open,
  onOpenChange,
  mode,
  onPick,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: 'add' | 'reapply'
  onPick: (ts: ShelfTemplate[]) => void
}) {
  const q = useShelfTemplates()
  const [picked, setPicked] = useState<string[]>([])
  const list = q.data ?? []
  const toggle = (id: string) =>
    setPicked((p) => (mode === 'reapply' ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const close = (o: boolean) => {
    if (!o) setPicked([])
    onOpenChange(o)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      width={640}
      title={mode === 'add' ? '从站架模板添加站架' : '重新套用模板'}
      description={
        mode === 'add'
          ? '可以选多个，每个模板生成一个站架；站牌编号自动接着往下编。'
          : '这个站架下的站牌与插片会被模板替换，站架类型随模板。'
      }
      footer={
        <>
          <Button onClick={() => close(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={!picked.length}
            onClick={() => {
              onPick(picked.map((id) => list.find((t) => t.id === id)!))
              close(false)
            }}
          >
            {mode === 'add' ? `添加 ${picked.length || ''} 个站架` : '套用'}
          </Button>
        </>
      }
    >
      {q.isPending ? (
        <div className="flex items-center gap-2 py-6 text-ink-3">
          <OrbitLoader size={22} /> 正在读取站架模板…
        </div>
      ) : list.length === 0 ? (
        <div className="py-6 text-center text-ink-3">
          还没有站架模板。
          <Link to="/base-data/shelf-templates" className="text-accent underline-offset-2 hover:underline">
            去基础数据里新建
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groupByType(list).map((g) => (
            <section key={g.type.id}>
              <div className="eyebrow mb-1.5">{g.type.name}</div>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((t) => {
                  const on = picked.includes(t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(t.id)}
                      className={cn(
                        'relative flex items-center gap-3 rounded-xl p-2 text-left ring-1 transition-colors',
                        on
                          ? 'bg-accent-soft ring-2 ring-accent'
                          : 'ring-hairline hover:bg-surface-2 hover:ring-hairline-2',
                      )}
                    >
                      <span className="flex h-[76px] w-[104px] shrink-0 items-end justify-center overflow-hidden rounded-lg bg-surface-2">
                        <Elevation draft={templatePreview(t)} pool={[]} height={52} bare />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{t.name}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">
                          {t.boards.length} 块站牌 · {templateSummary(t)}
                        </span>
                      </span>
                      {on && (
                        <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {mode === 'add' && list.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-3">
          <Layers size={13} /> 站架和模板之间不保留关联：以后改模板不影响已生成的站架。
        </p>
      )}
    </Dialog>
  )
}
