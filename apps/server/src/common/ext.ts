import { checkExtValue, type ExtFieldDefLike } from '@gentransit/shared'
import { invalid } from './errors'

export type ExtDef = ExtFieldDefLike & { enabled: boolean }

/**
 * 按字段定义校验扩展字段取值：未知键拒绝；停用字段不接受新值，已有值保留；空值不存
 * @param path 出错时的字段路径前缀，如 ext 或 routes.0.stops.3.ext
 */
export function validateExt(
  defs: ExtDef[],
  input: Record<string, unknown>,
  existing: Record<string, unknown>,
  path = 'ext',
  where = '',
): Record<string, unknown> {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const ext: Record<string, unknown> = {}
  for (const d of defs) if (!d.enabled && existing[d.key] != null) ext[d.key] = existing[d.key]
  for (const [k, raw] of Object.entries(input)) {
    const d = byKey.get(k)
    if (!d) throw invalid(`${where}未知的扩展字段「${k}」`)
    if (!d.enabled) continue
    const r = checkExtValue(d, raw)
    if (!r.ok) throw invalid(`${where}${r.error}`, { issues: [{ path: `${path}.${k}`, message: r.error }] })
    if (r.value !== null) ext[k] = r.value
  }
  return ext
}
