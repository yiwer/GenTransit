// PROTOTYPE — 站牌编排编辑器入口：各方案共用同一份草稿，切换方案不丢修改，方便对比。
// 2026-10-27：在 A 的基础上比较 A1 聚焦单牌 / A2 点选装填 / A3 立面 + 线路托盘（原 B 泳道、C 矩阵已淘汰，代码暂留）
import { useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import { useVariant } from '../../shell/PrototypeSwitcher'
import { EditorA } from './EditorA'
import { EditorElevation } from './EditorElevation'
import { EditorFill } from './EditorFill'
import { EditorFocus } from './EditorFocus'
import { useEditor } from './useEditor'

function Editor({ stopId }: { stopId: string }) {
  const ed = useEditor(stopId)
  const { key } = useVariant()
  if (!ed.stop) return <div className="p-10 text-center text-ink-3">站点不存在</div>
  // 2026-10-27 定稿：A3 立面 + 线路托盘。旧方案可用 ?variant= 临时查看
  if (key === 'A') return <EditorA ed={ed} />
  if (key === 'A1') return <EditorFocus ed={ed} />
  if (key === 'A2') return <EditorFill ed={ed} />
  return <EditorElevation ed={ed} />
}

export function SignSetEditorPage() {
  const { stopId } = useParams()
  const { stops } = useStore()
  if (!stops.some((s) => s.id === stopId)) return <div className="p-10 text-center text-ink-3">站点不存在</div>
  return <Editor key={stopId} stopId={stopId!} />
}
