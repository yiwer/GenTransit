// "放到…""复制到…""隐藏""移出本牌""取消隐藏"菜单：每个拖拽都有不拖拽的替代（F-COM-08）
import {
  boardLabel,
  passageLabel,
  slotLabel,
  type PlaceTarget,
  type PoolItem,
  type ScheduleDraft,
} from '@gentransit/shared'
import { CornerDownRight, EyeOff, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useEditor } from './editor-api'

const targetText = (t: PlaceTarget) =>
  `${boardLabel(t.board.no)} · ${t.kind === 'slot' ? slotLabel(t.slot!.no) : '整版'}`

function Targets({
  item,
  verb,
  onPick,
  disabled,
}: {
  item: PoolItem
  verb: string
  onPick: (t: PlaceTarget) => void
  disabled: (t: PlaceTarget) => boolean
}) {
  const ed = useEditor()
  return (
    <>
      <MenuLabel>{verb}</MenuLabel>
      {ed.targets.length === 0 && <div className="px-2 py-1.5 text-[12px] text-ink-3">还没有站牌，先添加站架</div>}
      {ed.targets.map((t) => {
        const occ = t.occupant ? ed.itemOf(`${t.occupant.routeId}#${t.occupant.pass}`) : undefined
        const off = disabled(t)
        return (
          <MenuItem
            key={`${verb}-${t.id}`}
            disabled={off}
            hint={off && ed.placedOn(item, t) ? '已在' : occ ? occ.lineName : t.kind === 'slot' ? '空' : undefined}
            onSelect={() => onPick(t)}
          >
            <CornerDownRight size={13} className="text-ink-3" />
            {targetText(t)}
          </MenuItem>
        )
      })}
    </>
  )
}

/** 托盘条目（待编排、隐藏）的菜单 */
export function PoolMenu({ item }: { item: PoolItem }) {
  const ed = useEditor()
  const label = passageLabel(item)
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} 的操作`}
          className="flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
        >
          <MoreHorizontal size={14} />
        </button>
      </MenuTrigger>
      <MenuContent className="max-h-[360px] w-[250px] overflow-auto">
        <Targets item={item} verb="放到…" onPick={(t) => ed.place(item, t)} disabled={(t) => ed.placedOn(item, t)} />
        <MenuSeparator />
        {item.status === 'hidden' ? (
          <MenuItem onSelect={() => ed.unhide(item)}>
            <RotateCcw size={14} /> 取消隐藏（回到待编排）
          </MenuItem>
        ) : (
          <MenuItem onSelect={() => ed.hide(item)}>
            <EyeOff size={14} /> 隐藏，不在本站展示
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

/** 站牌上的线路行、插片里的编排的菜单 */
export function ScheduleMenu({
  s,
  item,
  className,
}: {
  s: ScheduleDraft
  item: PoolItem | undefined
  className?: string
}) {
  const ed = useEditor()
  if (!item) return null
  const label = passageLabel(item)
  const here = (t: PlaceTarget) =>
    t.kind === 'board' ? s.placement === 'board' && s.boardId === t.id : s.slotId === t.id
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label} 的操作`}
          className={cn(
            'flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink',
            className,
          )}
        >
          <MoreHorizontal size={13} />
        </button>
      </MenuTrigger>
      <MenuContent className="max-h-[400px] w-[250px] overflow-auto">
        {item.status === 'invalid' ? (
          <>
            <MenuLabel>{item.suspended ? '线路已停运，' : ''}这条线路已不经过本站</MenuLabel>
            <MenuItem onSelect={() => ed.removeSchedule(s.id)}>
              <X size={14} /> 移出本牌
            </MenuItem>
            {item.schedules.length > 1 && (
              <MenuItem danger onSelect={() => ed.removeKey(item.key)}>
                <Trash2 size={14} /> 清理这条失效编排（{item.schedules.length} 处）
              </MenuItem>
            )}
          </>
        ) : (
          <>
            <Targets item={item} verb="移到…" onPick={(t) => ed.place(item, t, s.id)} disabled={here} />
            <MenuSeparator />
            <Targets
              item={item}
              verb="复制到…"
              onPick={(t) => ed.place(item, t)}
              disabled={(t) => ed.placedOn(item, t) || t.board.id === s.boardId}
            />
            <MenuSeparator />
            <MenuItem onSelect={() => ed.hide(item)}>
              <EyeOff size={14} /> 隐藏（移除本站全部放置）
            </MenuItem>
            <MenuItem onSelect={() => ed.removeSchedule(s.id)}>
              <X size={14} /> 移出本牌
            </MenuItem>
            {item.schedules.length > 1 && (
              <MenuItem onSelect={() => ed.removeKey(item.key)}>
                <Trash2 size={14} /> 从全部站牌移除（{item.schedules.length} 处）
              </MenuItem>
            )}
          </>
        )}
      </MenuContent>
    </Menu>
  )
}
